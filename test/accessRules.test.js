// AIN-470 / AIN-472: only numbers we serve can be dialled, the test call rings your own verified phone, an ended or used-up
// trial gets no service, unpaid money suspends, and a due cancellation closes the account.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DateTime } from 'luxon';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { dialablePhone } from '../src/phoneRules.js';
import { trialExpired, serviceBlockedReason } from '../src/billing/access.js';
import { closeBillingPeriod } from '../src/services/billingService.js';

describe('who can be dialled', () => {
  it('accepts clean international numbers in served countries and rejects the rest', () => {
    assert.equal(dialablePhone('+1 (415) 555-0123'), '+14155550123');
    assert.equal(dialablePhone('4155550123'), '+14155550123', 'ten digits are read as US/Canada');
    assert.equal(dialablePhone('+442071838750'), '+442071838750');
    assert.equal(dialablePhone('+882345678901'), null, 'a country we do not serve');
    assert.equal(dialablePhone('+12'), null, 'too short');
    assert.equal(dialablePhone('hello'), null);
    assert.equal(dialablePhone(''), null);
  });
});

describe('trial access', () => {
  const past = new Date(Date.now() - 86_400_000);
  it('an ended trial without a card is expired; with a card, or still running, it is not', () => {
    assert.equal(trialExpired({ plan: 'trial', trial_ends_at: past }), true);
    assert.equal(trialExpired({ plan: 'trial', trial_ends_at: past, stripe_payment_method_id: 'pm_1' }), false);
    assert.equal(trialExpired({ plan: 'trial', trial_ends_at: new Date(Date.now() + 86_400_000) }), false);
    assert.equal(trialExpired({ plan: 'starter', trial_ends_at: past }), false);
    assert.equal(trialExpired({ plan: 'trial' }), false, 'no end date recorded');
  });
});

describe('metered access, billing close and the settings routes', { skip }, () => {
  let db; let server; let base; let t; let token; let adminId;
  const call = (path, { method = 'GET', body } = {}) => fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
  });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__access__' });
    adminId = newId();
    await db.collection('admins').insertOne({ _id: adminId, business_id: t.businessId, name: 'Owner', email: `acc-${adminId.slice(0, 8)}@example.test`, password_hash: 'x', role: 'owner', status: 'active', phone: '+92 300 1234567', phone_verified_at: new Date(), created_at: new Date() });
    token = jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('admins').deleteMany({ _id: adminId });
    await db.collection('rate_limits').deleteMany({ _id: { $regex: 'test-call' } });
    await dropTenants(t.businessId);
  });

  it('a trial that used its free minutes is blocked; a paid plan is not', async () => {
    const start = DateTime.now().minus({ days: 3 }).toJSDate();
    const end = DateTime.now().plus({ days: 20 }).toJSDate();
    const trial = { id: t.businessId, plan: 'trial', current_period_start: start, current_period_end: end };
    assert.equal(await serviceBlockedReason(trial), null);
    await db.collection('call_logs').insertOne({ _id: newId(), business_id: t.businessId, created_at: new Date(), duration_seconds: 100 * 60, is_test: false });
    assert.equal(await serviceBlockedReason(trial), 'trial_minutes_used');
    assert.equal(await serviceBlockedReason({ ...trial, plan: 'starter' }), null);
    await db.collection('call_logs').deleteMany({ business_id: t.businessId });
  });

  it('the transfer number and department numbers must be dialable', async () => {
    assert.equal((await call('/api/business', { method: 'PATCH', body: { transferPhoneNumber: '+882345678901' } })).status, 400);
    const ok = await call('/api/business', { method: 'PATCH', body: { transferPhoneNumber: '(415) 555-0123' } });
    assert.equal(ok.status, 200);
    assert.equal((await db.collection('businesses').findOne({ _id: t.businessId })).transfer_phone_number, '+14155550123', 'stored in clean form');
    assert.equal((await call('/api/business/transfer-departments', { method: 'PUT', body: { departments: [{ name: 'Billing', phoneNumber: '12' }] } })).status, 400);
    assert.equal((await call('/api/business/transfer-departments', { method: 'PUT', body: { departments: [{ name: 'Billing', phoneNumber: '+14155550124' }] } })).status, 200);
  });

  it('the test call only rings your own verified phone', async () => {
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { phone_number: '+15550001111' } });
    assert.equal((await call('/api/onboarding/test-call', { method: 'POST', body: { toPhoneNumber: 'abc' } })).status, 400);
    assert.equal((await call('/api/onboarding/test-call', { method: 'POST', body: { toPhoneNumber: '+14155550123' } })).status, 403, "someone else's number");
    await db.collection('admins').updateOne({ _id: adminId }, { $unset: { phone_verified_at: '' } });
    assert.equal((await call('/api/onboarding/test-call', { method: 'POST', body: { toPhoneNumber: '+923001234567' } })).status, 403, 'own number, but not verified');
  });

  it('unpaid money from last period suspends, a free trial invoice counts as paid, and a due cancellation closes the account', async () => {
    const start = DateTime.fromISO('2026-05-01T00:00:00.000Z');
    const mk = async (extra, plan = 'starter') => {
      const id = newId();
      const business = { id, name: '__acc_bill__', plan, contact_email: null, current_period_start: start.toJSDate(), current_period_end: start.plus({ months: 1 }).toJSDate(), stripe_customer_id: null, stripe_payment_method_id: null, ...extra };
      await db.collection('businesses').insertOne({ ...business, _id: id, status: 'active' });
      return business;
    };
    const unpaid = await mk({});
    await db.collection('invoices').insertOne({ _id: newId(), business_id: unpaid.id, period_start: start.minus({ months: 1 }).toJSDate(), status: 'pending', total_amount: 54, created_at: new Date() });
    await closeBillingPeriod(unpaid);
    assert.equal((await db.collection('businesses').findOne({ _id: unpaid.id })).status, 'suspended');

    const free = await mk({}, 'trial');
    const r = await closeBillingPeriod(free);
    assert.equal(r.status, 'paid', 'nothing owed, nothing pending');

    const cancelling = await mk({ cancel_at: start.plus({ months: 1 }).toJSDate() });
    await closeBillingPeriod(cancelling);
    const c = await db.collection('businesses').findOne({ _id: cancelling.id });
    assert.equal(c.status, 'suspended');
    assert.equal(c.suspended_reason, 'cancelled');
    assert.equal(c.current_period_end, undefined, 'no next period: the billing sweep leaves it alone');
    assert.equal(await db.collection('invoices').countDocuments({ business_id: cancelling.id }), 1, 'the last period is still invoiced');

    for (const b of [unpaid, free, cancelling]) {
      await db.collection('businesses').deleteOne({ _id: b.id });
      await db.collection('invoices').deleteMany({ business_id: b.id });
    }
  });
});
