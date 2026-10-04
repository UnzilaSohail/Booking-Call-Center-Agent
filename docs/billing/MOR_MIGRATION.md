# Migration spec: merchant of record instead of Stripe (Jira 30j). Only if there is no US entity

Written 5 October 2026. Use this only if the boss confirms AI Networks has **no** US entity, EIN and US bank account (Jira 30b/30c), because Stripe will not activate an account for a Pakistan-registered business. Nothing here is built yet.

## Why a merchant of record (MoR)
The MoR (Paddle, Polar or Lemon Squeezy) is the legal seller to our clients. It takes the card, issues the receipt, calculates and files sales tax and VAT, handles chargebacks, and pays us out. We need no US company, but we pay **5% + 50¢ per payment** (Polar since 27 May 2026; Paddle and Lemon Squeezy the same), plus 1.5% extra for international cards on Polar and Lemon Squeezy.

## Picking one (decide before building)
- **Paddle:** most mature for SaaS, no extra fee for international cards or PayPal, usually the cheapest overall for a global client base. Approval can take days and asks for a business website and details.
- **Polar:** developer-friendly API, MoR since 2025; pricing was raised in May 2026. Good if we want the simplest API.
- **Lemon Squeezy:** owned by Stripe, MoR; fine, but the extra international fees make it dearer than Paddle.
Recommendation: **Paddle**, unless it rejects the application, then Polar.

## What changes in our product
Today a client enters a card in our dashboard (Stripe.js) and **we** create the invoice and charge it each month from our own usage numbers (voice minutes, SMS) in `src/services/billingService.js`. Stripe is touched in three places only: `src/routes/billing.js` (card setup, retry), `src/webhooks/stripe.js` and `src/services/billingService.js` (`chargeInvoice`), plus the card form in `dashboard/app/billing/page.jsx`.

An MoR wants to own the checkout and the subscription, so the shape becomes:
1. **Plans** become MoR products: Starter, Growth, Scale (monthly price). The base fee is billed by the MoR automatically every month.
2. **Checkout:** "Switch plan" and "Add payment method" open the MoR's hosted checkout (a link or overlay) instead of our card form. Our card form and `setupIntents` code are removed.
3. **Usage overage** (extra voice minutes, SMS, phone-number fee) is the awkward part: MoRs bill a fixed plan well and metered usage less well. Two options: (a) **MoR usage-based billing** if the chosen provider supports it (Polar and Paddle both have metering/usage features; verify at build time), or (b) bill overage as a **one-off charge** each month through the provider's API using the numbers `computeUsage()` already produces. Start with (b): smallest change, keeps our invoice computation.
4. **Webhooks:** replace `webhooks/stripe.js` with the provider's webhook (subscription created/updated/cancelled, payment succeeded/failed, refund). Map them to what we already store: `billing_status`, `current_period_start/end`, invoice `status`, and the existing "payment failure" exception.
5. **Invoices:** the MoR sends the legal receipt; we keep our own invoice rows for the Billing page and link to the provider's receipt.
6. **Data:** `businesses` gets `billing_provider` (`'stripe' | 'paddle' | 'polar'`) and a `provider_customer_id` / `provider_subscription_id`; keep the existing `stripe_*` fields until nothing uses them. Existing clients (there are none yet) would re-enter payment details once.

## Work estimate (rough)
Provider account and approval: days (not code). Checkout and webhook: about 2 days. Overage charge job and Billing page changes: about 1 day. Tests with the provider's sandbox: about 1 day. Total about one working week plus approval time.

## Tests to add
Webhook signature check (bad signature refused), duplicate webhook delivered twice changes nothing, payment failed moves the business to `past_due` and raises the exception, cancel sets `cancel_at`, overage amount equals `computeInvoiceAmounts`.

## Decision needed from the boss
Which provider, and approval to give them the business documents. Not needed if a US entity exists (then keep Stripe, `docs/billing/PAYMENT_PROVIDER.md`).
