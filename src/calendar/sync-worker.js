// Phase 3 (plan.md §8): pushes confirmed/cancelled bookings to Google Calendar out of
// band. Booking already succeeded in the DB before this runs — a failure here never
// fails a booking, it just leaves sync_status='failed' for the next tick to retry.
import { getDb, withTenant, withSystemAccess, serialize } from '../db.js';
import { createEvent, updateEvent, deleteEvent } from './google.js';

const MAX_ATTEMPTS = 10;

async function calendarIdFor(c, business, staffId) {
  if (staffId) {
    const staff = await c('staff').findOne({ _id: staffId });
    if (staff?.google_calendar_id) return staff.google_calendar_id;
  }
  return business.google_calendar_id;
}

// Every query here runs scoped to the one business this booking belongs to (the
// application-layer tenant boundary — see withTenant in src/db.js), even though the
// caller (runSyncOnce) found this booking via a cross-tenant scan.
async function syncOne(booking) {
  const db = await getDb();
  const businessDoc = await db.collection('businesses').findOne({ _id: booking.business_id });
  const business = serialize(businessDoc);

  await withTenant(booking.business_id, async (c) => {
    if (!business.google_refresh_token) {
      await c('bookings').updateOne({ _id: booking._id }, { $set: { sync_status: 'skipped' } });
      return;
    }

    try {
      const calendarId = await calendarIdFor(c, business, booking.staff_id);

      if (booking.status === 'cancelled') {
        if (booking.google_event_id) await deleteEvent(business, calendarId, booking.google_event_id);
        await c('bookings').updateOne({ _id: booking._id }, { $set: { sync_status: 'synced' } });
        return;
      }

      const service = await c('services').findOne({ _id: booking.service_id });

      if (booking.google_event_id) {
        await updateEvent(business, calendarId, booking.google_event_id, booking, service);
      } else {
        const eventId = await createEvent(business, calendarId, booking, service);
        await c('bookings').updateOne({ _id: booking._id }, { $set: { google_event_id: eventId } });
      }
      await c('bookings').updateOne({ _id: booking._id }, { $set: { sync_status: 'synced' } });
    } catch (err) {
      console.error(`calendar sync failed for booking ${booking._id}:`, err.message);
      await c('bookings').updateOne(
        { _id: booking._id },
        { $set: { sync_status: 'failed', sync_error: String(err.message ?? err).slice(0, 500) }, $inc: { sync_attempts: 1 } }
      );
    }
  });
}

export async function runSyncOnce() {
  // Cross-tenant by nature — this scans every business's pending bookings in one pass
  // (see withSystemAccess in src/db.js). Individual updates above stay tenant-scoped.
  const pending = await withSystemAccess((c) =>
    c('bookings')
      .find({ sync_status: { $in: ['pending', 'failed'] }, sync_attempts: { $lt: MAX_ATTEMPTS } })
      .sort({ created_at: 1 })
      .limit(50)
      .toArray()
  );
  for (const booking of pending) {
    await syncOne(booking);
  }
  return pending.length;
}

export function startSyncWorker(intervalMs = 15_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // don't overlap ticks if a batch runs long
    running = true;
    try {
      await runSyncOnce();
    } catch (err) {
      console.error('sync worker tick failed:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
