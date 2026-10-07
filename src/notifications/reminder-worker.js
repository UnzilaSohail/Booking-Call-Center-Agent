// Cron-style poller (plan.md §6 "No-shows: reminder job 24h/1h before start_time",
// §8 phase 5). Runs as a plain interval rather than a queue — reminder volume never
// needs more than "check every few minutes," per plan.md §8's "simple job queue" note.
import { getDb, withTenant, withSystemAccess, serialize } from '../db.js';
import { sendReminder } from './notify.js';
import { runReviewSweepOnce } from '../services/reviewService.js';

const WINDOW_MINUTES = 10; // catch bookings whose 24h/2h mark falls within this tick's window

// Cross-tenant by nature — sweeps every business's upcoming bookings in one pass (see
// withSystemAccess in src/db.js). sendReminder below re-scopes per booking.
// businessIds: tests pass their own business so parallel test files cannot claim each other's bookings. Normal runs: all.
async function dueBookings(hoursAhead, sentField, businessIds) {
  const now = Date.now();
  const from = new Date(now + (hoursAhead * 60 - WINDOW_MINUTES) * 60_000);
  const to = new Date(now + hoursAhead * 60 * 60_000);
  // is_test excluded — an onboarding test-call booking must never trigger a real reminder
  // SMS/email to whatever number/address was used while testing.
  return withSystemAccess((c) =>
    c('bookings')
      .find({ status: 'confirmed', is_test: { $ne: true }, [sentField]: null, start_time: { $gte: from, $lte: to }, ...(businessIds ? { business_id: { $in: businessIds } } : {}) })
      .limit(100)
      .toArray()
  );
}

async function runLabel(hoursAhead, sentField, label, send, businessIds) {
  const bookings = await dueBookings(hoursAhead, sentField, businessIds);
  const db = await getDb();
  for (const booking of bookings) {
    // KG-13/27j: claim the booking atomically BEFORE sending. The sweep used to find-then-send, so
    // two sweeps overlapping (a second PM2 process, or a slow tick) both texted the customer. Only
    // the one whose update matches (field still null) goes on; the rest skip.
    const claim = await withSystemAccess((c) => c('bookings').updateOne({ _id: booking._id, [sentField]: null }, { $set: { [sentField]: new Date() } }));
    if (claim.modifiedCount === 0) continue;
    try {
      const business = serialize(await db.collection('businesses').findOne({ _id: booking.business_id }));
      const service = await withTenant(booking.business_id, (c) => c('services').findOne({ _id: booking.service_id }));
      await send(business, booking, service, label);
    } catch (err) {
      console.error(`reminder (${label}) failed for booking ${booking._id}:`, err.message);
      // Give the claim back so the next sweep retries, instead of silently never reminding.
      await withSystemAccess((c) => c('bookings').updateOne({ _id: booking._id }, { $set: { [sentField]: null } })).catch(() => {});
    }
  }
}

// `send` is injectable so tests can count sends without a real SMS/email provider.
export async function runReminderSweepOnce({ send = sendReminder, businessIds } = {}) {
  await runLabel(24, 'reminder_24h_sent_at', '24h', send, businessIds);
  await runLabel(2, 'reminder_2h_sent_at', '2h', send, businessIds);
}

export function startReminderWorker(intervalMs = 5 * 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runReminderSweepOnce();
      await runReviewSweepOnce(); // "how was your visit" texts (src/services/reviewService.js)
    } catch (err) {
      console.error('reminder worker tick failed:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
