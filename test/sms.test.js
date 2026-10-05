// sendSms must never throw — a real Twilio rejection (bad number, Geo Permissions, A2P
// 10DLC) used to crash straight out of here, which turned into a raw 500 for any caller
// that didn't wrap its own try/catch (src/routes/onboarding.js verify/send was the one
// that didn't — see docs/testing/KNOWN_GAPS.md KG-19 for the real-world case).
//
// Twilio's module-level config (src/notifications/sms.js) is read once at import time, so
// this can't fake a provider the way other tests do — it uses whatever's already in the
// environment (real creds if configured, none otherwise) and relies on a malformed "to"
// value to force a rejection either way: Twilio itself rejects it with a 400 (no message
// sent, no cost) if real credentials are loaded; with no credentials at all, sendSms
// short-circuits to null before ever reaching Twilio, which is also a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendSms } from '../src/notifications/sms.js';
import { createTenant, dropTenants, skip, getDb } from './support/tenantFixture.js';

test('sendSms returns null instead of throwing on a rejected request', async () => {
  const result = await sendSms(null, 'not-a-real-phone-number', 'test');
  assert.equal(result, null);
});

// A tenant's own number (the same one its customers call) should be looked up and used
// as the sender — not a single platform-wide number shared across every business — so this
// just needs to confirm the new DB lookup path doesn't break the existing never-throws
// guarantee, for a business that has its own number as well as one that doesn't.
test('sendSms still never throws when resolving a business-specific sending number', { skip }, async () => {
  const t = await createTenant({ name: '__sms_from__' });
  const db = await getDb();
  await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { phone_number: '+15559998888' } });
  try {
    const withOwnNumber = await sendSms(t.businessId, 'not-a-real-phone-number', 'test');
    assert.equal(withOwnNumber, null);

    await db.collection('businesses').updateOne({ _id: t.businessId }, { $unset: { phone_number: '' } });
    const withoutOwnNumber = await sendSms(t.businessId, 'not-a-real-phone-number', 'test');
    assert.equal(withoutOwnNumber, null, 'falls back to the platform number (or null if that is unset too) without crashing');
  } finally {
    await dropTenants(t.businessId);
  }
});
