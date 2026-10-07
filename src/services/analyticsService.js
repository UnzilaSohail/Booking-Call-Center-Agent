// Real aggregated analytics for the dashboard home page — revenue, trends, breakdowns —
// as opposed to the simple counts in getDashboardStats (src/services/bookingService.js).
// Kept separate since this is read-only reporting, not core booking logic.
import { withTenant } from '../db.js';

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function trendPct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export async function getAnalytics(businessId) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const prevMonthStart = new Date(monthStart);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  const now = new Date();
  const prevSamePoint = new Date(Math.min(monthStart.getTime(), prevMonthStart.getTime() + (now.getTime() - monthStart.getTime())));
  const trendStart = daysAgo(13); // 14-day window including today

  return withTenant(businessId, async (col) => {
    const [revenueRows, prevRevenueRows, dailyRows, serviceRows, staffRows, callRows, aiValueRows] = await Promise.all([
      // Revenue + booking count this month. $lookup joins to services for price —
      // bookings carry no price of their own, it's set on the service at booking time.
      col('bookings').aggregate([
        { $match: { status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: monthStart, $lte: now } } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, revenue: { $sum: { $ifNull: ['$service.price', 0] } }, count: { $sum: 1 } } },
      ]).toArray(),

      // Same, for the prior calendar month — powers the "vs last month" trend. Compared over the same number of
      // elapsed days (day 3 of this month vs days 1-3 of last), so the first days of a month don't read as a crash.
      col('bookings').aggregate([
        { $match: { status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: prevMonthStart, $lt: prevSamePoint } } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, revenue: { $sum: { $ifNull: ['$service.price', 0] } } } },
      ]).toArray(),

      // Confirmed + cancelled bookings per day for the last 14 days, for the activity chart.
      col('bookings').aggregate([
        { $match: { start_time: { $gte: trendStart }, status: { $in: ['confirmed', 'cancelled'] }, is_test: { $ne: true } } },
        { $group: { _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$start_time' } }, status: '$status' }, count: { $sum: 1 } } },
        { $sort: { '_id.date': 1 } },
      ]).toArray(),

      // Top services this month, for a breakdown chart.
      col('bookings').aggregate([
        { $match: { status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: monthStart, $lte: now } } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $group: { _id: { $ifNull: ['$service.name', 'Unknown'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]).toArray(),

      // Bookings per staff member this month (skipped entirely on the dashboard if the
      // business has no staff — single-resource businesses shouldn't see an empty chart).
      col('bookings').aggregate([
        { $match: { status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: monthStart, $lte: now }, staff_id: { $ne: null } } },
        { $lookup: { from: 'staff', localField: 'staff_id', foreignField: '_id', as: 'staff' } },
        { $unwind: { path: '$staff', preserveNullAndEmptyArrays: true } },
        { $group: { _id: { $ifNull: ['$staff.name', 'Unassigned'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),

      // Call outcomes, current vs previous 30-day window — conversion rate plus its
      // trend (the "+6% vs previous period" style badge on the Call conversion card).
      col('call_logs').aggregate([
        { $match: { created_at: { $gte: daysAgo(59) }, is_test: { $ne: true } } },
        { $group: {
          _id: { $cond: [{ $gte: ['$created_at', daysAgo(29)] }, 'current', 'previous'] },
          total: { $sum: 1 },
          booked: { $sum: { $cond: [{ $ne: ['$booking_id', null] }, 1, 0] } },
          transferred: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$outcome', ''] }, regex: /^transferred/ } }, 1, 0] } },
          afterHours: { $sum: { $cond: ['$is_after_hours', 1, 0] } },
          // ROADMAP.md §8 "Calls answered"/"Missed calls": a call_logs row only exists
          // once Twilio connects the Media Stream (src/webhooks/twilio.js), so "missed"
          // here means the AI never actually got to help the caller — it failed before
          // engaging (KG-07: Gemini unavailable, or MAX_CONCURRENT_CALLS busy), not a
          // classic unanswered ring (Twilio itself handles that before we're involved).
          missed: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$outcome', ''] }, regex: /^failed:/ } }, 1, 0] } },
        } },
      ]).toArray(),

      // AI-attributed booking value (ROADMAP.md §8, plan.md §11 item 7) — same shape as
      // the revenue aggregate above, filtered to bookings the voice agent itself created
      // (created_via: 'call', src/voice/tools.js) rather than every confirmed booking.
      col('bookings').aggregate([
        { $match: { status: 'confirmed', is_test: { $ne: true }, created_via: 'call', start_time: { $gte: monthStart, $lte: now } } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, value: { $sum: { $ifNull: ['$service.price', 0] } }, count: { $sum: 1 } } },
      ]).toArray(),
    ]);

    const revenue = revenueRows[0] ?? { revenue: 0, count: 0 };
    const prevRevenue = prevRevenueRows[0] ?? { revenue: 0 };
    const aiValue = aiValueRows[0] ?? { value: 0, count: 0 };
    const callsByPeriod = Object.fromEntries(callRows.map((r) => [r._id, r]));
    const calls = callsByPeriod.current ?? { total: 0, booked: 0, transferred: 0, afterHours: 0, missed: 0 };
    const prevCalls = callsByPeriod.previous ?? { total: 0, booked: 0, transferred: 0, afterHours: 0, missed: 0 };
    const prevConversionRate = prevCalls.total > 0 ? Math.round((prevCalls.booked / prevCalls.total) * 100) : null;

    // Fill in zero-count days so the trend chart doesn't have gaps for quiet days.
    const dailyByDate = {};
    for (const r of dailyRows) {
      const { date, status } = r._id;
      dailyByDate[date] ??= { confirmed: 0, cancelled: 0 };
      dailyByDate[date][status] = r.count;
    }
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d = daysAgo(i);
      const key = d.toISOString().slice(0, 10);
      daily.push({
        date: key,
        count: dailyByDate[key]?.confirmed ?? 0, // kept for callers still reading the old shape
        confirmed: dailyByDate[key]?.confirmed ?? 0,
        cancelled: dailyByDate[key]?.cancelled ?? 0,
      });
    }

    const impact = await getImpact(businessId, daysAgo(29), new Date(Date.now() + 60_000));
    return {
      impact,
      revenueThisMonth: revenue.revenue,
      revenueTrendPct: trendPct(revenue.revenue, prevRevenue.revenue),
      bookingsThisMonth: revenue.count,
      aiAttributedBookingValue: aiValue.value,
      aiAttributedBookingCount: aiValue.count,
      daily,
      topServices: serviceRows.map((r) => ({ name: r._id, count: r.count })),
      byStaff: staffRows.map((r) => ({ name: r._id, count: r.count })),
      calls: {
        total: calls.total,
        answered: calls.total - (calls.missed ?? 0),
        missed: calls.missed ?? 0,
        missedTrendPct: trendPct(calls.missed ?? 0, prevCalls.missed ?? 0),
        booked: calls.booked,
        transferred: calls.transferred,
        afterHours: calls.afterHours ?? 0,
        noBooking: Math.max(0, calls.total - calls.booked - calls.transferred),
        conversionRate: calls.total > 0 ? Math.round((calls.booked / calls.total) * 100) : null,
        // Percentage-point change vs the previous 30-day window, not a relative %
        // change — matches how "conversion rate" trends are normally read (43% this
        // period vs 37% last period is "+6 points," not "+16%").
        conversionTrendPts: (calls.total > 0 && prevConversionRate !== null)
          ? Math.round((calls.booked / calls.total) * 100) - prevConversionRate
          : null,
      },
    };
  });
}


// What the AI and the reminders did for the business between two dates (Jira 38/40): money from bookings the AI made while
// the business was closed, and how many customers cancelled in time after a reminder instead of not showing up.
// Used by the Overview cards and by the monthly report email.
export async function getImpact(businessId, from, to) {
  return withTenant(businessId, async (col) => {
    const [afterHoursRows, sent24, sent2, cancelledRows, viaReply, refilled] = await Promise.all([
      col('call_logs').aggregate([
        { $match: { created_at: { $gte: from, $lt: to }, is_after_hours: true, is_test: { $ne: true } } },
        { $lookup: { from: 'bookings', localField: 'booking_id', foreignField: '_id', as: 'b' } },
        { $unwind: { path: '$b', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'services', localField: 'b.service_id', foreignField: '_id', as: 's' } },
        { $unwind: { path: '$s', preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: null, calls: { $sum: 1 },
          bookings: { $sum: { $cond: [{ $eq: ['$b.status', 'confirmed'] }, 1, 0] } },
          value: { $sum: { $cond: [{ $eq: ['$b.status', 'confirmed'] }, { $ifNull: ['$s.price', 0] }, 0] } },
        } },
      ]).toArray(),
      col('bookings').countDocuments({ reminder_24h_sent_at: { $gte: from, $lt: to }, is_test: { $ne: true } }),
      col('bookings').countDocuments({ reminder_2h_sent_at: { $gte: from, $lt: to }, is_test: { $ne: true } }),
      // cancelled by the customer (not staff) AFTER a reminder went out and BEFORE the appointment: the time can be given to someone else
      col('bookings').aggregate([
        { $match: {
          status: 'cancelled', is_test: { $ne: true }, cancelled_via: { $in: ['sms_reply', 'portal', 'link', 'call'] }, cancelled_at: { $gte: from, $lt: to },
          $expr: { $and: [{ $lt: ['$cancelled_at', '$start_time'] }, { $or: [{ $and: [{ $gt: ['$reminder_24h_sent_at', null] }, { $lt: ['$reminder_24h_sent_at', '$cancelled_at'] }] }, { $and: [{ $gt: ['$reminder_2h_sent_at', null] }, { $lt: ['$reminder_2h_sent_at', '$cancelled_at'] }] }] }] },
        } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 's' } },
        { $unwind: { path: '$s', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$s.price', 0] } } } },
      ]).toArray(),
      col('bookings').countDocuments({ status: 'cancelled', cancelled_via: 'sms_reply', cancelled_at: { $gte: from, $lt: to }, is_test: { $ne: true } }),
      col('waitlist').countDocuments({ status: 'booked', booked_at: { $gte: from, $lt: to } }),
    ]);
    const ah = afterHoursRows[0] ?? { calls: 0, bookings: 0, value: 0 };
    const cx = cancelledRows[0] ?? { count: 0, value: 0 };
    return {
      afterHours: { calls: ah.calls, bookings: ah.bookings, value: ah.value },
      reminders: { sent: sent24 + sent2, cancelledInTime: cx.count, valueFreed: cx.value, viaReply, waitlistRefilled: refilled },
    };
  });
}
