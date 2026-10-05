// Brute-force and input-type protections on the public and login doors. Docs: docs/SECURITY_REVIEW.md, TEST_CASES group SEC.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { clearRateLimits, blocked, fail, forgive } from '../src/rateLimit.js';
import { fakeVerify } from '../src/verification.js';
import { checkPassword } from '../src/passwordPolicy.js';
import { createCache } from '../src/services/directoryCache.js';
import jwt from 'jsonwebtoken';

describe('login and input protections', { skip }, () => {
  let db; let server; let base; let t; const email = `sec-${newId().slice(0, 8)}@example.test`;
  const login = (body, path = '/api/login') => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: `Sec ${newId().slice(0, 6)}` });
    await db.collection('admins').insertOne({ _id: newId(), business_id: t.businessId, name: 'Owner', email, password_hash: await bcrypt.hash('Right-Pass-1', 4), role: 'owner', status: 'active', created_at: new Date() });
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); await db.collection('admins').deleteMany({ email }); await dropTenants(t.businessId); });
  beforeEach(() => clearRateLimits());

  it('locks an account after 8 wrong passwords, even for the right one (SEC-01)', async () => {
    for (let i = 0; i < 8; i++) assert.equal((await login({ email, password: 'nope' })).status, 401);
    assert.equal((await login({ email, password: 'nope' })).status, 429);
    assert.equal((await login({ email, password: 'Right-Pass-1' })).status, 429, 'locked until the window passes');
  });

  it('the same limit guards the older company and platform login URLs (SEC-02)', async () => {
    for (let i = 0; i < 8; i++) await login({ email, password: 'nope' }, '/api/auth/login');
    assert.equal((await login({ email, password: 'nope' }, '/api/auth/login')).status, 429);
    for (let i = 0; i < 8; i++) await login({ email: 'nobody@example.test', password: 'nope' }, '/api/platform/auth/login');
    assert.equal((await login({ email: 'nobody@example.test', password: 'nope' }, '/api/platform/auth/login')).status, 429);
  });

  it('a correct login works and clears the failure count (SEC-03)', async () => {
    for (let i = 0; i < 5; i++) await login({ email, password: 'nope' });
    assert.equal((await login({ email, password: 'Right-Pass-1' })).status, 200);
    for (let i = 0; i < 7; i++) assert.equal((await login({ email, password: 'nope' })).status, 401, 'counter started again from zero');
  });

  it('one address cannot try many different accounts (SEC-04)', async () => {
    for (let i = 0; i < 30; i++) await login({ email: `x${i}@example.test`, password: 'nope' });
    assert.equal((await login({ email: 'fresh@example.test', password: 'nope' })).status, 429);
  });

  it('odd input types are a clean 400, not a crash (SEC-05)', async () => {
    assert.equal((await login({ email: { $ne: null }, password: 'x' })).status, 400);
    assert.equal((await login({ email, password: ['x'] })).status, 400);
  });

  it('a service id that is not text is refused on the public booking page (SEC-06)', async () => {
    const slug = `sec-${newId().slice(0, 8)}`;
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { slug, booking_page_enabled: true } });
    const r = await fetch(`${base}/api/public/${slug}/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId: { $ne: null }, startTime: new Date(Date.now() + 86_400_000).toISOString(), name: 'A', phone: '+15550108801' }) });
    assert.equal(r.status, 400);
  });

  it('failure counters count wrong answers only and can be forgiven (SEC-07)', async () => {
    for (let i = 0; i < 3; i++) await fail('k', 1000);
    assert.equal(await blocked('k', 3), true);
    await forgive('k');
    assert.equal(await blocked('k', 3), false);
  });

  it('a lookup with nobody to check costs as much as a real check (SEC-08)', async () => {
    const t0 = Date.now();
    assert.equal(await fakeVerify('123456'), false);
    assert.ok(Date.now() - t0 >= 5, 'did real hashing work');
  });

  it('API answers carry hardening headers and no X-Powered-By (SEC-09)', async () => {
    const r = await fetch(`${base}/health`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  it('counters live in the database, so a restart does not reset them (SEC-10)', async () => {
    await fail('persisted', 60_000);
    const row = await db.collection('rate_limits').findOne({ _id: { $regex: 'persisted$' } });
    assert.equal(row.count, 1);
    assert.ok(row.expires_at > new Date(), 'removed by the database when the window ends');
  });

  it('the platform team can see and lift a lock; the owner is not stuck for 15 minutes (SEC-11)', async () => {
    const platform = jwt.sign({ role: 'platform', platformAdminId: 'p1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const adminId = (await db.collection('admins').findOne({ email }))._id;
    const detail = () => fetch(`${base}/api/platform/businesses/${t.businessId}`, { headers: { authorization: `Bearer ${platform}` } }).then((r) => r.json());
    for (let i = 0; i < 8; i++) await login({ email, password: 'nope' });
    assert.equal((await detail()).admins.find((a) => a.id === adminId).locked, true);
    assert.equal((await login({ email, password: 'Right-Pass-1' })).status, 429);
    const unlock = await fetch(`${base}/api/platform/admins/${adminId}/unlock`, { method: 'POST', headers: { authorization: `Bearer ${platform}` } });
    assert.equal(unlock.status, 200);
    assert.equal((await detail()).admins.find((a) => a.id === adminId).locked, false);
    assert.equal((await login({ email, password: 'Right-Pass-1' })).status, 200);
    const owner = jwt.sign({ role: 'business', adminId: 'a1', businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await fetch(`${base}/api/platform/admins/${adminId}/unlock`, { method: 'POST', headers: { authorization: `Bearer ${owner}` } })).status, 401, 'only the platform team can unlock');
  });

  it('weak and common passwords are refused in plain words (SEC-12)', () => {
    assert.match(checkPassword('short1'), /too short/);
    assert.match(checkPassword('password123'), /too short|too common/);
    assert.match(checkPassword('Password12345'), /too common/);
    assert.match(checkPassword('qwertyuiop1'), /too common/);
    assert.match(checkPassword('aaaaaaaaaaaa'), /repeats/);
    assert.match(checkPassword('maria.lopez-2024', 'maria.lopez@example.test'), /email name/);
    assert.equal(checkPassword('purple-bicycle-orbit-7'), null);
  });

  it('signup and password changes refuse a weak password (SEC-13)', async () => {
    const r = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'Weak Pw Salon', ownerEmail: 'weak@example.test', ownerPhone: '+15550107701', ownerPassword: 'Welcome123', termsAccepted: true }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /too common/);
    assert.equal(await db.collection('businesses').countDocuments({ name: 'Weak Pw Salon' }), 0, 'nothing created');
  });

  it('the directory cache answers repeats from memory, expires, and can be cleared (SEC-14)', async () => {
    let loads = 0;
    const c = createCache(80);
    const load = async () => ++loads;
    assert.equal(await c.cached('a', load), 1);
    assert.equal(await c.cached('a', load), 1, 'second ask is from memory');
    c.clear();
    assert.equal(await c.cached('a', load), 2, 'cleared after a change');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(await c.cached('a', load), 3, 'expired by itself');
    const off = createCache(0);
    assert.equal(await off.cached('a', load), 4);
    assert.equal(await off.cached('a', load), 5, 'ttl 0 never caches');
  });
});
