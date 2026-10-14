// Sessions end when they should (Jira 52j): a password change revokes older tokens (and hands back a fresh one), a
// deleted platform admin's token stops working, and replacing an authenticator that is already on needs the password.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';

const aged = (claims) => jwt.sign({ ...claims, iat: Math.floor(Date.now() / 1000) - 100 }, process.env.JWT_SECRET, { expiresIn: '12h' });

describe('session revocation', { skip }, () => {
  let db; let server; let base; let t;
  const adminId = newId(); const platformId = newId();
  const email = `rev-${adminId.slice(0, 8)}@example.test`;
  const call = (path, { method = 'GET', token, body } = {}) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: `Rev ${adminId.slice(0, 6)}` });
    await db.collection('admins').insertOne({ _id: adminId, business_id: t.businessId, name: 'Owner', email, password_hash: await bcrypt.hash('Old-Password-123', 4), role: 'owner', status: 'active', created_at: new Date() });
    await db.collection('platform_admins').insertOne({ _id: platformId, email: `plat-${platformId.slice(0, 8)}@example.test`, password_hash: await bcrypt.hash('Old-Password-123', 4), created_at: new Date() });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('admins').deleteMany({ email });
    await db.collection('platform_admins').deleteMany({ _id: platformId });
    await dropTenants(t.businessId);
  });

  it('SR-01 a company password change ends older sessions and returns a working fresh token', async () => {
    const claims = { role: 'business', adminId, businessId: t.businessId };
    const stolen = aged(claims);
    assert.equal((await call('/api/auth/me', { token: stolen })).status, 200, 'an older token works until the password changes');
    const mine = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await call('/api/auth/password', { method: 'PATCH', token: mine, body: { currentPassword: 'Old-Password-123', newPassword: 'Brand-New-Pass-456' } });
    assert.equal(res.status, 200);
    const { token } = await res.json();
    assert.equal((await call('/api/auth/me', { token })).status, 200, 'the fresh token keeps this person logged in');
    const revoked = await call('/api/auth/me', { token: stolen });
    assert.equal(revoked.status, 401, 'the older token is revoked');
    assert.equal((await revoked.json()).code, 'session', 'marked so the dashboard signs out');
  });

  it('SR-02 replacing an authenticator that is already on needs the password', async () => {
    const token = jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await call('/api/auth/mfa/enroll', { method: 'POST', token })).status, 200, 'first-time enrolment needs no password');
    await db.collection('admins').updateOne({ _id: adminId }, { $set: { mfa_enabled: true, mfa_secret: 'JBSWY3DPEHPK3PXP' } });
    assert.equal((await call('/api/auth/mfa/enroll', { method: 'POST', token })).status, 401);
    const wrongPassword = await call('/api/auth/mfa/enroll', { method: 'POST', token, body: { password: 'wrong' } });
    assert.equal(wrongPassword.status, 401);
    assert.equal((await wrongPassword.json()).code, undefined, 'a wrong password is not a dead session');
    assert.equal((await call('/api/auth/mfa/enroll', { method: 'POST', token, body: { password: 'Brand-New-Pass-456' } })).status, 200);
  });

  it('SR-03 platform: a deleted admin and an older token stop working, a password change returns a fresh token', async () => {
    const claims = { role: 'platform', platformAdminId: platformId };
    const old = aged(claims);
    assert.equal((await call('/api/platform/auth/me', { token: old })).status, 200);
    const mine = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await call('/api/platform/auth/password', { method: 'PATCH', token: mine, body: { currentPassword: 'Old-Password-123', newPassword: 'Brand-New-Pass-456' } });
    assert.equal(res.status, 200);
    const { token } = await res.json();
    assert.equal((await call('/api/platform/auth/me', { token })).status, 200);
    assert.equal((await call('/api/platform/auth/me', { token: old })).status, 401);
    await db.collection('platform_admins').deleteOne({ _id: platformId });
    assert.equal((await call('/api/platform/auth/me', { token })).status, 401, 'a deleted admin is out at once');
  });
});
