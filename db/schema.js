// Mongo has no CREATE TABLE — this is the equivalent one-shot setup script: indexes
// that stand in for what Postgres gave us for free (db/schema.sql in the previous
// version of this file). Two of these directly replace a Postgres guarantee that has
// no built-in Mongo equivalent:
//
//  - bookings' (business_id, idempotency_key) unique index is the same idempotent-retry
//    guard as before (plan.md §5) — partialFilterExpression skips it for docs where the
//    field is absent (dashboard bookings never set one), matching Postgres's "unique
//    constraints don't dedupe NULLs" behavior.
//  - There is no equivalent of Postgres's EXCLUDE USING gist for "no two overlapping
//    bookings." That guarantee now lives in booking_slot_locks (see
//    src/services/bookingService.js): a booking is decomposed into 5-minute slot
//    documents whose _id is deterministic (`business_id:staffKey:slotStart`), inserted
//    in the same transaction as the booking. Two concurrent overlapping bookings collide
//    on that _id and Mongo's default unique _id index rejects the loser — this file just
//    needs the collection to exist, no extra index required.
export async function ensureIndexes(db) {
  // partialFilterExpression, not `sparse` — a plain sparse index still indexes (and
  // therefore uniquely constrains) an explicit `null`, and every business starts with
  // no phone number, so many docs would collide on that null the moment a second one
  // signed up. This only indexes documents where the field is an actual string.
  await db.collection('businesses').createIndex(
    { phone_number: 1 },
    { unique: true, partialFilterExpression: { phone_number: { $type: 'string' } } }
  );

  await db.collection('admins').createIndex({ email: 1 }, { unique: true });
  await db.collection('admins').createIndex({ business_id: 1 });

  // Platform admins register companies (src/routes/platform.js) — a separate collection
  // from company admins, not scoped to any business_id.
  await db.collection('platform_admins').createIndex({ email: 1 }, { unique: true });

  await db.collection('services').createIndex({ business_id: 1 });
  await db.collection('staff').createIndex({ business_id: 1 });

  await db.collection('bookings').createIndex({ business_id: 1, start_time: 1 });
  await db.collection('bookings').createIndex({ business_id: 1, phone: 1 });
  await db.collection('bookings').createIndex(
    { business_id: 1, idempotency_key: 1 },
    { unique: true, partialFilterExpression: { idempotency_key: { $exists: true } } }
  );
  // Polled by the calendar sync worker and the reminder cron (src/calendar/sync-worker.js,
  // src/notifications/reminder-worker.js) — partial index keeps those scans cheap.
  await db.collection('bookings').createIndex(
    { sync_status: 1 },
    { partialFilterExpression: { status: 'confirmed', sync_status: { $in: ['pending', 'failed'] } } }
  );
  await db.collection('bookings').createIndex(
    { start_time: 1 },
    { partialFilterExpression: { status: 'confirmed', reminder_24h_sent_at: null } }
  );

  // No secondary index needed on booking_slot_locks — the collision guard IS the
  // default unique index on _id, and lookups are always by business_id/booking_id via
  // an explicit filter, not a scan.
  await db.collection('booking_slot_locks').createIndex({ booking_id: 1 });

  await db.collection('call_logs').createIndex({ business_id: 1, created_at: 1 });
  await db.collection('call_logs').createIndex(
    { call_sid: 1 },
    { unique: true, partialFilterExpression: { call_sid: { $type: 'string' } } }
  );
  // Customer-profile call history lookup (src/services/customerService.js) — every other
  // index on this collection is time-ordered, none are by phone.
  await db.collection('call_logs').createIndex({ business_id: 1, phone: 1 });

  // Location records (self-signup + Settings) — address/contact display only, no
  // booking/call-routing logic depends on this yet (see routes/locations.js).
  await db.collection('locations').createIndex({ business_id: 1 });

  // Voice-agent captures (src/voice/tools.js) — a structured message/request instead of
  // an audio recording, so these are just business-scoped, time-ordered lists.
  await db.collection('voicemails').createIndex({ business_id: 1, created_at: 1 });
  await db.collection('callback_requests').createIndex({ business_id: 1, created_at: 1 });

  // Knowledge-base publish history (src/routes/knowledge.js) — append-only, newest first.
  await db.collection('knowledge_versions').createIndex({ business_id: 1, version: -1 });

  // Staff breaks/time-off (src/routes/config.js) — looked up per staff member, time-ordered.
  await db.collection('staff_time_off').createIndex({ business_id: 1, staff_id: 1, start_time: 1 });

  // Customer records (src/services/customerService.js) — phone is the dedupe key every
  // other phone-keyed lookup in this schema (bookings, call_logs) already relies on.
  await db.collection('customers').createIndex({ business_id: 1, phone: 1 }, { unique: true });
}
