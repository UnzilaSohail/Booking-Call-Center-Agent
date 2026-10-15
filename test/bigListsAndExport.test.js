// AIN-506: the data export is streamed (still one valid JSON file), the platform company list is paged, and the
// platform Overview's heavy sum is remembered for a minute.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId, ensurePlatformAdmin } from './support/tenantFixture.js';
import { app } from '../src/app.js';

describe('big lists and the export', { skip }, () => {
  let db; let server; let base; let t; let ownerToken; let platformToken;
  const adminId = newId();
  const get = (path, token) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__bigexport__' });
    await db.collection('admins').insertOne({ _id: adminId, business_id: t.businessId, name: 'Owner', email: `big-${adminId.slice(0, 8)}@example.test`, password_hash: 'x', role: 'owner', status: 'active', created_at: new Date() });
    await db.collection('call_logs').insertMany(Array.from({ length: 25 }, (_, i) => ({ _id: newId(), business_id: t.businessId, call_sid: `CAx${i}`, phone: '+15550000000', transcript: [{ role: 'caller', text: `hello "quoted"   ${i}` }], outcome: 'completed', created_at: new Date() })));
    ownerToken = jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await ensurePlatformAdmin();
    platformToken = jwt.sign({ role: 'platform', platformAdminId: 'p1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('admins').deleteMany({ _id: adminId });
    await dropTenants(t.businessId);
  });

  it('BL-01 the export is one valid JSON document with every collection and all rows', async () => {
    const res = await get('/api/business/export', ownerToken);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /export\.json/);
    const data = JSON.parse(await res.text());
    for (const name of ['services', 'staff', 'bookings', 'customers', 'call_logs', 'failed_bookings', 'voicemails', 'callback_requests', 'staff_time_off', 'waitlist']) {
      assert.ok(Array.isArray(data[name]), `${name} is a list`);
    }
    assert.equal(data.call_logs.length, 25);
    assert.equal(data.business.id ?? data.business._id, t.businessId);
    assert.ok(data.services.length > 0);
  });

  it('BL-02 the platform company list is paged by limit and skip', async () => {
    const all = await (await get('/api/platform/businesses?limit=1000', platformToken)).json();
    assert.ok(all.length >= 1);
    const one = await (await get('/api/platform/businesses?limit=1', platformToken)).json();
    assert.equal(one.length, 1);
    // (other test files add companies at the same time, so only sizes are compared, not which company is where)
    assert.equal((await (await get('/api/platform/businesses?limit=2', platformToken)).json()).length, Math.min(2, all.length));
    assert.deepEqual(await (await get('/api/platform/businesses?skip=1000000', platformToken)).json(), []);
  });

  it('BL-03 the Overview answers twice in a row (the second time from the one-minute memory)', async () => {
    const first = await get('/api/platform/analytics', platformToken);
    assert.equal(first.status, 200);
    const a = await first.json();
    const b = await (await get('/api/platform/analytics', platformToken)).json();
    assert.deepEqual(b.impact, a.impact);
  });
});
