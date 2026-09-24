// Pure logic, no MongoDB needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInvoiceAmounts } from '../src/services/billingService.js';
import { PLANS, getPlan, initialBillingFields } from '../src/billing/plans.js';

test('within-plan usage: zero overage, just the base price plus phone fee', () => {
  const amounts = computeInvoiceAmounts(PLANS.starter, { voiceMinutes: 100, smsCount: 50 });
  assert.equal(amounts.baseAmount, 49);
  assert.equal(amounts.voiceOverageAmount, 0);
  assert.equal(amounts.smsOverageAmount, 0);
  assert.equal(amounts.phoneNumberFee, 5);
  assert.equal(amounts.total, 54);
});

test('over-plan usage: overage charged at the plan\'s per-unit rate', () => {
  // starter: 300 included voice minutes, 300 included sms
  const amounts = computeInvoiceAmounts(PLANS.starter, { voiceMinutes: 320, smsCount: 310 });
  assert.equal(amounts.voiceOverageAmount, 20 * 0.15); // 20 minutes over
  assert.equal(amounts.smsOverageAmount, 10 * 0.05); // 10 sms over
  assert.equal(amounts.total, 49 + 3 + 0.5 + 5);
});

test('trial plan has no charge at all, even with heavy usage', () => {
  const amounts = computeInvoiceAmounts(PLANS.trial, { voiceMinutes: 1000, smsCount: 1000 });
  assert.equal(amounts.total, 0);
});

test('getPlan returns null for an unknown plan id', () => {
  assert.equal(getPlan('nonexistent'), null);
  assert.equal(getPlan('growth'), PLANS.growth);
});

test('initialBillingFields sets a 14-day trial and a one-month period from a fixed now', () => {
  const now = new Date('2026-01-15T00:00:00.000Z');
  const fields = initialBillingFields(now);
  assert.equal(fields.plan, 'trial');
  assert.equal(fields.trial_ends_at.toISOString(), '2026-01-29T00:00:00.000Z');
  assert.equal(fields.current_period_start.getTime(), now.getTime());
  assert.equal(fields.current_period_end.toISOString(), '2026-02-15T00:00:00.000Z');
  assert.equal(fields.billing_status, 'active');
  assert.equal(fields.stripe_customer_id, null);
});
