# Sales tax on our subscriptions (Jira 30i). Planning note, not tax advice

Written 5 October 2026. Confirm with an accountant or a sales-tax service before the first paying client; the rules change by state every year.

## The short version
- We sell software as a subscription to businesses. About half of US states tax software-as-a-service in some form (some only when it is delivered a certain way), the other half do not.
- We only have to **collect and file** in a state once we have a tax connection there ("nexus"). Nearly every state starts that at **$100,000 of sales or 200 transactions in a year** (California, New York and Texas: $500,000; some states, e.g. Illinois from 2026, count revenue only). Our home state, **Florida**, also counts at $100,000.
- With a handful of clients nobody is near these numbers. The job for now is to **track**, not to collect.

## Today's code
Invoices (`src/services/billingService.js`) have a base amount, voice and SMS overage and a phone-number fee, and **no tax line**. Every invoice is the plan price, nothing added.

## What to do, in order
1. **Now:** nothing in the app. Keep each client's billing state/country (their business address is already stored).
2. **Before the first paid invoice:** ask the accountant whether the AI Networks entity must register in its home state, and whether SaaS to a Florida business is taxable (generally ask, do not assume).
3. **When sales into any one state approach about 80% of its threshold:** turn on automatic tax. Cheapest path for us: **Stripe Tax**, about 0.5% of each transaction, charged only where we are registered, and it works with the Stripe Invoicing/Billing we already plan to use. Alternatives (Avalara, TaxJar) charge per filing and suit higher volume.
4. **Code needed then (small):** store the client's tax address on the business, call Stripe Tax when creating the invoice, add a `tax_amount` to the invoice document and show it on the Billing page. Registration and filing in each state stay with the accountant or the tax service.

## If we use a merchant of record instead
Paddle, Polar and Lemon Squeezy are the legal seller, so they calculate, collect and file sales tax and VAT worldwide for 5% + 50¢ per payment. Then none of the above applies to us. See `docs/billing/MOR_MIGRATION.md`.

## Tracking sheet to keep (one row per state)
State · sales this calendar year · number of transactions · threshold · registered? (yes/no) · date registered.
