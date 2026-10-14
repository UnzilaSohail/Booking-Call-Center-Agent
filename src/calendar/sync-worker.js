// Phase 3 (plan.md §8): pushes confirmed/cancelled bookings to Google Calendar out of
// band. Booking already succeeded in the DB before this runs — a failure here never
// fails a booking. A failed push stays 'pending' and is retried with a growing wait (a Google outage of
// a couple of hours is survived); only when every attempt is used does it become 'failed', which is what
// puts it in the owner's Exceptions list.
import { getDb, withTenant, withSystemAccess, serialize } from '../db.js';
import { createEvent, updateEvent, deleteEvent } from './google.js';

const MAX_ATTEMPTS = 10;

// 30s, 1m, 2m ... capped at 30 minutes: all 10 attempts span about two hours.
export const backoffMs = (attempts) => Math.min(15_000 * 2 ** attempts, 30 * 60_000);
const realCalendar = { createEvent, updateEvent, deleteEvent };

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
async function syncOne(booking, { createEvent, updateEvent, deleteEvent }) {
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
      const attempts = (booking.sync_attempts ?? 0) + 1;
      await c('bookings').updateOne(
        { _id: booking._id },
        { $set: {
          sync_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          sync_error: String(err.message ?? err).slice(0, 500),
          sync_attempts: attempts,
          next_retry_at: new Date(Date.now() + backoffMs(attempts)),
        } }
      );
    }
  });
}

// calendar and businessIds are for tests (a fake Google, and only their own business so parallel test files
// cannot claim each other's bookings). Normal runs: real Google, every business.
export async function runSyncOnce({ calendar = realCalendar, businessIds } = {}) {
  // Cross-tenant by nature — this scans every business's pending bookings in one pass
  // (see withSystemAccess in src/db.js). Individual updates above stay tenant-scoped.
  const pending = await withSystemAccess((c) =>
    c('bookings')
      .find({
        sync_status: { $in: ['pending', 'failed'] },
        sync_attempts: { $lt: MAX_ATTEMPTS },
        $or: [{ next_retry_at: null }, { next_retry_at: { $lte: new Date() } }], // null also matches a booking never tried
        ...(businessIds ? { business_id: { $in: businessIds } } : {}),
      })
      .sort({ created_at: 1 })
      .limit(50)
      .toArray()
  );
  for (const booking of pending) {
    await syncOne(booking, calendar);
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
