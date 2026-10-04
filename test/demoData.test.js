// Demo data (src/services/demoData.js): it fills a believable product, never double-books, is repeatable, and
// removing it leaves real businesses alone. Docs: docs/testing/TEST_CASES.md group DD.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { signCustomerToken } from '../src/customerAuth.js';
import { addDemoData, removeDemoData, demoStatus } from '../src/services/demoData.js';

describe('demo data', { skip }, () => {
  let db;
  let real;

  before(async () => {
    db = await getDb();
    real = await createTenant({ name: `Real ${newId().slice(0, 6)}` });
  });
  after(async () => {
    await removeDemoData();
    await dropTenants(real.businessId);
  });

  it('adds busy, unlisted demo businesses with their own password (DD-1)', async () => {
    const r = await addDemoData({ listed: false });
    assert.ok(r.password.length >= 10);
    assert.ok(r.counts.bookings > 250 && r.counts.calls > 100 && r.counts.customers >= 30, JSON.stringify(r.counts));
    const businesses = await db.collection('businesses').find({ demo: true }).toArray();
    assert.ok(businesses.length >= 6);
    assert.ok(businesses.every((b) => b.listing?.listed !== true), 'unlisted unless asked');
    assert.equal((await demoStatus()).present, true);
  });

  it('never double-books a staff member (DD-2)', async () => {
    const glow = (await db.collection('businesses').findOne({ demo: true, slug: 'glow-studio' }))._id;
    const rows = await db.collection('bookings').find({ business_id: glow, status: 'confirmed' }).sort({ start_time: 1 }).toArray();
    const lastEnd = new Map();
    for (const b of rows) {
      const prev = lastEnd.get(b.staff_id);
      assert.ok(!prev || prev <= b.start_time, `overlap for staff ${b.staff_id} at ${b.start_time.toISOString()}`);
      lastEnd.set(b.staff_id, b.end_time);
    }
  });

  it('can be added again without piling up (DD-3)', async () => {
    const before = await db.collection('businesses').countDocuments({ demo: true });
    await addDemoData({ listed: false });
    assert.equal(await db.collection('businesses').countDocuments({ demo: true }), before);
  });

  it('removing it deletes demo data only (DD-4)', async () => {
    const ids = (await db.collection('businesses').find({ demo: true }, { projection: { _id: 1 } }).toArray()).map((b) => b._id);
    await removeDemoData();
    assert.equal(await db.collection('businesses').countDocuments({ demo: true }), 0);
    for (const c of ['bookings', 'call_logs', 'customers', 'invoices', 'booking_slot_locks', 'admins']) {
      assert.equal(await db.collection(c).countDocuments({ business_id: { $in: ids } }), 0, `${c} left behind`);
    }
    assert.ok(await db.collection('businesses').findOne({ _id: real.businessId }), 'a real business must survive');
  });

  it('only a platform admin can use the demo-data endpoints (DD-5)', async () => {
    const server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/platform/demo-data`;
    const owner = jwt.sign({ role: 'business', adminId: 'a1', businessId: real.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const expired = jwt.sign({ role: 'platform', platformAdminId: 'p1' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const tokens = { none: undefined, garbage: 'x.y.z', businessOwner: owner, customer: signCustomerToken(real.businessId, 'c1'), expiredPlatform: expired };
    try {
      for (const [who, token] of Object.entries(tokens)) {
        for (const method of ['GET', 'POST', 'DELETE']) {
          const r = await fetch(base, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === 'POST' ? '{}' : undefined });
          assert.ok([401, 403].includes(r.status), `${who} ${method} got ${r.status}`);
        }
      }
      assert.equal(await db.collection('businesses').countDocuments({ demo: true }), 0, 'nothing may have been created');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
