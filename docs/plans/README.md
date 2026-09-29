# Plans and next steps (updated 2026-09-30)

Four separate plans. Each plan file lists its steps split into **NOW** (code, docs, tests, Jira — no server needed) and **TOMORROW** (needs SSH, keys or a business decision).
Every item is a task on the AIN Jira board (parents 16 to 32, one short task per item).

| Plan | File | Status | Jira parents |
|---|---|---|---|
| 1 Customer: find the right business, book without calling, be recognised, "my appointments" | [PLAN_1_CUSTOMER.md](PLAN_1_CUSTOMER.md) | Designed, not started | 16-19 |
| 2 Test cases: use cases, race-condition tests (call vs manual on the same slot), known gaps | [PLAN_2_TEST_CASES.md](PLAN_2_TEST_CASES.md) | **Done** (docs + code pushed) | 20-23 |
| 3 GUI: self-explanatory UI (plan only) | [PLAN_3_GUI.md](PLAN_3_GUI.md) | Plan only | 24-26 |
| 4 Other: call reliability, booking fixes, email/invites, payment provider, deploy, board hygiene | [PLAN_4_OTHER.md](PLAN_4_OTHER.md) | Not started | 27-32 |

Test documents: [`docs/testing/USE_CASES.md`](../testing/USE_CASES.md), [`TEST_CASES.md`](../testing/TEST_CASES.md), [`KNOWN_GAPS.md`](../testing/KNOWN_GAPS.md).
Latest run: 96 tests, 90 pass, 0 fail, 6 known gaps (shown as `todo`). The gaps are real defects the new tests found; each has a Jira task.

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

## Suggested order
Plan 4 (repo cleanup, call fixes, email fix) → Plan 1 (customer web booking and directory) → GUI phases. Tell the lead which plan/step to start; nothing beyond Plan 2 has been executed.
