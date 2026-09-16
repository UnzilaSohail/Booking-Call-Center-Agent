// Self-check for the one thing this whole plan depends on: two callers can never book
// the same slot. Requires MONGODB_URI to point at a migrated, replica-set-enabled
// deployment (npm run migrate first) — skips cleanly if it's not set.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, getDb, newId } from '../src/db.js';
import { createBooking } from '../src/services/bookingService.js';

test('overlapping bookings for the same slot: only one wins', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  const serviceId = newId();
  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__', timezone: 'UTC', hours: [], google_calendar_id: 'primary', reschedule_cutoff_minutes: 120 });
  await db.collection('services').insertOne({ _id: serviceId, business_id: businessId, name: 'haircut', duration_minutes: 30, buffer_minutes: 0 });

  try {
    const startTime = '2030-01-01T10:00:00.000Z';
    const attempt = (i) =>
      createBooking(businessId, { customerName: 'a', phone: '123', serviceId, startTime, idempotencyKey: `test-${i}` });

    const results = await Promise.allSettled([attempt(1), attempt(2)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'exactly one concurrent booking should succeed');
    assert.equal(rejected.length, 1, 'the other should be rejected');
    assert.equal(rejected[0].reason.status, 409, 'rejection should be a slot conflict (409), not something else');
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('services').deleteOne({ _id: serviceId });
    await db.collection('bookings').deleteMany({ business_id: businessId });
    await db.collection('booking_slot_locks').deleteMany({ business_id: businessId });
    await client.close();
  }
});
