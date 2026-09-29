// Requires MONGODB_URI pointing at a migrated, replica-set-enabled deployment — skips
// cleanly if unset. Runs with no STRIPE_SECRET_KEY configured (this repo's test env
// never has one), so every charge attempt takes the "Stripe not configured" path —
// exactly like the Twilio/SendGrid precedent, not a live charge.
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { client, getDb, newId } from '../src/db.js';
import { closeBillingPeriod } from '../src/services/billingService.js';

// Two tests share this file's process — closing the shared client inside each test's
// own finally block breaks whichever test runs second (MongoNotConnectedError). Close
// once, after both, same convention established for every other multi-test DB file.
after(() => client.close());

test('closeBillingPeriod creates an invoice, advances the period by one month, and reflects the no-Stripe-configured state', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  const periodStart = DateTime.fromISO('2026-01-01T00:00:00.000Z').toJSDate();
  const periodEnd = DateTime.fromISO('2026-02-01T00:00:00.000Z').toJSDate();

  const business = {
    id: businessId, name: '__billing_worker_test__', plan: 'starter', contact_email: null,
    current_period_start: periodStart, current_period_end: periodEnd,
    stripe_customer_id: null, stripe_payment_method_id: null,
  };
  await db.collection('businesses').insertOne({ ...business, _id: businessId, status: 'active' });

  try {
    const result = await closeBillingPeriod(business);
    assert.equal(result.status, 'pending', 'no Stripe configured — invoice stays pending, not paid or failed');

    const invoice = await db.collection('invoices').findOne({ _id: result.invoiceId });
    assert.equal(invoice.business_id, businessId);
    assert.equal(invoice.base_amount, 49);
    assert.equal(invoice.total_amount, 54); // base + $5 phone fee, no usage

    const refreshed = await db.collection('businesses').findOne({ _id: businessId });
    assert.equal(DateTime.fromJSDate(refreshed.current_period_start).toISO(), DateTime.fromJSDate(periodEnd).toISO());
    assert.equal(DateTime.fromJSDate(refreshed.current_period_end).toISO(), DateTime.fromJSDate(periodEnd).plus({ months: 1 }).toISO());
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('invoices').deleteMany({ business_id: businessId });
  }
});

test('a business with an already-failed prior invoice gets suspended on the next close', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  const periodStart = DateTime.fromISO('2026-02-01T00:00:00.000Z').toJSDate();
  const periodEnd = DateTime.fromISO('2026-03-01T00:00:00.000Z').toJSDate();

  const business = {
    id: businessId, name: '__billing_worker_suspend_test__', plan: 'starter', contact_email: null,
    current_period_start: periodStart, current_period_end: periodEnd,
    stripe_customer_id: null, stripe_payment_method_id: null,
  };
  await db.collection('businesses').insertOne({ ...business, _id: businessId, status: 'active' });
  // Simulate last period's charge having already failed (e.g. a real card decline).
  await db.collection('invoices').insertOne({
    _id: newId(), business_id: businessId, period_start: DateTime.fromISO('2026-01-01').toJSDate(),
    period_end: periodStart, plan: 'starter', total_amount: 54, status: 'failed', created_at: new Date(),
  });

  try {
    // No payment method configured, so this close ALSO ends up "pending" (not a second
    // "failed") — the suspend rule keys off the prior invoice's status, not this one's.
    await closeBillingPeriod(business);
    const refreshed = await db.collection('businesses').findOne({ _id: businessId });
    assert.equal(refreshed.status, 'suspended');
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('invoices').deleteMany({ business_id: businessId });
  }
});
