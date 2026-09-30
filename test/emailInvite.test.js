// Team invites and verification codes when no email provider is configured (docs/testing/
// TEST_CASES.md group EM): the owner must be told the email was not sent and still get the
// invite link, instead of a silent "Invited" (production incident: Aiza's invite never arrived).
// Runs real HTTP against the Express app, so it asserts the "no provider" path and skips when
// an email or SMS provider is configured in the environment.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip as noDb, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { sendEmail } from '../src/notifications/email.js';
import { verifyInviteToken } from '../src/teamInvite.js';

const providerConfigured = process.env.GMAIL_USER || process.env.SENDGRID_API_KEY || process.env.TWILIO_ACCOUNT_SID;
const skip = noDb || (providerConfigured ? 'an email/SMS provider is configured; this file tests the unconfigured path' : false);

describe('team invites without an email provider', { skip }, () => {
  let t;
  let server;
  let base;
  let db;
  let ownerToken;
  let managerToken;
  const session = (adminId) => jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = (path, token, body) => fetch(`${base}/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body ?? {}),
  });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__invite__', staff: [] });
    const ownerId = newId();
    const managerId = newId();
    await db.collection('admins').insertMany([
      { _id: ownerId, business_id: t.businessId, email: `owner-${ownerId}@example.test`, phone: '+15550300001', name: 'Owner', role: 'owner', status: 'active', password_hash: 'x' },
      { _id: managerId, business_id: t.businessId, email: `manager-${managerId}@example.test`, name: 'Manager', role: 'manager', status: 'active', password_hash: 'x' },
    ]);
    ownerToken = session(ownerId);
    managerToken = session(managerId);
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.collection('admins').deleteMany({ business_id: t.businessId });
    await dropTenants(t.businessId);
  });

  it('EM-01 invite answers emailSent:false with the reason and still returns a working link', async () => {
    const res = await call('/team-members/invite', ownerToken, { name: 'Aiza', email: `aiza-${newId()}@example.test`, role: 'receptionist' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.emailSent, false);
    assert.match(body.emailError, /no email provider/);
    const token = body.inviteLink.split('/accept-invite/')[1];
    const row = await db.collection('admins').findOne({ business_id: t.businessId, status: 'invited' });
    assert.equal(verifyInviteToken(token)?.adminId, row._id, 'the returned link belongs to the invited admin');
  });

  it('EM-02 "copy link" mode returns the link without attempting an email', async () => {
    const row = await db.collection('admins').findOne({ business_id: t.businessId, status: 'invited' });
    const res = await call(`/team-members/${row._id}/resend-invite`, ownerToken, { sendEmail: false });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.emailSent, false);
    assert.equal(body.emailError, null, 'no error is reported because no email was attempted');
    assert.ok(body.inviteLink.includes('/accept-invite/'));
  });

  it('EM-03 resend attempts the email and reports why it did not go out', async () => {
    const row = await db.collection('admins').findOne({ business_id: t.businessId, status: 'invited' });
    const body = await (await call(`/team-members/${row._id}/resend-invite`, ownerToken)).json();
    assert.equal(body.emailSent, false);
    assert.match(body.emailError, /no email provider/);
  });

  it('EM-04 only the owner can invite or resend', async () => {
    const row = await db.collection('admins').findOne({ business_id: t.businessId, status: 'invited' });
    assert.equal((await call(`/team-members/${row._id}/resend-invite`, managerToken)).status, 403);
    assert.equal((await call('/team-members/invite', managerToken, { name: 'X', email: 'x@example.test', role: 'staff' })).status, 403);
  });

  it('EM-05 an already-active member cannot be re-invited', async () => {
    const active = await db.collection('admins').findOne({ business_id: t.businessId, role: 'manager' });
    assert.equal((await call(`/team-members/${active._id}/resend-invite`, ownerToken)).status, 400);
  });

  it('EM-06 sendEmail never throws and says why nothing was sent', async () => {
    assert.deepEqual(await sendEmail('', 's', 't'), { sent: false, reason: 'no recipient address' });
    const result = await sendEmail('someone@example.test', 's', 't');
    assert.equal(result.sent, false);
    assert.match(result.reason, /no email provider/);
  });

  it('EM-07 onboarding verification code reports delivered:false when it cannot be sent', async () => {
    const email = await (await call('/onboarding/verify/send', ownerToken, { channel: 'email' })).json();
    assert.equal(email.ok, true);
    assert.equal(email.delivered, false);
    assert.match(email.deliveryError, /no email provider/);

    await db.collection('admins').updateOne({ business_id: t.businessId, role: 'owner' }, { $unset: { phone_code_sent_at: '', email_code_sent_at: '' } });
    const phone = await (await call('/onboarding/verify/send', ownerToken, { channel: 'phone' })).json();
    assert.equal(phone.delivered, false);
    assert.match(phone.deliveryError, /SMS/);
  });
});
