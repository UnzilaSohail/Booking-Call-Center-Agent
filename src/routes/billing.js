// Company-admin-facing billing (ROADMAP.md §11) — plan, usage, payment method,
// invoices, cancellation. Every route below is gated per-route with requireArea
// ('billing'), not a router-level .use() — see src/routes/services.js's comment for
// why a router-wide gate would incorrectly intercept unrelated routers' requests.
import { Router } from 'express';
import Stripe from 'stripe';
import { getDb, withTenant, serializeAll } from '../db.js';
import { requireArea } from '../auth.js';
import { PLANS, PURCHASABLE_PLAN_IDS, getPlan } from '../billing/plans.js';
import { computeUsage, computeInvoiceAmounts } from '../services/billingService.js';

export const billingRouter = Router();
const gate = requireArea('billing');

let stripeClient = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

async function loadBusiness(businessId) {
  const db = await getDb();
  return db.collection('businesses').findOne({ _id: businessId });
}

billingRouter.get('/billing/plan', gate, async (req, res, next) => {
  try {
    const business = await loadBusiness(req.businessId);
    res.json({
      plan: business.plan ?? 'trial',
      planDetails: getPlan(business.plan ?? 'trial'),
      allPlans: PLANS,
      trialEndsAt: business.trial_ends_at ?? null,
      billingStatus: business.billing_status ?? 'active',
      cancelAt: business.cancel_at ?? null,
      currentPeriodStart: business.current_period_start ?? null,
      currentPeriodEnd: business.current_period_end ?? null,
      paymentMethod: business.stripe_payment_method_id ? { brand: business.card_brand, last4: business.card_last4 } : null,
    });
  } catch (err) {
    next(err);
  }
});

billingRouter.patch('/billing/plan', gate, async (req, res, next) => {
  try {
    const { plan } = req.body ?? {};
    if (!PURCHASABLE_PLAN_IDS.includes(plan)) {
      return res.status(400).json({ error: `plan must be one of: ${PURCHASABLE_PLAN_IDS.join(', ')}` });
    }
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { plan } });
    res.json({ ok: true, plan });
  } catch (err) {
    next(err);
  }
});

billingRouter.get('/billing/usage', gate, async (req, res, next) => {
  try {
    const business = await loadBusiness(req.businessId);
    const plan = getPlan(business.plan ?? 'trial');
    const periodStart = business.current_period_start ?? new Date();
    const periodEnd = business.current_period_end ?? new Date();
    const usage = await computeUsage(req.businessId, periodStart, periodEnd);
    const amounts = computeInvoiceAmounts(plan, usage);
    res.json({
      periodStart, periodEnd,
      voiceMinutesUsed: usage.voiceMinutes, voiceMinutesIncluded: plan.includedVoiceMinutes,
      smsUsed: usage.smsCount, smsIncluded: plan.includedSms,
      estimate: amounts,
    });
  } catch (err) {
    next(err);
  }
});

billingRouter.get('/billing/invoices', gate, (req, res, next) =>
  withTenant(req.businessId, (c) => c('invoices').find({}).sort({ created_at: -1 }).limit(50).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

billingRouter.post('/billing/invoices/:id/retry', gate, async (req, res, next) => {
  try {
    const business = await loadBusiness(req.businessId);
    const invoice = await withTenant(req.businessId, (c) => c('invoices').findOne({ _id: req.params.id }));
    if (!invoice) return res.status(404).json({ error: 'invoice not found' });
    if (invoice.status !== 'failed') return res.status(400).json({ error: 'only a failed invoice can be retried' });

    const stripe = getStripe();
    if (!stripe || !business.stripe_customer_id || !business.stripe_payment_method_id) {
      return res.status(409).json({ error: 'no payment method on file — add one before retrying' });
    }
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(invoice.total_amount * 100), currency: 'usd',
      customer: business.stripe_customer_id, payment_method: business.stripe_payment_method_id,
      off_session: true, confirm: true,
    });
    const paid = pi.status === 'succeeded';
    await withTenant(req.businessId, (c) => c('invoices').updateOne({ _id: invoice._id }, { $set: {
      status: paid ? 'paid' : 'failed', stripe_payment_intent_id: pi.id,
      paid_at: paid ? new Date() : null, failed_reason: paid ? null : `payment intent status: ${pi.status}`,
    } }));
    if (paid) {
      const db = await getDb();
      await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { billing_status: 'active', status: 'active' } });
    }
    res.json({ ok: true, status: paid ? 'paid' : 'failed' });
  } catch (err) {
    if (err.type === 'StripeCardError') return res.status(402).json({ error: err.message });
    next(err);
  }
});

// Stripe SetupIntent — the client confirms this with Stripe.js directly (card details
// never reach this server), then calls POST /billing/payment-method below with the
// resulting payment method id.
billingRouter.post('/billing/setup-intent', gate, async (req, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured' });

    const business = await loadBusiness(req.businessId);
    let customerId = business.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: business.name, email: business.contact_email ?? undefined });
      customerId = customer.id;
      const db = await getDb();
      await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { stripe_customer_id: customerId } });
    }
    const setupIntent = await stripe.setupIntents.create({ customer: customerId, usage: 'off_session' });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/billing/payment-method', gate, async (req, res, next) => {
  try {
    const { paymentMethodId } = req.body ?? {};
    if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId is required' });
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured' });

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: {
      stripe_payment_method_id: paymentMethodId,
      card_brand: pm.card?.brand ?? null,
      card_last4: pm.card?.last4 ?? null,
    } });
    res.json({ ok: true, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null });
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/billing/cancel', gate, async (req, res, next) => {
  try {
    const business = await loadBusiness(req.businessId);
    if (!business.current_period_end) return res.status(400).json({ error: 'no active billing period to cancel' });
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { cancel_at: business.current_period_end } });
    res.json({ ok: true, cancelAt: business.current_period_end });
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/billing/reactivate', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { cancel_at: null } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
