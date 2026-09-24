// Stripe's async payment events (ROADMAP.md §11) — keeps an invoice's status correct
// even if the synchronous charge call in src/services/billingService.js's
// closeBillingPeriod times out or the response is lost. Same public-router-with-its-
// own-body-parser shape as src/webhooks/twilio.js: signature verification needs the
// *raw* body, so this parses with express.raw() and must be mounted before the
// app-wide express.json().
import express, { Router } from 'express';
import Stripe from 'stripe';
import { getDb, withTenant } from '../db.js';

export const stripeWebhookRouter = Router();

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
let stripeClient = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

stripeWebhookRouter.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  if (!stripe || !webhookSecret) {
    console.warn('Stripe webhook received but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET not set — ignoring');
    return res.status(503).send('Stripe not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      const db = await getDb();
      const business = await db.collection('businesses').findOne({ stripe_customer_id: pi.customer });
      if (business) {
        const paid = event.type === 'payment_intent.succeeded';
        await withTenant(business._id, (c) => c('invoices').updateOne(
          { stripe_payment_intent_id: pi.id },
          { $set: { status: paid ? 'paid' : 'failed', paid_at: paid ? new Date() : null, failed_reason: paid ? null : (pi.last_payment_error?.message ?? 'payment failed') } }
        ));
        if (paid) await db.collection('businesses').updateOne({ _id: business._id }, { $set: { billing_status: 'active', status: 'active' } });
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook handling failed:', err.message);
    res.status(500).send('internal error');
  }
});
