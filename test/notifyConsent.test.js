// Requires MONGODB_URI pointing at a migrated, replica-set-enabled deployment — skips
// cleanly if unset, same convention as test/booking.test.js. No Twilio/SendGrid needed:
// sendSms/sendEmail already degrade to a warn-and-skip no-op when unconfigured (as they
// will be in test), which is exactly what lets this test tell "opted out" apart from
// "allowed but unconfigured" — see the field-presence assertions below.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, getDb, newId } from '../src/db.js';
import { sendBookingConfirmation } from '../src/notifications/notify.js';

test('sendBookingConfirmation respects per-customer SMS/email opt-out', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  const serviceId = newId();
  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__', timezone: 'UTC', hours: [] });
  const service = { id: serviceId, name: 'Haircut' };

  async function bookingFor(phone, email, consent) {
    const bookingId = newId();
    await db.collection('bookings').insertOne({
      _id: bookingId, business_id: businessId, customer_name: 'Test Customer', phone,
      customer_email: email, service_id: serviceId, start_time: new Date(Date.now() + 3600_000), status: 'confirmed',
    });
    if (consent) {
      await db.collection('customers').insertOne({
        _id: newId(), business_id: businessId, phone, name: 'Test Customer', email, notes: null, tags: [],
        preferences: {}, consent, created_at: new Date(), updated_at: new Date(),
      });
    }
    return bookingId;
  }

  try {
    // Opted into everything (no customer record = "not explicitly opted out"): both
    // channels get attempted, so both error-tracking fields get set (to null on success).
    const allowedId = await bookingFor('+15550001111', 'allowed@example.com', null);
    await sendBookingConfirmation({ id: businessId, name: '__test__', timezone: 'UTC' }, { id: allowedId, phone: '+15550001111', customer_email: 'allowed@example.com', start_time: new Date(Date.now() + 3600_000) }, service);
    const allowedBooking = await db.collection('bookings').findOne({ _id: allowedId });
    assert.ok('confirmation_sms_error' in allowedBooking, 'SMS should have been attempted (field present, even if null)');
    assert.ok('confirmation_email_error' in allowedBooking, 'Email should have been attempted');

    // Opted out of both: neither channel is attempted, so neither field is ever set.
    const optedOutId = await bookingFor('+15552223333', 'optedout@example.com', { recordingAcknowledged: false, smsOptIn: false, emailOptIn: false });
    await sendBookingConfirmation({ id: businessId, name: '__test__', timezone: 'UTC' }, { id: optedOutId, phone: '+15552223333', customer_email: 'optedout@example.com', start_time: new Date(Date.now() + 3600_000) }, service);
    const optedOutBooking = await db.collection('bookings').findOne({ _id: optedOutId });
    assert.equal('confirmation_sms_error' in optedOutBooking, false, 'SMS should never have been attempted for an opted-out customer');
    assert.equal('confirmation_email_error' in optedOutBooking, false, 'Email should never have been attempted for an opted-out customer');
    // confirmation_sent_at is still stamped either way — "sent" here means "processed,"
    // not "every channel actually delivered."
    assert.ok(optedOutBooking.confirmation_sent_at);
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('bookings').deleteMany({ business_id: businessId });
    await db.collection('customers').deleteMany({ business_id: businessId });
    await client.close();
  }
});
