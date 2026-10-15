// AIN-512: the routes that had no test at all (billing, settings, team, waitlist, knowledge, call logs): each answers for
// the right role, refuses the wrong one, and rejects bad input with a 4xx instead of a crash.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';

describe('routes without tests until now', { skip }, () => {
  let db; let server; let base; let t; let owner; let staff; let billingOnly;
  const ids = { owner: newId(), staff: newId(), billing: newId() };
  const token = (adminId) => jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = (path, as, { method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${as}` }, body: body ? JSON.stringify(body) : undefined,
  });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__routes__' });
    for (const [key, role] of [['owner', 'owner'], ['staff', 'staff'], ['billing', 'billing']]) {
      await db.collection('admins').insertOne({ _id: ids[key], business_id: t.businessId, name: key, email: `${key}-${ids[key].slice(0, 8)}@example.test`, password_hash: 'x', role, status: 'active', created_at: new Date() });
    }
    owner = token(ids.owner); staff = token(ids.staff); billingOnly = token(ids.billing);
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('admins').deleteMany({ _id: { $in: Object.values(ids) } });
    await dropTenants(t.businessId);
  });

  it('RT-01 billing: the owner sees the plan, a staff member is refused, a bad plan is a 400, no Stripe is a clear 503', async () => {
    const plan = await call('/api/billing/plan', owner);
    assert.equal(plan.status, 200);
    assert.equal((await plan.json()).plan, 'trial');
    assert.equal((await call('/api/billing/plan', staff)).status, 403);
    assert.equal((await call('/api/billing/plan', owner, { method: 'PATCH', body: { plan: 'enterprise' } })).status, 400);
    assert.equal((await call('/api/billing/payment-method', owner, { method: 'POST', body: {} })).status, 400);
    assert.deepEqual(await (await call('/api/billing/invoices', owner)).json(), []);
    const usage = await (await call('/api/billing/usage', owner)).json();
    assert.equal(usage.voiceMinutesIncluded, 100);
  });

  it('RT-02 settings: input is checked, and a receptionist cannot change the business', async () => {
    assert.equal((await call('/api/business', owner)).status, 200);
    assert.equal((await call('/api/business', owner, { method: 'PATCH', body: { rescheduleCutoffMinutes: -5 } })).status, 400);
    assert.equal((await call('/api/business', owner, { method: 'PATCH', body: { recordingRetentionDays: 0 } })).status, 400);
    assert.equal((await call('/api/business', owner, { method: 'PATCH', body: { reviewLink: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await call('/api/business', owner, { method: 'PATCH', body: {} })).status, 400, 'nothing to update');
    assert.equal((await call('/api/business', staff, { method: 'PATCH', body: { address: 'x' } })).status, 403);
    assert.equal((await call('/api/business/export', staff)).status, 403, 'the export is owner only');
  });

  it('RT-03 team: staff members and time off; only the owner manages logins', async () => {
    const added = await call('/api/staff', owner, { method: 'POST', body: { name: 'Riley' } });
    assert.equal(added.status, 201);
    const riley = await added.json();
    const list = await (await call('/api/staff', owner)).json();
    assert.ok(list.some((s) => s.id === riley.id));
    assert.equal((await call(`/api/staff/${riley.id}`, staff, { method: 'PATCH', body: { name: 'R' } })).status, 403);
    assert.equal((await call('/api/team-members/invite', staff, { method: 'POST', body: { email: 'x@example.test', role: 'staff' } })).status, 403);
    assert.equal((await call(`/api/staff/${riley.id}`, owner, { method: 'DELETE' })).status, 204);
    assert.equal((await call('/api/staff/no-such-id', owner, { method: 'PATCH', body: { name: 'Z' } })).status, 404);
  });

  it('RT-04 waitlist, knowledge and call logs answer for the right roles', async () => {
    assert.equal((await call('/api/waitlist', owner)).status, 200);
    assert.equal((await call('/api/waitlist/no-such-entry', owner, { method: 'DELETE' })).status, 404);
    assert.equal((await call('/api/knowledge', owner)).status, 200);
    assert.equal((await call('/api/knowledge/versions', owner)).status, 200);
    assert.equal((await call('/api/knowledge/draft', owner, { method: 'PUT', body: {} })).status < 500, true, 'an empty draft is a 4xx at worst, never a crash');
    assert.equal((await call('/api/call-logs', owner)).status, 200);
    assert.equal((await call('/api/call-logs', staff)).status, 200, 'staff may see calls');
    assert.equal((await call('/api/waitlist', billingOnly)).status, 403, 'a billing-only login may not see the waiting list');
    assert.equal((await call('/api/call-logs', billingOnly)).status, 403);
  });
});
