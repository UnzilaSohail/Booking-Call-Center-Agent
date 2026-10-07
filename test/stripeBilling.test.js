// Stripe safety nets, with no real Stripe: a fake client for charging and signed fake events for the webhook. Docs: docs/guides/STRIPE_SETUP.md, TEST_CASES group ST.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import Stripe from 'stripe';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_tests';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake_for_tests';
const { app } = await import('../src/app.js');
const { chargeInvoice } = await import('../src/services/billingService.js');

describe('stripe charging and webhook', { skip }, () => {
  let db; let server; let base; let t; const customer = `cus_${newId().slice(0, 10)}`;
  const signer = new Stripe(process.env.STRIPE_SECRET_KEY);
  const business = () => ({ id: t.businessId, stripe_customer_id: customer, stripe_payment_method_id: 'pm_x' });
  const invoice = (over = {}) => ({ _id: newId(), total_amount: 54.5, ...over });
  const fake = (create) => ({ paymentIntents: { create } });
  const makeInvoice = async (pi) => {
    const doc = { _id: newId(), business_id: t.businessId, status: 'pending', stripe_payment_intent_id: pi, total_amount: 10, created_at: new Date() };
    await db.collection('invoices').insertOne(doc);
    return doc;
  };
  const send = (type, object, id = `evt_${newId()}`, sign = true) => {
    const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
    const headers = { 'content-type': 'application/json' };
    if (sign) headers['stripe-signature'] = signer.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    return fetch(`${base}/webhooks/stripe`, { method: 'POST', headers, body: payload }).then(async (r) => ({ status: r.status, body: await r.text() }));
  };

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: `Stripe ${newId().slice(0, 6)}` });
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { stripe_customer_id: customer, billing_status: 'past_due' } });
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.collection('invoices').deleteMany({ business_id: t.businessId });
    await db.collection('payment_failures').deleteMany({ business_id: t.businessId });
    await db.collection('stripe_events').deleteMany({});
    await dropTenants(t.businessId);
  });

  it('a charge sends the right amount, an idempotency key per try, and the invoice in the metadata (ST-01)', async () => {
    const calls = [];
    const stripe = fake(async (body, opts) => { calls.push({ body, opts }); return { id: 'pi_1', status: 'succeeded' }; });
    const inv = invoice();
    assert.deepEqual(await chargeInvoice(business(), inv, { stripe }), { status: 'paid', stripePaymentIntentId: 'pi_1' });
    await chargeInvoice(business(), inv, { stripe });
    await chargeInvoice(business(), inv, { stripe, attempt: 1 });
    assert.equal(calls[0].body.amount, 5450);
    assert.equal(calls[0].body.metadata.invoice_id, String(inv._id));
    assert.equal(calls[0].opts.idempotencyKey, calls[1].opts.idempotencyKey, 'same invoice, same try: Stripe treats it as one charge');
    assert.notEqual(calls[0].opts.idempotencyKey, calls[2].opts.idempotencyKey, 'a retry is a new try');
  });

  it('slow payments are not failures, and a bank asking for confirmation says so in plain words (ST-02)', async () => {
    assert.equal((await chargeInvoice(business(), invoice(), { stripe: fake(async () => ({ id: 'pi_2', status: 'processing' })) })).status, 'processing');
    const needs = await chargeInvoice(business(), invoice(), { stripe: fake(async () => { throw Object.assign(new Error('Authentication required'), { code: 'authentication_required', payment_intent: { id: 'pi_3', status: 'requires_action' } }); }) });
    assert.equal(needs.status, 'failed');
    assert.equal(needs.stripePaymentIntentId, 'pi_3');
    assert.match(needs.reason, /bank needs you to confirm/);
    const declined = await chargeInvoice(business(), invoice(), { stripe: fake(async () => ({ id: 'pi_4', status: 'requires_payment_method' })) });
    assert.match(declined.reason, /declined/);
  });

  it('no card or no Stripe leaves the invoice pending, and a $0 invoice is paid without calling Stripe (ST-03)', async () => {
    const never = fake(async () => { throw new Error('must not be called'); });
    assert.equal((await chargeInvoice({ id: t.businessId }, invoice(), { stripe: never })).status, 'pending');
    assert.equal((await chargeInvoice(business(), invoice({ total_amount: 0 }), { stripe: never })).status, 'paid');
  });

  it('the webhook refuses unsigned and wrongly signed calls (ST-04)', async () => {
    assert.equal((await send('payment_intent.succeeded', { id: 'pi_x', customer }, undefined, false)).status, 400);
    const payload = JSON.stringify({ id: 'evt_bad', type: 'payment_intent.succeeded', data: { object: {} } });
    const bad = signer.webhooks.generateTestHeaderString({ payload, secret: 'whsec_someone_else' });
    const r = await fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': bad }, body: payload });
    assert.equal(r.status, 400);
  });

  it('a payment that settles marks the invoice paid and the account active; the same event twice is handled once (ST-05)', async () => {
    const inv = await makeInvoice('pi_paid');
    const id = `evt_${newId()}`;
    assert.equal((await send('payment_intent.succeeded', { id: 'pi_paid', customer }, id)).status, 200);
    assert.equal((await db.collection('invoices').findOne({ _id: inv._id })).status, 'paid');
    assert.equal((await db.collection('businesses').findOne({ _id: t.businessId })).billing_status, 'active');
    const again = await send('payment_intent.succeeded', { id: 'pi_paid', customer }, id);
    assert.match(again.body, /duplicate/);
  });

  it('a payment that is not one of our invoices changes nothing (ST-06)', async () => {
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { billing_status: 'past_due' } });
    const r = await send('payment_intent.succeeded', { id: 'pi_stranger', customer });
    assert.match(r.body, /ignored/);
    assert.equal((await db.collection('businesses').findOne({ _id: t.businessId })).billing_status, 'past_due');
  });

  it('a failed payment lands in the exceptions queue; a settling one shows as settling; a dispute is raised for a person (ST-07)', async () => {
    const failed = await makeInvoice('pi_fail');
    await send('payment_intent.payment_failed', { id: 'pi_fail', customer, amount: 1000, currency: 'usd', last_payment_error: { message: 'Card declined' } });
    assert.equal((await db.collection('invoices').findOne({ _id: failed._id })).status, 'failed');
    assert.equal(await db.collection('payment_failures').countDocuments({ business_id: t.businessId, payment_intent_id: 'pi_fail' }), 1);

    const slow = await makeInvoice('pi_slow');
    await send('payment_intent.processing', { id: 'pi_slow', customer });
    assert.equal((await db.collection('invoices').findOne({ _id: slow._id })).status, 'processing');

    await send('charge.dispute.created', { id: 'dp_1', payment_intent: 'pi_slow', amount: 1000, currency: 'usd', reason: 'fraudulent' });
    const row = await db.collection('payment_failures').findOne({ business_id: t.businessId, payment_intent_id: 'pi_slow' });
    assert.match(row.error_message, /disputed/);
  });
});
