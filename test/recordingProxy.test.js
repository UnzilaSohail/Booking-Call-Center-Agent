// Call recording playback (docs/testing/TEST_CASES.md group RP): the dashboard plays recordings
// through the backend because Twilio's URL needs Basic Auth. The URL must carry a short-lived,
// single-recording token, never the login token. A local fake "Twilio" server stands in for Twilio.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';

const AUDIO = Buffer.from('0123456789abcdefghij');

describe('call recording proxy', { skip }, () => {
  let db;
  let server;
  let twilio;
  let base;
  let t;
  let other;
  let logId;
  let noRecordingId;
  let otherLogId;
  let ownerToken;
  let seen;
  const saved = {};
  const get = (path, headers) => fetch(`${base}/api${path}`, { headers });
  const mint = (id, token = ownerToken) => fetch(`${base}/api/call-logs/${id}/recording-token`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__rec__', staff: [] });
    other = await createTenant({ name: '__rec_other__', staff: [] });
    // Fake Twilio: demands Basic auth, serves bytes, honours Range.
    twilio = createServer((req, res) => {
      seen = { url: req.url, auth: req.headers.authorization, range: req.headers.range };
      if (!req.headers.authorization?.startsWith('Basic ')) { res.writeHead(401); return res.end(); }
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : AUDIO.length - 1;
        res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${AUDIO.length}`, 'Content-Length': end - start + 1 });
        return res.end(AUDIO.subarray(start, end + 1));
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': AUDIO.length });
      res.end(AUDIO);
    });
    await new Promise((r) => twilio.listen(0, '127.0.0.1', r));
    const twilioBase = `http://127.0.0.1:${twilio.address().port}/rec`;
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) saved[k] = process.env[k];
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
    process.env.TWILIO_AUTH_TOKEN = 'secret';

    logId = newId(); noRecordingId = newId(); otherLogId = newId();
    await db.collection('call_logs').insertMany([
      { _id: logId, business_id: t.businessId, phone: '+15550600001', created_at: new Date(), recording_url: twilioBase },
      { _id: noRecordingId, business_id: t.businessId, phone: '+15550600002', created_at: new Date() },
      { _id: otherLogId, business_id: other.businessId, phone: '+15550600003', created_at: new Date(), recording_url: twilioBase },
    ]);
    const adminId = newId();
    await db.collection('admins').insertOne({ _id: adminId, business_id: t.businessId, email: `o-${adminId}@example.test`, name: 'Owner', role: 'owner', status: 'active', password_hash: 'x' });
    ownerToken = jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await new Promise((r) => server.close(r));
    await new Promise((r) => twilio.close(r));
    await db.collection('call_logs').deleteMany({ business_id: { $in: [t.businessId, other.businessId] } });
    await db.collection('admins').deleteMany({ business_id: t.businessId });
    await dropTenants(t.businessId, other.businessId);
  });

  it('RP-01 a recording token is minted behind login, for a call that has a recording', async () => {
    const res = await mint(logId);
    assert.equal(res.status, 200);
    const body = await res.json();
    const claims = jwt.verify(body.token, process.env.JWT_SECRET);
    assert.deepEqual([claims.purpose, claims.callLogId, claims.businessId], ['call-recording', logId, t.businessId]);
    assert.ok(claims.exp - claims.iat <= 15 * 60, 'short-lived');
    assert.equal((await mint(noRecordingId)).status, 404);
    assert.equal((await mint(otherLogId)).status, 404, 'another business\'s call');
    assert.equal((await fetch(`${base}/api/call-logs/${logId}/recording-token`, { method: 'POST' })).status, 401, 'no login');
  });

  it('RP-02 the audio streams through with Twilio credentials the browser never sees', async () => {
    const { token } = await (await mint(logId)).json();
    const res = await get(`/call-logs/${logId}/recording?rt=${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), AUDIO);
    assert.match(seen.url, /\.mp3$/);
    assert.equal(seen.auth, `Basic ${Buffer.from('ACfake:secret').toString('base64')}`);
  });

  it('RP-03 seeking works: a Range request is passed on and answered 206', async () => {
    const { token } = await (await mint(logId)).json();
    const res = await get(`/call-logs/${logId}/recording?rt=${token}`, { Range: 'bytes=5-9' });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 5-9/20');
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), '56789');
    assert.equal(seen.range, 'bytes=5-9');
  });

  it('RP-04 the login token no longer works as a recording link; neither does a wrong, expired or other-call token', async () => {
    assert.equal((await get(`/call-logs/${logId}/recording?token=${ownerToken}`)).status, 401, 'old ?token= style');
    assert.equal((await get(`/call-logs/${logId}/recording?rt=${ownerToken}`)).status, 401, 'a login token in the new slot');
    assert.equal((await get(`/call-logs/${logId}/recording`)).status, 401);
    const { token } = await (await mint(logId)).json();
    assert.equal((await get(`/call-logs/${noRecordingId}/recording?rt=${token}`)).status, 401, 'token is for a different call');
    const expired = jwt.sign({ purpose: 'call-recording', businessId: t.businessId, callLogId: logId }, process.env.JWT_SECRET, { expiresIn: -10 });
    assert.equal((await get(`/call-logs/${logId}/recording?rt=${expired}`)).status, 401);
    // A valid token for a call id that belongs to another business can't be forged into this one's data.
    const forged = jwt.sign({ purpose: 'call-recording', businessId: t.businessId, callLogId: otherLogId }, process.env.JWT_SECRET, { expiresIn: '5m' });
    assert.equal((await get(`/call-logs/${otherLogId}/recording?rt=${forged}`)).status, 404, 'scoped to the token\'s own business');
  });

  it('RP-05 Twilio not configured answers 503, not a crash', async () => {
    const { token } = await (await mint(logId)).json();
    delete process.env.TWILIO_ACCOUNT_SID;
    assert.equal((await get(`/call-logs/${logId}/recording?rt=${token}`)).status, 503);
    process.env.TWILIO_ACCOUNT_SID = 'ACfake';
  });
});
