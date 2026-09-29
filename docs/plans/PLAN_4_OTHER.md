# PLAN 4 — OTHER TASKS (reliability, email, payments, deploy, repo/board hygiene)

**Status: not started** (only the two pending local fixes were committed: dev watch scope and Gemini transcription).

## 4A. Concurrent calls — how they work today
One Node process; each call = its own WebSocket + Gemini Live session; all state is in a per-call closure (no shared mutable state, so calls don't leak into each other). No cap/queue: limits are external (one API key's Gemini Live quota, Twilio, Mongo pool). PM2 runs one process (fork mode).
Defects: Gemini start failure = dead air until the 15-min cap; server-initiated close never saves transcript/duration (billing minutes lost); no concurrency guard; silence watchdog never fires (every media frame refreshes it); PM2 cluster mode would run reminder/billing/sync workers N times.
Fixes: `endCallWithMessage()` (apology + hangup via Twilio REST, callback + `failed: ai_unavailable` record); idempotent `finalizeCall()` on stop AND close; optional `MAX_CONCURRENT_CALLS`; misheard staff name errors; `isSlotOffered()` check in voice `create_booking`; slot-lock 5-min grid alignment; reschedule rejects non-confirmed bookings.
## 4B. Email / team invites
Root cause = SendGrid unset. Code: `sendEmail` returns `{sent, reason}`; invite returns `{emailSent, inviteLink}` + owner-only resend endpoint; UI warning toast + Copy link + Resend; `.env.example` docs; `scripts/makeInviteLink.mjs <email>` so the teammate can mint Aiza's link even before the UI is deployed.
## 4C. Payment provider (researched Sep 2026)
Stripe US cards 2.9% + 30c; **ACH Direct Debit 0.8% capped at $5** ($999 invoice: ~$29 card vs $5 ACH). Merchant-of-record options cost more (Paddle / Lemon Squeezy 5% + 50c, Polar 4% + 40c + extras) but handle sales tax and need no US entity.
Stripe does not support Pakistan-registered businesses; works via a US LLC (EIN + US bank). Our billing already uses Stripe only for card capture/charge with our own invoices. **Recommendation: keep Stripe, add ACH for big invoices.** Boss must confirm a real US entity (FAQ says HQ in St. Petersburg, FL); if none -> Paddle/Polar migration spec. No provider code change now.
## 4D. Steps
| # | Step | NOW | TOMORROW |
|---|---|---|---|
| O1 | Repo hygiene: commit pending, `git pull --rebase`, `npm test` | yes | — |
| O2 | Jira board audit (`statusCategory != Done`, verify vs code, mark Done + Aiza Ali only with evidence) + create tasks for all plans | yes | — |
| O3 | Service duration -> 60 via owner login | yes | — |
| O4 | Voice reliability fixes + tests (4A) | yes | deploy + test call |
| O5 | Booking correctness fixes (locks, offered slot, reschedule) + tests | yes | deploy |
| O6 | Email/invite fixes + script (4B) | yes | teammate: SendGrid key + verified sender + env vars + restart + test invite to Aiza |
| O7 | Docs: `docs/CONCURRENCY.md`, `docs/billing/PAYMENT_PROVIDER.md`, `docs/TEAMMATE_RUNBOOK.md` | yes | — |
| O8 | Payment: entity decision, Stripe activation/keys/webhook, ACH support | doc now | boss + teammate; code later |
| O9 | Deploy runbook: `git status` drift check, pull, `npm run migrate`, dashboard `npm ci && npm run build`, `pm2 restart booking-backend booking-dashboard --update-env`, smoke (health, WS upgrade, public page) | runbook now | teammate |
| O10 | Twilio: "not eligible for recording" error, SMS registration/trial limits; Gemini Live quota; then set `MAX_CONCURRENT_CALLS`; pm2 log rotation | — | teammate |
Jira parents 27-32:
- **27. Concurrent Calls & Reliability**: 27a concurrency doc; 27b capacity/quota checklist; 27c graceful end when Gemini fails; 27d callback+failed-call record; 27e finalizeCall on stop+close; 27f MAX_CONCURRENT_CALLS + lines-busy; 27g many-WebSocket smoke; 27h silence-watchdog limitation doc; 27i PM2 cluster warning doc; 27j atomic claim in reminder worker [T]; 27k silence by caller speech [T]; 27l graceful drain on restart [T]; 27m Gemini quota verified [T][TM].
- **28. Booking Correctness**: 28a misheard staff name error; 28b voice create_booking validates slot; 28c `isSlotOffered` helper; 28d lock 5-min grid alignment; 28e reschedule rejects non-confirmed; 28f known-limitations register; 28g cancelled-replay fix [T]; 28h lock cleanup [T]; 28i time-off vs existing bookings [T].
- **29. Email Delivery & Team Invites**: 29a root cause; 29b `sendEmail` result; 29c invite returns emailSent+link; 29d warning toast; 29e copy-link; 29f resend endpoint; 29g resend button + icon fix; 29h `makeInviteLink` script; 29i `.env.example`; 29j onboarding verification fallback message [T]; 29k SendGrid key+sender [T][TM]; 29l env vars+restart [T][TM]; 29m test invite to Aiza [T][TM]; 29n SPF/DKIM [T][TM]; 29o delivery status in dashboard [T].
- **30. Payment Provider**: 30a comparison doc; 30b confirm US entity+EIN+bank [T][B]; 30c decision Stripe vs MoR [T][B]; 30d Stripe activation+keys [T][TM]; 30e webhook+secret [T][TM]; 30f ACH payment method [T]; 30g prefer ACH above threshold [T]; 30h test-mode end-to-end charge [T]; 30i sales-tax approach [T]; 30j MoR migration spec if no entity [T].
- **31. Deployment & Handover (teammate)**: 31a runbook doc; 31b drift check; 31c deploy backend; 31d `npm run migrate`; 31e build+restart dashboard; 31f `PUBLIC_DASHBOARD_URL`; 31g smoke health/WS/public page; 31h Twilio recording error; 31i Twilio SMS limits; 31j post-deploy test call (transcript populated); 31k pm2 log rotation; 31l set MAX_CONCURRENT_CALLS; 31m mint Aiza's invite link. (all [T][TM] except 31a)
- **32. Repo & Board Hygiene**: 32a commit pending local changes; 32b pull --rebase + test; 32c board audit; 32d mark verified-done tasks; 32e service duration fix; 32f push docs; 32g push code.
