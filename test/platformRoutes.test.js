// AIN-564: the platform console's company routes: register, look up, suspend, reset a password, unlock, delete.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { skip, getDb, newId, ensurePlatformAdmin, client } from './support/tenantFixture.js';
import { app } from '../src/app.js';

describe('platform company routes', { skip }, () => {
  let db; let server; let base; let platform;
  const email = `reg-${newId().slice(0, 8)}@example.test`;
  const company = { businessName: '__platform_reg__', adminEmail: email, adminPassword: 'Correct-Horse-Battery-9', services: [{ name: 'Cut', durationMinutes: 30, bufferMinutes: 0 }] };
  let businessId; let adminId; let companyToken;
  const call = (path, { method = 'GET', token = platform, body } = {}) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });

  before(async () => {
    db = await getDb();
    await ensurePlatformAdmin();
    platform = jwt.sign({ role: 'platform', platformAdminId: 'p1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    if (businessId) {
      for (const c of ['admins', 'services', 'invoices', 'sms_sends', 'booking_slot_locks', 'bookings']) await db.collection(c).deleteMany({ business_id: businessId });
      await db.collection('businesses').deleteOne({ _id: businessId });
    }
    await client.close();
  });

  it('PR-01 only a platform login reaches these routes', async () => {
    assert.equal((await call('/api/platform/businesses', { token: null })).status, 401);
    const companyLike = jwt.sign({ role: 'business', adminId: 'x', businessId: 'y' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await call('/api/platform/businesses', { token: companyLike })).status, 401);
  });

  it('PR-02 registering a company checks its input, refuses a taken email without leaving a half-made company, and starts a trial', async () => {
    assert.equal((await call('/api/platform/businesses', { method: 'POST', body: { businessName: 'x' } })).status, 400);
    assert.equal((await call('/api/platform/businesses', { method: 'POST', body: { ...company, adminPassword: 'short' } })).status, 400);
    const ok = await call('/api/platform/businesses', { method: 'POST', body: company });
    assert.equal(ok.status, 201);
    businessId = (await ok.json()).businessId;
    const row = await db.collection('businesses').findOne({ _id: businessId });
    assert.equal(row.plan, 'trial');
    assert.ok(row.trial_ends_at > new Date());
    assert.equal(await db.collection('services').countDocuments({ business_id: businessId }), 1);
    adminId = (await db.collection('admins').findOne({ business_id: businessId }))._id;

    const before = await db.collection('businesses').countDocuments({ name: '__platform_reg_dupe__' });
    const dupe = await call('/api/platform/businesses', { method: 'POST', body: { ...company, businessName: '__platform_reg_dupe__' } });
    assert.equal(dupe.status, 409);
    assert.equal(await db.collection('businesses').countDocuments({ name: '__platform_reg_dupe__' }), before, 'the half-made company was cleaned up');
  });

  it('PR-03 a company can be looked up; an unknown one is a 404', async () => {
    const detail = await (await call(`/api/platform/businesses/${businessId}`)).json();
    assert.equal(detail.name, '__platform_reg__');
    assert.equal(detail.admins[0].email, email);
    assert.equal(detail.serviceCount, 1);
    assert.equal((await call('/api/platform/businesses/no-such-company')).status, 404);
    assert.equal((await call('/api/platform/businesses/no-such-company/billing')).status, 404);
  });

  it('PR-04 suspending a company locks its logins at once; making it active again lets them back in', async () => {
    companyToken = jwt.sign({ role: 'business', adminId, businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const me = () => call('/api/auth/me', { token: companyToken });
    assert.equal((await me()).status, 200);
    assert.equal((await call(`/api/platform/businesses/${businessId}/status`, { method: 'PATCH', body: { status: 'bogus' } })).status, 400);
    assert.equal((await call(`/api/platform/businesses/${businessId}/status`, { method: 'PATCH', body: { status: 'suspended' } })).status, 200);
    assert.equal((await me()).status, 403);
    assert.equal((await call(`/api/platform/businesses/${businessId}/status`, { method: 'PATCH', body: { status: 'active' } })).status, 200);
    assert.equal((await me()).status, 200);
  });

  it('PR-05 resetting an admin password checks strength, ends their old sessions, and unlock tells a missing admin apart', async () => {
    assert.equal((await call(`/api/platform/admins/${adminId}/password`, { method: 'PATCH', body: { newPassword: 'weak' } })).status, 400);
    assert.equal((await call('/api/platform/admins/nobody/password', { method: 'PATCH', body: { newPassword: 'Another-Strong-Pass-77' } })).status, 404);
    await new Promise((r) => setTimeout(r, 1100)); // tokens are compared in whole seconds
    assert.equal((await call(`/api/platform/admins/${adminId}/password`, { method: 'PATCH', body: { newPassword: 'Another-Strong-Pass-77' } })).status, 200);
    const old = await call('/api/auth/me', { token: companyToken });
    assert.equal(old.status, 401);
    assert.equal((await old.json()).code, 'session');
    assert.equal((await call(`/api/platform/admins/${adminId}/unlock`, { method: 'POST' })).status, 200);
    assert.equal((await call('/api/platform/admins/nobody/unlock', { method: 'POST' })).status, 404);
  });

  it('PR-06 deleting a company needs its exact name and removes everything it owned', async () => {
    await db.collection('invoices').insertOne({ _id: newId(), business_id: businessId, period_start: new Date(), status: 'paid', total_amount: 1, created_at: new Date() });
    await db.collection('sms_sends').insertOne({ _id: newId(), business_id: businessId, sid: 'SM1', sent_at: new Date() });
    await db.collection('booking_slot_locks').insertOne({ _id: `${businessId}:none:x`, business_id: businessId, booking_id: 'b' });
    assert.equal((await call(`/api/platform/businesses/${businessId}`, { method: 'DELETE', body: { confirmName: 'wrong' } })).status, 400);
    assert.equal((await call('/api/platform/businesses/no-such-company', { method: 'DELETE', body: { confirmName: 'x' } })).status, 404);
    assert.equal((await call(`/api/platform/businesses/${businessId}`, { method: 'DELETE', body: { confirmName: '__platform_reg__' } })).status, 200);
    assert.equal(await db.collection('businesses').countDocuments({ _id: businessId }), 0);
    for (const c of ['admins', 'services', 'invoices', 'sms_sends', 'booking_slot_locks']) {
      assert.equal(await db.collection(c).countDocuments({ business_id: businessId }), 0, `${c} emptied`);
    }
  });
});
