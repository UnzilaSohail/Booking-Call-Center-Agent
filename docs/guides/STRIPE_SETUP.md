# Guide: Stripe. Take card payments safely · Jira AIN-376 to AIN-380

For the teammate who owns the Stripe account. Everything here is **test mode first**: test mode uses fake cards and cannot move real money. Do Parts A to C completely before anyone switches to live keys (Part D).

**Blocked on the boss:** Stripe needs a real business entity (see `docs/billing/PAYMENT_PROVIDER.md`, AIN-374 and AIN-375). Test mode works without it, so start now.

## What the code already does

- A business adds a card on the **Billing** page. Stripe stores the card; we only keep Stripe's reference and the last 4 digits.
- At the end of each month the worker makes an invoice and charges the saved card. Each charge carries a "never do this twice" label (idempotency key), so a restart or a double click cannot charge a customer twice.
- Stripe then tells us the final result at `/webhooks/stripe`. We handle each event once, only update invoices that are ours, and put failures and bank disputes in the **Exceptions** queue for a person.
- Slow payments (bank debits) show as **settling** instead of failed.
- If a bank asks the customer to confirm a payment, the Billing page says so in plain words.

## Part A: get the test keys (5 minutes)

1. Stripe Dashboard (https://dashboard.stripe.com), switch on **Test mode** (top right).
2. **Developers > API keys**. Copy the **Publishable key** (`pk_test_...`) and reveal the **Secret key** (`sk_test_...`).
3. Put them in files on the machine only. **Never paste them in chat, Jira or git.**
   - Backend `.env`: `STRIPE_SECRET_KEY=sk_test_...`
   - `dashboard/.env.local`: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`

## Part B: webhook

1. Stripe Dashboard (test mode) > **Developers > Webhooks > Add endpoint**.
2. URL: `https://bookingagent.sparkmind.online/webhooks/stripe`
3. Events to send (exactly these four): `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `charge.dispute.created`.
4. Copy the **Signing secret** (`whsec_...`) into backend `.env` as `STRIPE_WEBHOOK_SECRET=`.
5. Check the address reaches the backend: `curl -i -X POST https://bookingagent.sparkmind.online/webhooks/stripe` must answer **400** (or 503 before the keys are set). An HTML page or 404 means nginx is not passing `/webhooks/` to the backend.
6. Restart: `pm2 restart booking-backend --update-env`, and rebuild + restart the dashboard (`npm run build`, then `pm2 restart booking-dashboard --update-env`) because the publishable key is baked in at build time.

## Part C: prove it works

1. On the server (test keys in `.env`) run `npm run stripe:check`. It refuses live keys. Every line must start with OK.
2. In the dashboard sign in as a test business > **Billing** > add the card `4242 4242 4242 4242`, any future date, any CVC. The card must show as saved.
3. Other test cards worth one try: `4000 0000 0000 0341` (saves, then declines the charge: the failed payment must appear in **Exceptions** and the Billing page shows the retry button), `4000 0025 0000 3155` (bank asks to confirm: the Billing page says so).
4. In Stripe > Developers > Webhooks > your endpoint, recent deliveries must show **200**.

## Part D: going live (only after the boss answers AIN-374/375)

1. Finish Stripe account activation (business details, bank account).
2. Repeat Parts A and B with **live** mode: new `sk_live_...`, `pk_live_...`, a new webhook endpoint with its own `whsec_...`. Do not reuse test values.
3. Restart and rebuild as in Part B step 6.
4. Charge one real small invoice for a friendly business and confirm money, receipt email, and the Billing page status.
5. Optional, later: bank debit (ACH, cheaper for big invoices: AIN-378/379) and automatic sales tax (`docs/billing/SALES_TAX.md`).

## If something goes wrong

- **Webhook shows 400 in Stripe:** the signing secret in `.env` is not the one for that endpoint (test and live have different ones).
- **Webhook shows 503:** `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` is missing in `.env`, or pm2 was not restarted with `--update-env`.
- **Card form does not appear:** the publishable key is missing at build time; rebuild the dashboard.
- **An invoice stays "waiting for a card":** the business has no saved card yet. Nothing was charged.
