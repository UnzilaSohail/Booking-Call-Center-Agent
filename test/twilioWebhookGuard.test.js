// Signed inbound-call webhook: a suspended business gets the "not set up" message instead of an AI call; an active one
// gets the media stream with its signed token (Jira 52l, 52a). Real database; signatures computed like Twilio does.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import twilio from 'twilio';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';

process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_ACCOUNT_SID = ''; // no real Twilio client (recording start) from a test
process.env.PUBLIC_HTTPS_URL = 'https://example.test';
const { app } = await import('../src/app.js');

describe('inbound call webhook', { skip }, () => {
  let db; let server; let base; let active; let suspended;
  const post = (to, signed = true) => {
    const params = { To: to, From: '+15550900002', CallSid: `CA${newId()}` };
    const sig = twilio.getExpectedTwilioSignature('test-token', 'https://example.test/voice/incoming', params);
    return fetch(`${base}/voice/incoming`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(signed ? { 'x-twilio-signature': sig } : {}) }, body: new URLSearchParams(params).toString(),
    });
  };

  before(async () => {
    db = await getDb();
    active = await createTenant({ name: '__hook_active__' });
    suspended = await createTenant({ name: '__hook_suspended__' });
    await db.collection('businesses').updateOne({ _id: active.businessId }, { $set: { phone_number: '+15550900011' } });
    await db.collection('businesses').updateOne({ _id: suspended.businessId }, { $set: { phone_number: '+15550900012', status: 'suspended' } });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('call_logs').deleteMany({ business_id: { $in: [active.businessId, suspended.businessId] } });
    await dropTenants(active.businessId, suspended.businessId);
  });

  it('WH-01 an unsigned request is refused', async () => {
    assert.equal((await post('+15550900011', false)).status, 403);
  });

  it('WH-02 an active business gets the media stream, carrying a signed token', async () => {
    const xml = await (await post('+15550900011')).text();
    assert.match(xml, /<Stream/);
    assert.match(xml, /name="streamToken"/);
  });

  it('WH-03 a suspended business gets the "not set up" message and no AI call', async () => {
    const xml = await (await post('+15550900012')).text();
    assert.match(xml, /not currently set up/);
    assert.doesNotMatch(xml, /<Stream/);
  });
});
