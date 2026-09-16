// Cron-style poller (plan.md §6 "No-shows: reminder job 24h/1h before start_time",
// §8 phase 5). Runs as a plain interval rather than a queue — reminder volume never
// needs more than "check every few minutes," per plan.md §8's "simple job queue" note.
import { getDb, withTenant, withSystemAccess, serialize } from '../db.js';
import { sendReminder } from './notify.js';

const WINDOW_MINUTES = 10; // catch bookings whose 24h/1h mark falls within this tick's window

// Cross-tenant by nature — sweeps every business's upcoming bookings in one pass (see
// withSystemAccess in src/db.js). sendReminder below re-scopes per booking.
async function dueBookings(hoursAhead, sentField) {
  const now = Date.now();
  const from = new Date(now + (hoursAhead * 60 - WINDOW_MINUTES) * 60_000);
  const to = new Date(now + hoursAhead * 60 * 60_000);
  return withSystemAccess((c) =>
    c('bookings')
      .find({ status: 'confirmed', [sentField]: null, start_time: { $gte: from, $lte: to } })
      .limit(100)
      .toArray()
  );
}

async function runLabel(hoursAhead, sentField, label) {
  const bookings = await dueBookings(hoursAhead, sentField);
  const db = await getDb();
  for (const booking of bookings) {
    try {
      const business = serialize(await db.collection('businesses').findOne({ _id: booking.business_id }));
      const service = await withTenant(booking.business_id, (c) => c('services').findOne({ _id: booking.service_id }));
      await sendReminder(business, booking, service, label);
    } catch (err) {
      console.error(`reminder (${label}) failed for booking ${booking._id}:`, err.message);
    }
  }
}

export async function runReminderSweepOnce() {
  await runLabel(24, 'reminder_24h_sent_at', '24h');
  await runLabel(1, 'reminder_1h_sent_at', '1h');
}

export function startReminderWorker(intervalMs = 5 * 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runReminderSweepOnce();
    } catch (err) {
      console.error('reminder worker tick failed:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
