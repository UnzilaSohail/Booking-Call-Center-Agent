// AIN-473: one invoice per period, suspension only for last period's failure, billing holds lifted without
// undoing an abuse suspension, onboarding test calls free.
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { client, getDb, newId } from '../src/db.js';
import { closeBillingPeriod, computeUsage, clearBillingHold } from '../src/services/billingService.js';

after(() => client.close());
const skip = !process.env.MONGODB_URI && 'MONGODB_URI not set';

async function makeBusiness(db, extra = {}) {
  const id = newId();
  const start = DateTime.fromISO('2026-03-01T00:00:00.000Z').toJSDate();
  const end = DateTime.fromISO('2026-04-01T00:00:00.000Z').toJSDate();
  const business = { id, name: '__billing_fix__', plan: 'starter', contact_email: null, current_period_start: start, current_period_end: end, stripe_customer_id: null, stripe_payment_method_id: null };
  await db.collection('businesses').insertOne({ ...business, _id: id, status: 'active', ...extra });
  return { business, id, start, end };
}
const cleanup = async (db, id) => {
  await db.collection('businesses').deleteOne({ _id: id });
  await db.collection('invoices').deleteMany({ business_id: id });
  await db.collection('call_logs').deleteMany({ business_id: id });
};

test('closing the same period twice at once makes one invoice and moves the period once', { skip }, async () => {
  const db = await getDb();
  const { business, id, end } = await makeBusiness(db);
  try {
    const results = await Promise.all([closeBillingPeriod(business), closeBillingPeriod(business), closeBillingPeriod(business)]);
    assert.equal(await db.collection('invoices').countDocuments({ business_id: id }), 1);
    assert.equal(results.filter((r) => !r.skipped).length, 1, 'exactly one run did the charge step');
    const after = await db.collection('businesses').findOne({ _id: id });
    assert.equal(after.current_period_end.toISOString(), DateTime.fromJSDate(end).plus({ months: 1 }).toJSDate().toISOString());
  } finally { await cleanup(db, id); }
});

test('a leftover pending invoice from a crash is picked up, an already-charged one is not charged again', { skip }, async () => {
  const db = await getDb();
  const { business, id, start } = await makeBusiness(db);
  try {
    await db.collection('invoices').insertOne({ _id: newId(), business_id: id, period_start: start, period_end: business.current_period_end, plan: 'starter', total_amount: 54, status: 'paid', created_at: new Date() });
    const r = await closeBillingPeriod(business);
    assert.equal(r.skipped, true, 'already paid: only the period moves');
    assert.equal(await db.collection('invoices').countDocuments({ business_id: id }), 1);
    const after = await db.collection('businesses').findOne({ _id: id });
    assert.ok(after.current_period_end > business.current_period_end, 'the period still moved on');
  } finally { await cleanup(db, id); }
});

test('only the invoice just before this period can suspend; an older failure followed by a paid period cannot', { skip }, async () => {
  const db = await getDb();
  const { business, id, start } = await makeBusiness(db);
  try {
    await db.collection('invoices').insertMany([
      { _id: newId(), business_id: id, period_start: DateTime.fromJSDate(start).minus({ months: 2 }).toJSDate(), status: 'failed', total_amount: 54, created_at: new Date() },
      { _id: newId(), business_id: id, period_start: DateTime.fromJSDate(start).minus({ months: 1 }).toJSDate(), status: 'paid', total_amount: 54, created_at: new Date() },
    ]);
    await closeBillingPeriod(business);
    assert.equal((await db.collection('businesses').findOne({ _id: id })).status, 'active');
  } finally { await cleanup(db, id); }
});

test('a billing suspension is lifted by payment; an abuse suspension is not', { skip }, async () => {
  const db = await getDb();
  const billing = await makeBusiness(db, { status: 'suspended', suspended_reason: 'billing', billing_status: 'past_due' });
  const abuse = await makeBusiness(db, { status: 'suspended', billing_status: 'past_due' });
  try {
    await clearBillingHold(billing.id);
    await clearBillingHold(abuse.id);
    const b = await db.collection('businesses').findOne({ _id: billing.id });
    assert.equal(b.status, 'active');
    assert.equal(b.suspended_reason, undefined);
    const a = await db.collection('businesses').findOne({ _id: abuse.id });
    assert.equal(a.status, 'suspended', 'suspended by a person: payment does not undo it');
    assert.equal(a.billing_status, 'active');
  } finally { await cleanup(db, billing.id); await cleanup(db, abuse.id); }
});

test('onboarding test calls are not billed', { skip }, async () => {
  const db = await getDb();
  const { id, start, end } = await makeBusiness(db);
  try {
    const at = DateTime.fromJSDate(start).plus({ days: 2 }).toJSDate();
    await db.collection('call_logs').insertMany([
      { _id: newId(), business_id: id, created_at: at, duration_seconds: 120, is_test: false },
      { _id: newId(), business_id: id, created_at: at, duration_seconds: 600, is_test: true },
    ]);
    assert.equal((await computeUsage(id, start, end)).voiceMinutes, 2);
  } finally { await cleanup(db, id); }
});
