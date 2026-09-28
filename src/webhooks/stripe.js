// Payment failure alerts (ROADMAP.md §9, plan.md §11 item 8) — a webhook receiver ready
// for whenever deposits/prepayment actually ship (ROADMAP.md §16, growth tier). Nothing
// in this codebase creates a Stripe PaymentIntent today (plan.md §3 confirmed "no
// payment/deposit at booking"), so this endpoint does nothing until STRIPE_WEBHOOK_SECRET
// is set and something starts sending it events — it's the alert rail, not a checkout flow.
//
// Verifies Stripe's signature by hand (node:crypto) instead of adding the `stripe` SDK
// as a dependency for one webhook — Stripe's scheme is documented and small enough that
// hand-rolling it is less code than the alternative: https://docs.stripe.com/webhooks#verify-manually
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { withTenant, withSystemAccess, newId } from '../db.js';
import { sendEmail } from '../notifications/email.js';

export const stripeWebhookRouter = Router();
// Signature verification needs the exact raw bytes Stripe signed — must run before the
// app-wide express.json() would otherwise parse (and reshape) the body.
stripeWebhookRouter.use('/webhooks/stripe/payment-failed', express.raw({ type: 'application/json' }));

const TOLERANCE_SECONDS = 5 * 60;

// Exported for testing — pure, no I/O. rawBody is a Buffer or string exactly as received.
export function verifyStripeSignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

stripeWebhookRouter.post('/webhooks/stripe/payment-failed', async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — rejecting Stripe webhook (payments aren\'t wired up yet, see plan.md §11 item 8)');
    return res.sendStatus(503);
  }
  if (!verifyStripeSignature(req.body, req.headers['stripe-signature'], secret)) {
    console.error('rejected Stripe webhook: bad signature');
    return res.status(403).send('invalid signature');
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).send('invalid JSON');
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data?.object ?? {};
    // Whatever creates the PaymentIntent (once deposits ship) is expected to stamp
    // business_id/booking_id into metadata — the same convention Stripe recommends for
    // tying an intent back to your own records.
    const businessId = intent.metadata?.business_id;
    if (businessId) {
      const failure = {
        _id: newId(),
        payment_intent_id: intent.id,
        booking_id: intent.metadata?.booking_id ?? null,
        amount: intent.amount ?? null,
        currency: intent.currency ?? null,
        error_message: intent.last_payment_error?.message ?? null,
        created_at: new Date(),
        resolved_at: null,
        assigned_to: null,
        resolved_by: null,
        resolution_notes: null,
      };
      await withTenant(businessId, (c) => c('payment_failures').insertOne(failure));

      const business = await withSystemAccess((c) => c('businesses').findOne({ _id: businessId }, { projection: { name: 1, contact_email: 1 } }));
      if (business?.contact_email) {
        await sendEmail(
          business.contact_email,
          `Payment failed — ${business.name}`,
          `A payment failed${failure.amount ? ` for ${(failure.amount / 100).toFixed(2)} ${(failure.currency || '').toUpperCase()}` : ''}. ${failure.error_message || ''}`.trim()
        ).catch((err) => console.error('payment-failure alert email failed:', err.message));
      }
    }
  }

  res.sendStatus(200);
});
