// Stripe's async payment events (ROADMAP.md §11, plan.md §11 item 8) — keeps an
// invoice's status correct even if the synchronous charge call in
// src/services/billingService.js's closeBillingPeriod times out or the response is
// lost, and raises a payment_failures exception-queue alert so a failure actually gets
// a human's attention on the Exceptions page, not just a status flip in the DB. Same
// public-router-with-its-own-body-parser shape as src/webhooks/twilio.js: signature
// verification needs the *raw* body, so this parses with express.raw() and must be
// mounted before the app-wide express.json().
import express, { Router } from 'express';
import Stripe from 'stripe';
import { getDb, withTenant, newId } from '../db.js';
import { sendEmail } from '../notifications/email.js';

export const stripeWebhookRouter = Router();

let stripeClient = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

stripeWebhookRouter.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET; // read per request so it can be set without a code change
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
    // Stripe may deliver the same event more than once (and does after any slow answer). Handle each event id once.
    const seen = await (await getDb()).collection('stripe_events').updateOne({ _id: event.id }, { $setOnInsert: { type: event.type, received_at: new Date() } }, { upsert: true });
    if (seen.matchedCount > 0) return res.json({ received: true, duplicate: true });

    if (event.type === 'payment_intent.processing') {
      const pi = event.data.object;
      const business = await (await getDb()).collection('businesses').findOne({ stripe_customer_id: pi.customer });
      if (business) await withTenant(business._id, (c) => c('invoices').updateOne({ stripe_payment_intent_id: pi.id, status: { $ne: 'paid' } }, { $set: { status: 'processing' } }));
    }
    if (event.type === 'charge.dispute.created') {
      // A customer's bank is taking money back. A person must look at it: same queue as failed payments.
      const dispute = event.data.object;
      // a dispute names the payment, not the customer: find our invoice by that payment, then its business
      const invoice = dispute.payment_intent ? await (await getDb()).collection('invoices').findOne({ stripe_payment_intent_id: dispute.payment_intent }) : null;
      const business = invoice && await (await getDb()).collection('businesses').findOne({ _id: invoice.business_id });
      if (business) {
        await withTenant(business._id, (c) => c('payment_failures').insertOne({ _id: newId(), business_id: business._id, payment_intent_id: dispute.payment_intent ?? null, amount: dispute.amount ?? null, currency: dispute.currency ?? null, error_message: `A payment was disputed with the bank (${dispute.reason ?? 'no reason given'}). Reply to the dispute in the Stripe dashboard before the deadline.`, created_at: new Date(), resolved_at: null, assigned_to: null, resolved_by: null, resolution_notes: null }));
      }
    }
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      const db = await getDb();
      const business = await db.collection('businesses').findOne({ stripe_customer_id: pi.customer });
      if (business) {
        const paid = event.type === 'payment_intent.succeeded';
        const matched = await withTenant(business._id, (c) => c('invoices').updateOne(
          { stripe_payment_intent_id: pi.id },
          { $set: { status: paid ? 'paid' : 'failed', paid_at: paid ? new Date() : null, failed_reason: paid ? null : (pi.last_payment_error?.message ?? 'payment failed') } }
        ));

        // A payment that is not one of our invoices (a manual charge, a test) must not flip the account's billing state.
        if (matched.matchedCount === 0) return res.json({ received: true, ignored: true });
        if (paid) {
          await db.collection('businesses').updateOne({ _id: business._id }, { $set: { billing_status: 'active', status: 'active' } });
        } else {
          // Exception-queue alert (ROADMAP.md §9, plan.md §11 item 8) — the invoice
          // status update above is the billing source of truth; this is what gets a
          // staff member to actually look at it, same pattern as every other exception
          // type in src/routes/exceptions.js.
          const failure = {
            _id: newId(),
            business_id: business._id,
            payment_intent_id: pi.id,
            amount: pi.amount ?? null,
            currency: pi.currency ?? null,
            error_message: pi.last_payment_error?.message ?? null,
            created_at: new Date(),
            resolved_at: null,
            assigned_to: null,
            resolved_by: null,
            resolution_notes: null,
          };
          await withTenant(business._id, (c) => c('payment_failures').insertOne(failure));
          if (business.contact_email) {
            await sendEmail(
              business.contact_email,
              `Payment failed — ${business.name}`,
              `A payment failed${failure.amount ? ` for ${(failure.amount / 100).toFixed(2)} ${(failure.currency || '').toUpperCase()}` : ''}. ${failure.error_message || ''}`.trim()
            ).catch((err) => console.error('payment-failure alert email failed:', err.message));
          }
        }
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook handling failed:', err.message);
    await (await getDb()).collection('stripe_events').deleteOne({ _id: event.id }).catch(() => {}); // let Stripe's retry run again
    res.status(500).send('internal error');
  }
});
