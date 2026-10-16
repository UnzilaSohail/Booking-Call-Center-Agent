// AIN-564 / AIN-472: the inbound call webhook for a business whose trial is over or used up; the onboarding test-call webhook.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import twilio from 'twilio';
import { DateTime } from 'luxon';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';

process.env.TWILIO_AUTH_TOKEN = 'test-token';
process.env.TWILIO_ACCOUNT_SID = ''; // no real Twilio client (recording start) from a test
process.env.PUBLIC_HTTPS_URL = 'https://example.test';
const { app } = await import('../src/app.js');

describe('inbound call webhook: who gets an AI call', { skip }, () => {
  let db; let server; let base; let expired; let usedUp; let fine;
  const post = (path, params, query = '') => {
    const sig = twilio.getExpectedTwilioSignature('test-token', `https://example.test${path}${query}`, params);
    return fetch(`${base}${path}${query}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params).toString() });
  };
  const inbound = (to) => post('/voice/incoming', { To: to, From: '+15550900003', CallSid: `CA${newId()}` });

  before(async () => {
    db = await getDb();
    [expired, usedUp, fine] = await Promise.all(['__wh_expired__', '__wh_usedup__', '__wh_fine__'].map((name) => createTenant({ name })));
    const now = DateTime.now();
    const period = { current_period_start: now.minus({ days: 5 }).toJSDate(), current_period_end: now.plus({ days: 20 }).toJSDate() };
    await db.collection('businesses').updateOne({ _id: expired.businessId }, { $set: { phone_number: '+15550910001', plan: 'trial', trial_ends_at: now.minus({ days: 1 }).toJSDate(), ...period } });
    await db.collection('businesses').updateOne({ _id: usedUp.businessId }, { $set: { phone_number: '+15550910002', plan: 'trial', trial_ends_at: now.plus({ days: 5 }).toJSDate(), ...period } });
    await db.collection('call_logs').insertOne({ _id: newId(), business_id: usedUp.businessId, created_at: now.minus({ days: 1 }).toJSDate(), duration_seconds: 100 * 60, is_test: false });
    await db.collection('businesses').updateOne({ _id: fine.businessId }, { $set: { phone_number: '+15550910003', plan: 'starter', ...period } });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    const ids = [expired.businessId, usedUp.businessId, fine.businessId];
    await db.collection('call_logs').deleteMany({ business_id: { $in: ids } });
    await dropTenants(...ids);
  });

  it('WL-01 an ended trial without a card gets a polite refusal and no call is logged', async () => {
    const xml = await (await inbound('+15550910001')).text();
    assert.match(xml, /not available right now/);
    assert.doesNotMatch(xml, /<Stream/);
    assert.equal(await db.collection('call_logs').countDocuments({ business_id: expired.businessId }), 0);
  });

  it('WL-02 a trial that has used its free minutes gets the same', async () => {
    const xml = await (await inbound('+15550910002')).text();
    assert.match(xml, /not available right now/);
    assert.equal(await db.collection('call_logs').countDocuments({ business_id: usedUp.businessId, outcome: 'in_progress' }), 0);
  });

  it('WL-03 a paid plan is answered, the call is logged in progress, and the stream carries its token', async () => {
    const xml = await (await inbound('+15550910003')).text();
    assert.match(xml, /<Stream/);
    assert.match(xml, /name="streamToken"/);
    assert.equal(await db.collection('call_logs').countDocuments({ business_id: fine.businessId, outcome: 'in_progress' }), 1);
  });

  it('WL-04 a number nobody owns hears that it is not set up', async () => {
    const xml = await (await inbound('+15550999999')).text();
    assert.match(xml, /not currently set up/);
  });

  it('WL-05 the onboarding test-call webhook needs a signature and marks the call as a test', async () => {
    const params = { To: '+15550900004', From: '+15550910003', CallSid: `CA${newId()}` };
    const unsigned = await fetch(`${base}/voice/test-call?businessId=${fine.businessId}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    assert.equal(unsigned.status, 403);
    const xml = await (await post('/voice/test-call', params, `?businessId=${fine.businessId}`)).text();
    assert.match(xml, /<Stream/);
    const row = await db.collection('call_logs').findOne({ call_sid: params.CallSid });
    assert.equal(row.is_test, true);
  });
});
