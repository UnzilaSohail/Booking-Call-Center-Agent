# Payment provider comparison (Jira 30a, researched Sep 2026)

Context: today's billing (plan.md §11 item 8, ROADMAP.md §11) charges cards through Stripe
for platform subscription invoices only — no per-booking payment/deposit exists yet
(plan.md §9). This doc is the comparison behind that choice; no provider code changes ship
with it.

## Options

| Provider | Fee | Needs a US entity? | Handles sales tax? |
|---|---|---|---|
| **Stripe** (current) | Cards 2.9% + 30¢; **ACH Direct Debit 0.8%, capped at $5** | Yes — US LLC/corp with EIN + US bank account | No — merchant of record for cards only, not tax |
| Paddle | ~5% + 50¢ | No | Yes (merchant of record) |
| Polar | ~4% + 40¢ + extras | No | Yes (merchant of record) |
| Lemon Squeezy | ~5% + 50¢ | No | Yes (merchant of record) |

Worked example on a $999 invoice: Stripe card ≈ $29, Stripe ACH ≈ $5 (capped), Paddle/Polar
≈ $40-50+.

## Recommendation

**Keep Stripe, add ACH Direct Debit for larger invoices** — conditional on AI Networks
having a real US entity (EIN + US bank account) to activate Stripe with. Stripe does not
support Pakistan-registered businesses directly.

If there is no qualifying US entity, the fallback is a merchant-of-record provider
(Paddle or Polar) — higher fee, but no US entity required and sales tax is handled for you.

## Open decision (Jira 30b/30c — needs the boss)

1. Confirm a real US entity + EIN + US bank account exists (the public FAQ says HQ in
   St. Petersburg, FL — confirm that's an actual registered entity, not just a mailing
   address).
2. If yes → Stripe stays, add ACH for invoices above a threshold (Jira 30f/30g).
3. If no → migrate to Paddle or Polar (Jira 30j — separate migration spec, not scoped here).

## Not in scope for this pass

Any code change to the payment flow itself. This is the comparison doc only; activation,
webhook wiring, and ACH support (Jira 30d-30i) wait on the entity decision above and, for
activation/webhooks, on production Stripe keys only the teammate with server access has.
