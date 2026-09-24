// Fixed plan catalog (ROADMAP.md §11) — no DB collection, same "small fixed set" pattern
// as src/permissions.js's AREAS. Real Stripe Products/Prices would need to be
// pre-configured in the Stripe Dashboard, which can't be scripted from here; this
// catalog is the source of truth our own invoices are computed against instead.
import { DateTime } from 'luxon';

export const PLANS = {
  trial: {
    name: 'Trial', monthlyPrice: 0,
    includedVoiceMinutes: 100, includedSms: 100,
    phoneNumberFee: 0, overagePerMinute: 0, overagePerSms: 0,
  },
  starter: {
    name: 'Starter', monthlyPrice: 49,
    includedVoiceMinutes: 300, includedSms: 300,
    phoneNumberFee: 5, overagePerMinute: 0.15, overagePerSms: 0.05,
  },
  growth: {
    name: 'Growth', monthlyPrice: 149,
    includedVoiceMinutes: 1200, includedSms: 1200,
    phoneNumberFee: 5, overagePerMinute: 0.12, overagePerSms: 0.04,
  },
  scale: {
    name: 'Scale', monthlyPrice: 399,
    includedVoiceMinutes: 4000, includedSms: 4000,
    phoneNumberFee: 5, overagePerMinute: 0.10, overagePerSms: 0.03,
  },
};

// Businesses can upgrade/downgrade into any paid plan, but never back into 'trial'.
export const PURCHASABLE_PLAN_IDS = ['starter', 'growth', 'scale'];

export function getPlan(planId) {
  return PLANS[planId] ?? null;
}

// Fields set on a business at creation (src/routes/signup.js and src/routes/
// platform.js's POST /businesses both need the identical starting billing state) — a
// 14-day trial and a one-month billing period anchored to now.
export function initialBillingFields(now = new Date()) {
  return {
    plan: 'trial',
    trial_ends_at: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
    billing_status: 'active',
    cancel_at: null,
    current_period_start: now,
    current_period_end: DateTime.fromJSDate(now).plus({ months: 1 }).toJSDate(),
    stripe_customer_id: null,
    stripe_payment_method_id: null,
    card_brand: null,
    card_last4: null,
  };
}
