// Monthly report email to the owner (Jira 41): last month in a handful of plain numbers. Sent once, in the first days
// of the month, to the business's contact email, unless the owner turned it off in Settings.
import { DateTime } from 'luxon';
import { getDb, withTenant } from '../db.js';
import { sendEmail } from '../notifications/email.js';
import { getImpact } from './analyticsService.js';

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// from/to are dates (to is exclusive). Everything the email says comes from here.
export async function buildMonthlyReport(businessId, from, to) {
  const [counts, impact] = await Promise.all([
    withTenant(businessId, async (col) => {
      const [calls, booked, bookingRows, cancelled, newCustomers, topServiceRows] = await Promise.all([
        col('call_logs').countDocuments({ created_at: { $gte: from, $lt: to }, is_test: { $ne: true } }),
        col('call_logs').countDocuments({ created_at: { $gte: from, $lt: to }, is_test: { $ne: true }, booking_id: { $ne: null, $exists: true } }),
        col('bookings').aggregate([
          { $match: { status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: from, $lt: to } } },
          { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 's' } },
          { $unwind: { path: '$s', preserveNullAndEmptyArrays: true } },
          { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$s.price', 0] } } } },
        ]).toArray(),
        col('bookings').countDocuments({ status: 'cancelled', is_test: { $ne: true }, start_time: { $gte: from, $lt: to } }),
        col('customers').countDocuments({ created_at: { $gte: from, $lt: to } }),
        col('bookings').aggregate([
          { $match: { status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: from, $lt: to } } },
          { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 's' } },
          { $unwind: { path: '$s', preserveNullAndEmptyArrays: true } },
          { $group: { _id: '$s.name', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 1 },
        ]).toArray(),
      ]);
      return { calls, booked, bookings: bookingRows[0]?.count ?? 0, revenue: bookingRows[0]?.revenue ?? 0, cancelled, newCustomers, topService: topServiceRows[0]?._id ?? null };
    }),
    getImpact(businessId, from, to),
  ]);
  return { ...counts, impact };
}

export function formatReport(business, stats, label) {
  const { impact } = stats;
  const lines = [
    `${business.name}: your ${label} at a glance`, '',
    `Calls answered by the AI receptionist: ${stats.calls}`,
    `  turned into bookings: ${stats.booked}${stats.calls ? ` (${Math.round((stats.booked / stats.calls) * 100)}%)` : ''}`,
    `Bookings: ${stats.bookings}${stats.topService ? ` (most popular: ${stats.topService})` : ''}`,
    `Booked value: ${money(stats.revenue)}`,
    `New customers: ${stats.newCustomers}`,
    `Cancellations: ${stats.cancelled}`, '',
  ];
  if (impact.afterHours.calls) lines.push(`While you were closed: the AI answered ${plural(impact.afterHours.calls, 'call')} and made ${plural(impact.afterHours.bookings, 'booking')} worth ${money(impact.afterHours.value)}. Without it those callers would have reached voicemail.`);
  if (impact.reminders.sent) lines.push(`Reminders: ${impact.reminders.sent} sent. ${plural(impact.reminders.cancelledInTime, 'customer')} cancelled in time after a reminder (${money(impact.reminders.valueFreed)} of time you could re-book instead of an empty chair).`);
  if (impact.reminders.waitlistRefilled) lines.push(`Waiting list: ${plural(impact.reminders.waitlistRefilled, 'freed-up slot')} filled by someone who was waiting.`);
  lines.push('', 'You can turn this email off in Settings > Business > Monthly report.');
  return { subject: `${business.name}: your ${label}`, text: lines.join('\n') };
}

// Day 1 to 3 of a month, from 9am business time: send last month's report once per business. `send` is injectable for tests.
export async function runMonthlyReportSweepOnce({ send = sendEmail, now = DateTime.now() } = {}) {
  const db = await getDb();
  const businesses = await db.collection('businesses').find({ status: 'active', onboarding_completed_at: { $ne: null }, monthly_report_enabled: { $ne: false }, contact_email: { $type: 'string' } }).toArray();
  let sent = 0;
  for (const b of businesses) {
    const local = now.setZone(b.timezone || 'UTC');
    if (local.day > 3 || local.hour < 9) continue;
    const start = local.minus({ months: 1 }).startOf('month');
    const key = start.toFormat('yyyy-LL');
    if (b.monthly_report_sent_for === key) continue;
    // claim first (atomic), so overlapping sweeps send one email
    const claim = await db.collection('businesses').updateOne({ _id: b._id, monthly_report_sent_for: { $ne: key } }, { $set: { monthly_report_sent_for: key } });
    if (claim.modifiedCount === 0) continue;
    try {
      const stats = await buildMonthlyReport(b._id, start.toUTC().toJSDate(), start.plus({ months: 1 }).toUTC().toJSDate());
      if (!stats.calls && !stats.bookings) continue; // a quiet month: nothing worth an email
      const { subject, text } = formatReport(b, stats, start.toFormat('LLLL yyyy'));
      await send(b.contact_email, subject, text);
      sent++;
    } catch (err) {
      console.error(`monthly report failed for ${b._id}:`, err.message);
      await db.collection('businesses').updateOne({ _id: b._id }, { $unset: { monthly_report_sent_for: '' } }).catch(() => {}); // try again on the next sweep
    }
  }
  return sent;
}

export function startMonthlyReportWorker(intervalMs = 60 * 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runMonthlyReportSweepOnce(); } catch (err) { console.error('monthly report worker tick failed:', err); } finally { running = false; }
  }, intervalMs);
  return () => clearInterval(timer);
}
