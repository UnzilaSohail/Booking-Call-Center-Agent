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
  const trendStart = daysAgo(13); // 14-day window including today

  return withTenant(businessId, async (col) => {
    const [revenueRows, prevRevenueRows, dailyRows, serviceRows, staffRows, callRows] = await Promise.all([
      // Revenue + booking count this month. $lookup joins to services for price —
      // bookings carry no price of their own, it's set on the service at booking time.
      col('bookings').aggregate([
        { $match: { status: 'confirmed', start_time: { $gte: monthStart, $lte: now } } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, revenue: { $sum: { $ifNull: ['$service.price', 0] } }, count: { $sum: 1 } } },
      ]).toArray(),

      // Same, for the prior calendar month — powers the "vs last month" trend.
      col('bookings').aggregate([
        { $match: { status: 'confirmed', start_time: { $gte: prevMonthStart, $lt: monthStart } } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, revenue: { $sum: { $ifNull: ['$service.price', 0] } } } },
      ]).toArray(),

      // Confirmed + cancelled bookings per day for the last 14 days, for the activity chart.
      col('bookings').aggregate([
        { $match: { start_time: { $gte: trendStart }, status: { $in: ['confirmed', 'cancelled'] } } },
        { $group: { _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$start_time' } }, status: '$status' }, count: { $sum: 1 } } },
        { $sort: { '_id.date': 1 } },
      ]).toArray(),

      // Top services this month, for a breakdown chart.
      col('bookings').aggregate([
        { $match: { status: 'confirmed', start_time: { $gte: monthStart, $lte: now } } },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $group: { _id: { $ifNull: ['$service.name', 'Unknown'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]).toArray(),

      // Bookings per staff member this month (skipped entirely on the dashboard if the
      // business has no staff — single-resource businesses shouldn't see an empty chart).
      col('bookings').aggregate([
        { $match: { status: 'confirmed', start_time: { $gte: monthStart, $lte: now }, staff_id: { $ne: null } } },
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
        } },
      ]).toArray(),
    ]);

    const revenue = revenueRows[0] ?? { revenue: 0, count: 0 };
    const prevRevenue = prevRevenueRows[0] ?? { revenue: 0 };
    const callsByPeriod = Object.fromEntries(callRows.map((r) => [r._id, r]));
    const calls = callsByPeriod.current ?? { total: 0, booked: 0, transferred: 0 };
    const prevCalls = callsByPeriod.previous ?? { total: 0, booked: 0, transferred: 0 };
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

    return {
      revenueThisMonth: revenue.revenue,
      revenueTrendPct: trendPct(revenue.revenue, prevRevenue.revenue),
      bookingsThisMonth: revenue.count,
      daily,
      topServices: serviceRows.map((r) => ({ name: r._id, count: r.count })),
      byStaff: staffRows.map((r) => ({ name: r._id, count: r.count })),
      calls: {
        total: calls.total,
        booked: calls.booked,
        transferred: calls.transferred,
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
