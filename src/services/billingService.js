// Platform billing (ROADMAP.md §11) — usage aggregation, invoice computation, and
// Stripe charging, shared by src/routes/billing.js (live preview + manual actions) and
// src/billing/worker.js (the monthly close). Usage is always computed by querying the
// source logs for the window (call_logs.duration_seconds, sms_sends), not a running
// counter — consistent with how this codebase already prefers query-time truth over
// counters that can drift.
import Stripe from 'stripe';
import { DateTime } from 'luxon';
import { getDb, withTenant, newId } from '../db.js';
import { getPlan } from '../billing/plans.js';
import { sendEmail } from '../notifications/email.js';

let stripeClient = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function computeUsage(businessId, periodStart, periodEnd) {
  return withTenant(businessId, async (c) => {
    const [callAgg] = await c('call_logs').aggregate([
      { $match: { created_at: { $gte: periodStart, $lt: periodEnd }, duration_seconds: { $type: 'number' } } },
      { $group: { _id: null, totalSeconds: { $sum: '$duration_seconds' } } },
    ]).toArray();
    const smsCount = await c('sms_sends').countDocuments({ sent_at: { $gte: periodStart, $lt: periodEnd } });
    return {
      voiceMinutes: Math.ceil((callAgg?.totalSeconds ?? 0) / 60),
      smsCount,
    };
  });
}

export function computeInvoiceAmounts(plan, usage) {
  const voiceOverageMinutes = Math.max(0, usage.voiceMinutes - plan.includedVoiceMinutes);
  const smsOverageCount = Math.max(0, usage.smsCount - plan.includedSms);
  const voiceOverageAmount = round2(voiceOverageMinutes * plan.overagePerMinute);
  const smsOverageAmount = round2(smsOverageCount * plan.overagePerSms);
  const total = round2(plan.monthlyPrice + voiceOverageAmount + smsOverageAmount + plan.phoneNumberFee);
  return { baseAmount: plan.monthlyPrice, voiceOverageAmount, smsOverageAmount, phoneNumberFee: plan.phoneNumberFee, total };
}

// Off-session charge against the saved payment method. Mirrors the Twilio/SendGrid
// degrade pattern: no Stripe key or no card on file just leaves the invoice `pending`
// instead of throwing.
async function chargeInvoice(business, invoice) {
  const stripe = getStripe();
  if (!stripe || !business.stripe_customer_id || !business.stripe_payment_method_id) {
    return { status: 'pending', reason: 'Stripe not configured or no payment method on file', stripePaymentIntentId: null };
  }
  const amountCents = Math.round(invoice.total_amount * 100);
  if (amountCents <= 0) return { status: 'paid', stripePaymentIntentId: null };
  try {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents, currency: 'usd',
      customer: business.stripe_customer_id, payment_method: business.stripe_payment_method_id,
      off_session: true, confirm: true,
    });
    if (pi.status === 'succeeded') return { status: 'paid', stripePaymentIntentId: pi.id };
    return { status: 'failed', stripePaymentIntentId: pi.id, reason: `payment intent status: ${pi.status}` };
  } catch (err) {
    return { status: 'failed', stripePaymentIntentId: err.payment_intent?.id ?? null, reason: err.message };
  }
}

// Closes `business`'s current billing period: computes usage/amounts, records an
// invoice, attempts to charge it, and advances the period by one month. If the
// business already had a failed invoice going into this close, suspends it instead of
// letting failures compound silently — reuses the existing suspension gate
// (src/auth.js's requireAuth already blocks a suspended business) rather than a second
// access-control path.
export async function closeBillingPeriod(business) {
  const plan = getPlan(business.plan) ?? getPlan('trial');
  const periodStart = business.current_period_start;
  const periodEnd = business.current_period_end;
  const usage = await computeUsage(business.id, periodStart, periodEnd);
  const amounts = computeInvoiceAmounts(plan, usage);

  const previousFailed = await withTenant(business.id, (c) => c('invoices').findOne({ status: 'failed' }, { sort: { created_at: -1 } }));

  const invoiceId = newId();
  const invoiceDoc = {
    _id: invoiceId, business_id: business.id, period_start: periodStart, period_end: periodEnd,
    plan: business.plan, base_amount: amounts.baseAmount, voice_minutes_used: usage.voiceMinutes,
    voice_overage_amount: amounts.voiceOverageAmount, sms_used: usage.smsCount,
    sms_overage_amount: amounts.smsOverageAmount, phone_number_fee: amounts.phoneNumberFee,
    total_amount: amounts.total, status: 'pending', stripe_payment_intent_id: null,
    created_at: new Date(), paid_at: null, failed_reason: null,
  };
  await withTenant(business.id, (c) => c('invoices').insertOne(invoiceDoc));

  const chargeResult = await chargeInvoice(business, invoiceDoc);
  const now = new Date();
  await withTenant(business.id, (c) => c('invoices').updateOne({ _id: invoiceId }, { $set: {
    status: chargeResult.status,
    stripe_payment_intent_id: chargeResult.stripePaymentIntentId,
    paid_at: chargeResult.status === 'paid' ? now : null,
    failed_reason: chargeResult.reason ?? null,
  } }));

  const nextPeriodStart = periodEnd;
  const nextPeriodEnd = DateTime.fromJSDate(periodEnd).plus({ months: 1 }).toJSDate();
  const businessUpdates = { current_period_start: nextPeriodStart, current_period_end: nextPeriodEnd };
  if (chargeResult.status === 'failed') {
    businessUpdates.billing_status = 'past_due';
  } else if (chargeResult.status === 'paid') {
    businessUpdates.billing_status = 'active';
  }
  // A business already carrying an unresolved failed invoice from a prior period gets
  // suspended on the NEXT close regardless of how this attempt itself went (paid,
  // failed, or pending-no-payment-method) — letting unpaid periods compound silently is
  // the thing being prevented, not just consecutive failures specifically.
  if (previousFailed) businessUpdates.status = 'suspended';
  const db = await getDb();
  await db.collection('businesses').updateOne({ _id: business.id }, { $set: businessUpdates });

  const range = `${DateTime.fromJSDate(periodStart).toFormat('LLL d')}–${DateTime.fromJSDate(periodEnd).toFormat('LLL d, yyyy')}`;
  if (chargeResult.status === 'paid' && business.contact_email) {
    sendEmail(business.contact_email, `Receipt — ${business.name}`, `Your invoice for ${range} was paid: $${amounts.total.toFixed(2)}.`)
      .catch((err) => console.error('receipt email failed:', err.message));
  } else if (chargeResult.status === 'failed' && business.contact_email) {
    sendEmail(business.contact_email, `Payment failed — ${business.name}`, `We couldn't charge your card $${amounts.total.toFixed(2)} for ${range}. Please update your payment method.`)
      .catch((err) => console.error('payment-failed email failed:', err.message));
  }

  return { invoiceId, ...chargeResult };
}
