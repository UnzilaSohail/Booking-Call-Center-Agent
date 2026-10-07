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
import { verifyTurnstile } from '../src/turnstile.js';
import { hashCode } from '../src/verification.js';

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

  it('bot check: off without a key; with a key it asks Cloudflare, refuses failures and missing tokens, never blocks on an outage (SEC-15)', async () => {
    const ask = (success) => { const calls = []; return { calls, fetchImpl: async (url, opts) => { calls.push(String(opts.body)); return { json: async () => ({ success }) }; } }; };
    const saved = process.env.TURNSTILE_SECRET_KEY;
    try {
      delete process.env.TURNSTILE_SECRET_KEY;
      assert.equal(await verifyTurnstile(undefined, '1.1.1.1'), true, 'no key set: check is off');
      process.env.TURNSTILE_SECRET_KEY = 'test-secret';
      const ok = ask(true);
      assert.equal(await verifyTurnstile('good-token', '1.1.1.1', { fetchImpl: ok.fetchImpl }), true);
      assert.match(ok.calls[0], /secret=test-secret/);
      assert.match(ok.calls[0], /response=good-token/);
      assert.equal(await verifyTurnstile('bad-token', '1.1.1.1', { fetchImpl: ask(false).fetchImpl }), false, 'Cloudflare says no');
      const none = ask(true);
      assert.equal(await verifyTurnstile('', '1.1.1.1', { fetchImpl: none.fetchImpl }), false, 'no token');
      assert.equal(await verifyTurnstile({ $ne: 1 }, '1.1.1.1', { fetchImpl: none.fetchImpl }), false, 'not text');
      assert.equal(none.calls.length, 0, 'Cloudflare is not even asked without a token');
      assert.equal(await verifyTurnstile('t', '1.1.1.1', { fetchImpl: async () => { throw new Error('offline'); } }), true, 'an outage does not stop real customers');
    } finally {
      if (saved === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = saved;
    }
  });

  it('with the key set, the public doors refuse a request that has no token (SEC-16)', async () => {
    const saved = process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    try {
      const slug = `bot-${newId().slice(0, 8)}`;
      await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { slug, booking_page_enabled: true } });
      const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const in3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      for (const [path, body] of [
        [`/api/public/${slug}/bookings`, { serviceId: 'x', startTime: new Date(Date.now() + 86_400_000).toISOString(), name: 'A', phone: '+15550107711' }],
        [`/api/public/${slug}/waitlist`, { serviceId: 'x', date: in3, name: 'A', phone: '+15550107712', consent: { sms: true } }],
        ['/api/public/leads', { name: 'A', contact: 'a@b.co', need: 'a haircut' }],
        ['/api/signup', { businessName: 'Bot Salon', ownerEmail: 'bot@example.test', ownerPhone: '+15550107713', ownerPassword: 'purple-bicycle-orbit-7', termsAccepted: true }],
        [`/api/public/${slug}/portal/code`, { phone: '+15550107714' }],
      ]) {
        const r = await post(path, body);
        const j = await r.json();
        assert.ok(r.status === 400 && j.captcha === true || r.status === 503, `${path} answered ${r.status} ${JSON.stringify(j)}`);
      }
      assert.equal(await db.collection('businesses').countDocuments({ name: 'Bot Salon' }), 0, 'no business was created');
    } finally {
      if (saved === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = saved;
    }
  });

  it('online booking needs the text code when texting works; wrong codes are limited; a code works once; the owner can switch it off (SEC-17)', async () => {
    const creds = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'];
    const saved = Object.fromEntries(creds.map((k) => [k, process.env[k]]));
    for (const k of creds) process.env[k] = 'fake';
    const slug = `code-${newId().slice(0, 8)}`;
    const phone = '+15550107720';
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { slug, booking_page_enabled: true, phone_verification: true } });
    const staffId = Object.values(t.staffIds)[0];
    const book = (over = {}) => {
      const { hh = 0, ...rest } = over;
      const start = new Date(Date.now() + 2 * 86_400_000); start.setUTCHours(10 + hh, 0, 0, 0); // inside opening hours (09:00-18:00)
      return fetch(`${base}/api/public/${slug}/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId: t.serviceIds.haircut, staffId, startTime: start.toISOString(), name: 'Code Person', phone, consent: { sms: true }, ...rest }) });
    };
    const setCode = async (code) => db.collection('booking_codes').replaceOne({ _id: `${t.businessId}:${phone}` }, { _id: `${t.businessId}:${phone}`, business_id: t.businessId, phone, code_hash: await hashCode(code), attempts: 0, created_at: new Date(), expires_at: new Date(Date.now() + 600_000) }, { upsert: true });
    try {
      assert.equal((await (await fetch(`${base}/api/public/${slug}`)).json()).phoneVerification, true, 'the page is told to ask for a code');
      let r = await book();
      assert.equal(r.status, 400);
      assert.equal((await r.json()).needsCode, true, 'no code: refused');
      await setCode('424242');
      assert.equal((await book({ phoneCode: '111111' })).status, 400, 'wrong code: refused');
      for (let i = 0; i < 6; i++) { await clearRateLimits(); await book({ phoneCode: '999999' }); } // (the per-phone and per-address booking limits would stop us first)
      await clearRateLimits();
      assert.equal((await book({ phoneCode: '424242' })).status, 400, 'too many wrong guesses: even the right code is refused');
      await setCode('424242');
      await clearRateLimits();
      r = await book({ phoneCode: '424242', hh: 1 });
      assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
      await clearRateLimits();
      assert.equal((await book({ phoneCode: '424242', hh: 2 })).status, 400, 'a code works once');
      await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { phone_verification: false } });
      assert.equal((await (await fetch(`${base}/api/public/${slug}`)).json()).phoneVerification, false);
      assert.equal((await book({ hh: 3 })).status, 201, 'switched off: no code needed');
      await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { phone_verification: true } });
      for (const k of creds) delete process.env[k];
      assert.equal((await (await fetch(`${base}/api/public/${slug}`)).json()).phoneVerification, false, 'texts cannot be sent here, so nothing to verify with');
      assert.equal((await book({ hh: 4 })).status, 201);
    } finally {
      for (const k of creds) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      await db.collection('booking_codes').deleteMany({ business_id: t.businessId });
    }
  });
});
