// Brute-force and input-type protections on the public and login doors. Docs: docs/SECURITY_REVIEW.md, TEST_CASES group SEC.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { clearRateLimits, blocked, fail, forgive } from '../src/rateLimit.js';
import { fakeVerify } from '../src/verification.js';

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

  it('failure counters count wrong answers only and can be forgiven (SEC-07)', () => {
    for (let i = 0; i < 3; i++) fail('k', 1000);
    assert.equal(blocked('k', 3), true);
    forgive('k');
    assert.equal(blocked('k', 3), false);
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
});
