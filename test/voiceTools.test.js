// Exercises the voice agent's tool handlers directly (bypassing Gemini entirely), same
// approach as test/booking.test.js calling createBooking directly. Requires MONGODB_URI
// pointing at a migrated, replica-set-enabled deployment — skips cleanly if unset.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, getDb, newId } from '../src/db.js';
import { createToolHandlers } from '../src/voice/tools.js';

test('leave_voicemail, request_callback and flag_emergency write the right records', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  const callSid = `test-call-${newId()}`;
  const business = { id: businessId, name: '__test__', contact_phone: null };

  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__', contact_phone: null });
  await db.collection('call_logs').insertOne({ _id: newId(), business_id: businessId, call_sid: callSid, outcome: 'in_progress', created_at: new Date() });

  const handlers = createToolHandlers(business, callSid);

  try {
    await handlers.leave_voicemail({ message: 'please call me back about rescheduling', phone: '+15550001111' });
    const voicemail = await db.collection('voicemails').findOne({ call_sid: callSid });
    assert.equal(voicemail.message, 'please call me back about rescheduling');
    assert.equal(voicemail.business_id, businessId);
    assert.equal((await db.collection('call_logs').findOne({ call_sid: callSid })).outcome, 'voicemail');

    await handlers.request_callback({ phone: '+15550001111', preferredTime: 'tomorrow morning', reason: 'wants to reschedule' });
    const callback = await db.collection('callback_requests').findOne({ call_sid: callSid });
    assert.equal(callback.reason, 'wants to reschedule');
    assert.equal(callback.preferred_time, 'tomorrow morning');
    assert.equal((await db.collection('call_logs').findOne({ call_sid: callSid })).outcome, 'callback_requested');

    await handlers.flag_emergency({ reason: 'severe pain' });
    assert.equal((await db.collection('call_logs').findOne({ call_sid: callSid })).outcome, 'emergency: severe pain');
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('call_logs').deleteMany({ business_id: businessId });
    await db.collection('voicemails').deleteMany({ business_id: businessId });
    await db.collection('callback_requests').deleteMany({ business_id: businessId });
    await client.close();
  }
});
