// Requires MONGODB_URI pointing at a migrated, replica-set-enabled deployment — skips
// cleanly if unset, same convention as test/booking.test.js. Seeds one document per
// exception type directly (not through the HTTP route — src/routes/exceptions.js's
// mutations are single $set calls, so this exercises the one part with real bug risk:
// listExceptions' merge/normalize/open-vs-resolved logic across all 7 sources) then
// applies the same field changes the PATCH/retry route handlers make and confirms the
// list reflects them.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, getDb, newId, withTenant } from '../src/db.js';
import { listExceptions } from '../src/routes/exceptions.js';

test('listExceptions merges all 7 sources, filters by status, and reacts to resolution', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  await db.collection('businesses').insertOne({ _id: businessId, name: '__exceptions_test__', timezone: 'UTC', hours: [] });

  const failedBookingId = newId();
  const callbackId = newId();
  const voicemailId = newId();
  const callLogId = newId();
  const bookingId = newId();

  try {
    await withTenant(businessId, (c) => Promise.all([
      c('failed_bookings').insertOne({
        _id: failedBookingId, phone: '+15550001111', customer_name: 'Failed Booker', service_id: 'svc-1',
        requested_start_time: new Date(), error_message: 'slot already taken', created_at: new Date(),
        status: 'open', assigned_to: null, resolved_at: null, resolved_by: null, resolution_notes: null,
      }),
      c('callback_requests').insertOne({
        _id: callbackId, call_sid: `CA-cb-${callbackId}`, phone: '+15550002222', preferred_time: null, reason: 'call me back',
        status: 'pending', created_at: new Date(), assigned_to: null, resolved_at: null, resolved_by: null, resolution_notes: null,
      }),
      c('voicemails').insertOne({
        _id: voicemailId, call_sid: `CA-vm-${voicemailId}`, phone: '+15550003333', message: 'hi call me', created_at: new Date(),
        status: 'open', assigned_to: null, resolved_at: null, resolved_by: null, resolution_notes: null,
      }),
      c('call_logs').insertOne({
        _id: callLogId, call_sid: `CA-lc-${callLogId}`, phone: '+15550004444', transcript: null, booking_id: null,
        outcome: 'transferred: not sure what they want', transfer_category: 'low_confidence', is_test: true, created_at: new Date(),
        assigned_to: null, resolved_at: null, resolved_by: null, resolution_notes: null,
      }),
      c('bookings').insertOne({
        _id: bookingId, customer_name: 'Sync Failer', phone: '+15550005555', service_id: 'svc-1',
        start_time: new Date(), end_time: new Date(), status: 'confirmed', created_at: new Date(),
        sync_status: 'failed', sync_error: 'calendar conflict', sync_attempts: 3,
        confirmation_sms_error: 'twilio down', confirmation_email_error: null,
        exceptions: {},
      }),
    ]));

    const open = await listExceptions(businessId, 'open');
    const openTypes = open.map((e) => e.type).sort();
    assert.deepEqual(openTypes, ['calendar_sync', 'callback_request', 'failed_booking', 'low_confidence_call', 'sms_delivery', 'voicemail'].sort());
    // email_delivery should NOT appear — confirmation_email_error is null on the seeded booking.
    assert.ok(!openTypes.includes('email_delivery'));

    const failedBookingEntry = open.find((e) => e.type === 'failed_booking');
    assert.equal(failedBookingEntry.summary, 'Booking failed for Failed Booker (+15550001111)');
    assert.equal(failedBookingEntry.retryable, false);

    const syncEntry = open.find((e) => e.type === 'calendar_sync');
    assert.equal(syncEntry.id, bookingId);
    assert.equal(syncEntry.retryable, true);

    // Resolve the failed_booking (flat fields) and the calendar_sync exception (nested
    // under bookings.exceptions.calendar_sync) — same field paths src/routes/
    // exceptions.js's PATCH handler writes.
    await withTenant(businessId, (c) => Promise.all([
      c('failed_bookings').updateOne({ _id: failedBookingId }, { $set: { resolved_at: new Date(), resolved_by: 'admin-1' } }),
      c('bookings').updateOne({ _id: bookingId }, { $set: { 'exceptions.calendar_sync.resolved_at': new Date(), 'exceptions.calendar_sync.resolved_by': 'admin-1' } }),
    ]));

    const afterResolve = await listExceptions(businessId, 'open');
    const afterTypes = afterResolve.map((e) => e.type).sort();
    assert.ok(!afterTypes.includes('failed_booking'), 'resolved failed_booking should drop out of the open list');
    assert.ok(!afterTypes.includes('calendar_sync'), 'resolved calendar_sync should drop out of the open list even though sync_status is still failed');
    // sms_delivery is a separate, still-unresolved failure on the same booking — it must
    // stay open independently of calendar_sync being resolved.
    assert.ok(afterTypes.includes('sms_delivery'), 'an independent still-failing exception on the same booking should remain open');

    const resolved = await listExceptions(businessId, 'resolved');
    const resolvedTypes = resolved.map((e) => e.type).sort();
    assert.deepEqual(resolvedTypes, ['calendar_sync', 'failed_booking'].sort());

    // Retry resets sync_status the same way POST /exceptions/calendar_sync/:id/retry does.
    await withTenant(businessId, (c) => c('bookings').updateOne({ _id: bookingId }, { $set: { sync_status: 'pending', sync_attempts: 0, sync_error: null } }));
    const afterRetry = await withTenant(businessId, (c) => c('bookings').findOne({ _id: bookingId }));
    assert.equal(afterRetry.sync_status, 'pending');
  } finally {
    // deleteMany isn't part of ScopedCollection's API (src/db.js only wraps the methods
    // routes actually use) — raw db.collection(...).deleteMany with an explicit
    // business_id filter is the same cleanup pattern test/notifyConsent.test.js uses.
    await db.collection('businesses').deleteOne({ _id: businessId });
    await Promise.all([
      db.collection('failed_bookings').deleteMany({ business_id: businessId }),
      db.collection('callback_requests').deleteMany({ business_id: businessId }),
      db.collection('voicemails').deleteMany({ business_id: businessId }),
      db.collection('call_logs').deleteMany({ business_id: businessId }),
      db.collection('bookings').deleteMany({ business_id: businessId }),
    ]);
    await client.close();
  }
});
