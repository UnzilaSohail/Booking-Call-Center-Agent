// AIN-476 / AIN-479: platform admins can use an authenticator (second login step), every change a platform admin makes is
// logged, and authenticator secrets are stored encrypted (older plain ones are sealed by the migration).
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { totp } from '../src/mfa.js';
import { openSecret } from '../src/mfaSecret.js';
import { sealMfaSecrets } from '../db/schema.js';

process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64'); // read lazily, on the first encrypt

describe('platform admin security', { skip }, () => {
  let db; let server; let base; let t;
  const id = newId();
  const email = `pmfa-${id.slice(0, 8)}@example.test`;
  const password = 'Old-Password-123';
  const post = (path, body, token) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  const get = (path, token) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__psec__' });
    await db.collection('platform_admins').insertOne({ _id: id, email, password_hash: await bcrypt.hash(password, 4), created_at: new Date() });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('platform_admins').deleteMany({ _id: id });
    await db.collection('platform_audit_logs').deleteMany({ admin_id: id });
    await dropTenants(t.businessId);
  });

  it('PS-01 enrolling an authenticator makes the next login a two-step one, and the secret is stored encrypted', async () => {
    const login = await (await post('/api/login', { email, password })).json();
    assert.ok(login.token, 'no authenticator yet: one step');

    const { secret } = await (await post('/api/platform/auth/mfa/enroll', {}, login.token)).json();
    assert.equal((await post('/api/platform/auth/mfa/enroll/confirm', { code: '000000' }, login.token)).status, 401, 'a wrong code does not enable it');
    assert.equal((await post('/api/platform/auth/mfa/enroll/confirm', { code: totp(secret) }, login.token)).status, 200);

    const row = await db.collection('platform_admins').findOne({ _id: id });
    assert.ok(row.mfa_secret.startsWith('enc:'), 'sealed, not plain');
    assert.equal(openSecret(row.mfa_secret), secret);

    const second = await (await post('/api/login', { email, password })).json();
    assert.equal(second.mfaRequired, true);
    assert.equal(second.role, 'platform');
    assert.equal(second.token, undefined, 'no session until the code is right');
    assert.equal((await post('/api/platform/auth/mfa/verify-login', { mfaToken: second.mfaToken, code: '000000' })).status, 401);
    const ok = await post('/api/platform/auth/mfa/verify-login', { mfaToken: second.mfaToken, code: totp(secret) });
    assert.equal(ok.status, 200);
    const { token } = await ok.json();
    assert.equal((await get('/api/platform/auth/me', token)).status, 200);
    assert.equal((await (await get('/api/platform/auth/me', token)).json()).mfaEnabled, true);
    assert.equal((await get('/api/platform/stats', second.mfaToken)).status, 401, 'the half-login token is not a session');
  });

  it('PS-02 a change made by a platform admin is logged; a failed one is not', async () => {
    const login = await (await post('/api/login', { email, password })).json();
    const { secret } = (await db.collection('platform_admins').findOne({ _id: id })).mfa_secret
      ? { secret: openSecret((await db.collection('platform_admins').findOne({ _id: id })).mfa_secret) } : {};
    const { token } = await (await post('/api/platform/auth/mfa/verify-login', { mfaToken: login.mfaToken, code: totp(secret) })).json();

    const changed = await fetch(`${base}/api/platform/businesses/${t.businessId}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ status: 'active' }) });
    assert.equal(changed.status, 200);
    const missing = await fetch(`${base}/api/platform/businesses/no-such-company/status`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ status: 'active' }) });
    assert.equal(missing.status, 404);
    await new Promise((r) => setTimeout(r, 200)); // the log row is written when the response finishes

    const log = await (await get('/api/platform/audit-logs', token)).json();
    const mine = log.filter((e) => e.admin === email);
    assert.ok(mine.some((e) => e.method === 'PATCH' && e.path.endsWith(`/businesses/${t.businessId}/status`)));
    assert.ok(!mine.some((e) => e.path.includes('no-such-company')), 'a request that changed nothing is not logged');
  });

  it('AIN-479 the migration seals authenticator secrets saved in plain text, and company logins still accept them', async () => {
    const adminId = newId();
    await db.collection('admins').insertOne({ _id: adminId, business_id: t.businessId, email: `seal-${adminId.slice(0, 8)}@example.test`, password_hash: 'x', role: 'owner', status: 'active', mfa_enabled: true, mfa_secret: 'JBSWY3DPEHPK3PXP' });
    assert.ok((await sealMfaSecrets(db)) >= 1);
    const row = await db.collection('admins').findOne({ _id: adminId });
    assert.ok(row.mfa_secret.startsWith('enc:'));
    assert.equal(openSecret(row.mfa_secret), 'JBSWY3DPEHPK3PXP');
    assert.equal(await sealMfaSecrets(db), 0, 'running it again changes nothing');
    await db.collection('admins').deleteOne({ _id: adminId });
  });
});
