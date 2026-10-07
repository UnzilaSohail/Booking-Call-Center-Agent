# Security review: public booking, portal, sign-in (5 October 2026)

Scope: everything a stranger can reach without a login (`/api/public/*`, customer portal, manage links, signup) plus the
sign-in doors. Method: read the code, probed the live site (`https://bookingagent.sparkmind.online`) with harmless
requests, wrote tests for each fix (`test/security.test.js`, `test/demoData.test.js`, TEST_CASES groups SEC and DD).

## Fixed in this round

| # | Finding | Risk | Fix |
|---|---|---|---|
| 1 | **No limit on wrong passwords** at `/api/login`, `/api/auth/login` and `/api/platform/auth/login` (a failed login only sent an alert email) | High: unlimited password guessing, including against platform admins | 8 wrong passwords per email and 30 per address per 15 minutes, then HTTP 429. Right passwords never count (`src/rateLimit.js`) |
| 2 | **Unlimited guesses of the 6-digit authenticator code** in the second login step | High for accounts with MFA | 6 wrong codes per admin per 15 minutes |
| 3 | **Signup unlimited**, and it texts a code to any number typed in | Medium: fake businesses, SMS cost abuse | 5 signups per address per hour, 3 per phone per day |
| 4 | Onboarding code check counted attempts **after** checking (parallel guesses could skip the limit) | Medium | Attempt counted first, atomically |
| 5 | Web booking could text the same stranger's number from **many businesses** (limit was per business) | Medium: SMS harassment and cost | 8 web bookings per phone per day across all businesses |
| 6 | Sign-in and portal answered faster when the person did not exist | Low: reveals who is a customer or admin by timing | A dummy password/code check runs, so both take equally long |
| 7 | JSON bodies with objects instead of text (`serviceId: {"$ne":null}`, `password: ["x"]`) | Low: odd input reached the database or crashed a handler | Type checks return a clean 400 |
| 8 | No browser-hardening headers (live responses had none) | Low to medium: clickjacking, MIME sniffing, secret manage-links leaking in the Referer header | Dashboard (`next.config.mjs`): nosniff, frame deny, strict-origin-when-cross-origin, permissions policy, HSTS. API: nosniff, no-referrer, HSTS; no `X-Powered-By` |

Deploy: these need the new backend **and** a dashboard rebuild + restart to reach the live site.

## Checked and fine
- Every tenant read goes through `withTenant`; a customer or visitor only ever sees the one business in the URL. Unknown, suspended and "page off" businesses all answer the same 404.
- Customer tokens and company/platform tokens cannot be used on each other's endpoints (tested: `customerPortal`, `customerMerge`, `demoData`).
- The demo-data endpoints refuse anonymous callers, garbage tokens, expired platform tokens, business-owner tokens and customer tokens (test DD-5; smoke test checks the live server).
- Search inputs are escaped before they reach a regular expression; coordinates and page numbers are parsed as numbers.
- The live rate limiter sees real visitor IPs and cannot be bypassed with a spoofed `X-Forwarded-For` (burst test: 120 allowed, then 429, spoofing did not help).
- Portal sign-in codes: hashed, 10-minute life, 5 attempts, 60-second resend gap, 5 codes per person per hour, identical answer for known and unknown numbers.
- Manage links: signed, expire at the appointment (30 days at most), purpose-checked, re-checked against the booking.

## Fixed in round 2 (6 October)

| # | Was open | Now |
|---|---|---|
| 3 | Rate limits lived in memory and reset on every restart | Counters live in the database (`rate_limits`, removed by a TTL index), so a restart does not reset them and several server processes share one count. Only the public page-read limiter stays in memory (Jira 36h) |
| 4 | Customer session lasted 7 days and could not be cancelled | Lasts 1 day; "Sign out everywhere" on My appointments ends every earlier sign-in on every device (36i) |
| 5 | Directory search read up to 500 businesses on every request | A 30-second cache, cleared at once by any change made through the dashboard or platform console (36j). `DIRECTORY_CACHE_MS=0` turns it off |
| 7 | Passwords: 8 characters, nothing else | At least 10 characters, and no common passwords, repeated characters or the email name. Applies the next time a password is set: signup, invites, password change, platform reset (36l) |
| 8 | A known email could be locked out for 15 minutes without the owner knowing | The owner gets an email when the lock happens, and the platform team sees "Locked" on the company page with an **Unlock login** button (36m) |
| 2 | No Content-Security-Policy | Set for every page by `dashboard/proxy.js`: scripts only with a one-time code per page view, plus fixed lists for where the page may connect, load fonts, images and frames from (36g). `CSP_MODE=report` logs problems without blocking; `off` removes it. Style attributes are still allowed inline. |
| 1 (part) | Magic-link secret stayed in the address bar | Removed from the address at once and kept in memory; wrong link guesses no longer use up the code's 5 attempts, and the reverse |

## Fixed in round 3 (8 October)
- **Fake bookings and form spam:** a Cloudflare Turnstile bot check now guards the booking, waiting-list, signup, sign-in-code and "tell us what you need" forms (AIN-433). The server verifies the one-time token with Cloudflare; no keys set means the check is off. Switch-on steps: `docs/TEAMMATE_RUNBOOK.md` section 7f. A bot check does not prove the phone number belongs to the person booking; if that abuse still happens, add a text code before confirming.

## Still open
1. **Phone ownership.** Anyone who passes the bot check can still book with someone else's number (limited to 8 bookings per number per day). A text code before confirming would close this (it costs a text per booking).
2. **Confirmation links must point at the live site.** `PUBLIC_DASHBOARD_URL` has to be set on the server; check with one real test booking. (AIN-439, teammate)
3. **Stripe:** when card payments are switched on, set `CSP_MODE=report` for the first day and check the browser console on the Billing page, then switch back to enforce.
4. Scripts inside the page are strictly controlled, but inline *styles* are allowed (the app uses them everywhere); the risk from that is small.
