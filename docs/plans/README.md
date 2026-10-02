# Plans and next steps (status updated 2026-10-03)

Four separate plans. Each plan file lists its steps split into **NOW** (code, docs, tests, Jira — no server needed) and **TOMORROW** (needs SSH, keys or a business decision).
Every item is a task on the AIN Jira board (parents 16 to 32, one short task per item).

| Plan | File | Status (2026-10-03) | Jira parents |
|---|---|---|---|
| 1 Customer: find the right business, book without calling, be recognised, "my appointments" | [PLAN_1_CUSTOMER.md](PLAN_1_CUSTOMER.md) | **Built.** Only 19c (SMS sign-in codes) and 19d (email sign-in) wait on Twilio and an email provider | 16-19 |
| 2 Test cases: use cases, race-condition tests, known gaps | [PLAN_2_TEST_CASES.md](PLAN_2_TEST_CASES.md) | **Done** except the live-server runs: 23c real multi-call test, 23d manual checklist | 20-23 |
| 3 GUI: self-explanatory UI | [PLAN_3_GUI.md](PLAN_3_GUI.md) | **Built** (see `docs/GUI_DESIGN_REVIEW.md`) | 24-26 |
| 4 Other: call reliability, booking fixes, email/invites, payment provider, deploy | [PLAN_4_OTHER.md](PLAN_4_OTHER.md) | **Code done.** What is left is server work, accounts and the boss's payment decision | 27-32 |

Everything that needs no server is finished; what remains is the "Tomorrow" lists below plus the open Jira tasks (31 deploy, 29k to 29n email, 30b to 30j payments, 19c/19d, 23c/23d, 27m).
Tests: 212 pass, 0 gaps; GitHub runs them on every push. Walkthrough video: `docs/demo/`.

Test documents: [`docs/testing/USE_CASES.md`](../testing/USE_CASES.md), [`TEST_CASES.md`](../testing/TEST_CASES.md), [`KNOWN_GAPS.md`](../testing/KNOWN_GAPS.md).
Latest run: 212 tests, 212 pass, 0 gaps (see `docs/testing/TEST_CASES.md`).

## What changed in the code (already pushed)
- `package.json`: `npm run dev` now watches only `src/` (the local Mongo data folder was restarting the server in a loop).
- `src/voice/geminiSession.js`: Gemini Live input/output transcription enabled so `call_logs.transcript` is filled (it was empty for every call).
- New tests and `scripts/wsSmoke.js` (see Plan 2). No production behaviour changes besides the two fixes above.

## Tomorrow — for the teammate with server access
1. **Before pulling**, the server copy of `src/voice/geminiSession.js` was hand-patched with the same transcription change as commit 9d8449f. In `/var/www/booking-call-center` run `git status`. If that file shows as modified, run `git checkout src/voice/geminiSession.js` first, then `git pull`, then `pm2 restart booking-backend --update-env`. If the folder is not a git checkout, copy the file from the repo instead.
2. **Email (Aiza's invite never arrived):** the server log says `Email not sent (SendGrid not configured)`. Create a SendGrid API key (Mail Send) and verify a sender address, then set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` and `PUBLIC_DASHBOARD_URL=https://bookingagent.sparkmind.online` in `/var/www/booking-call-center/.env`, run `pm2 restart booking-backend --update-env`, and send a test invite. Until then invite emails and verification codes are silently skipped.
3. **Twilio:** the log shows `failed to start recording … not eligible for recording`. Check the Twilio console for recording permissions and whether the account is on trial. Also check SMS registration (US numbers need A2P registration; trial accounts can only text verified numbers).
4. **Gemini quota:** check the Live API concurrent-session limit for the key in Google AI Studio. Needed before setting `MAX_CONCURRENT_CALLS` (Plan 4).
5. Run the manual checklist `UAT-01` to `UAT-05` in `docs/testing/TEST_CASES.md` on the live number (call, taken slot, two phones at once, transcript shows both sides).

## Tomorrow — decisions for the boss
- **Payment provider:** keep Stripe (cards 2.9% + 30c, ACH Direct Debit 0.8% capped at $5) if AI Networks has a real US company with an EIN and US bank account. Stripe does not support Pakistan-registered businesses. If there is no US entity, Paddle or Polar (merchant of record, higher fee, handles sales tax) is the alternative. Details in Plan 4.
- **Directory listing rule:** businesses opt in; confirm whether listings need platform approval before going live (default in Plan 1: auto-list when the business is ready, platform admin can hide).

## Order for the next round
1. **Teammate, morning:** deploy (`docs/TEAMMATE_RUNBOOK.md`: drift check, pull, `npm run migrate`, dashboard build, restart with `--kill-timeout 660000`), then run the smoke test.
2. **Boss, via the teammate, same morning:** the decisions above, plus who owns the Twilio console and the email sender domain.
3. **Right after deploy:** email provider (29k to 29n), Twilio Geo Permissions and SMS registration (31i), then real-phone tests (23c, 23d) and the Gemini quota (27m).
4. **When the boss has decided:** payments (30b to 30j).
