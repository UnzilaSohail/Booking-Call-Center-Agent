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

## Still open (decisions or bigger work)
1. **Fake bookings (spam).** Anyone can book a free slot with any phone number; there is no proof the person owns the number. The limits above reduce abuse but do not stop it. Real fix: a bot check (Cloudflare Turnstile, free) on the booking form, or a text code before confirming.
2. **No Content-Security-Policy.** Needs a nonce for the theme script Next.js injects; do it as its own small task.
3. **Rate limits live in memory**: they reset when the server restarts and are per process (fine while there is one pm2 process; see `docs/CONCURRENCY.md`).
4. **Customer session token lives in the browser's localStorage for 7 days** and cannot be revoked early. Acceptable for "see my appointments"; shorten or move to a cookie if the portal ever holds payments.
5. **Directory search scans up to 500 businesses per request** (120 requests a minute per address are allowed). Add caching before there are hundreds of listed businesses.
6. **`PUBLIC_DASHBOARD_URL` must be set on the server**; otherwise confirmation links point at `localhost`. Check with one real test booking.
7. Passwords have a minimum length of 8 and no breach/common-password check.
8. Login lockout is per email: someone can lock a known email out for 15 minutes by failing on purpose. That is the usual trade-off; the address limit stops one person doing it to many.
