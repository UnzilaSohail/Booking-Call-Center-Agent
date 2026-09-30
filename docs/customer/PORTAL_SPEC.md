# Customer portal "My appointments" (built 2026-10-01, waiting for SMS/email on the server)

Jira parent 19. Built and tested (`src/routes/customerPortal.js`, `src/customerAuth.js`, page `/my/<slug>`, tests CP-01..CP-17). It cannot be used for real until SMS (Twilio registration) and/or email (Gmail or SendGrid) works on the server, because the customer proves who they are with a one-time code. Until then the page says "sign-in codes are not available right now, please call <business>". Not built: SMS deep link to the portal (19t), SMS-delivery smoke test (teammate).

## Why a code
Showing someone's full appointment history from just a phone number would expose private data. So access is: enter phone (or email) for that business, receive a 6-digit code (SMS) or a link (email), get a short session.

## Flow
1. `/my/[slug]`: the customer enters their phone or email.
2. `POST /api/public/:slug/portal/code`: always answers "if that number is on file we sent a code" (same answer whether or not they are a customer, same timing). Rate limited per phone and per IP. Code stored hashed with expiry and attempt counter (reuse `src/verification.js`), in a new collection with a TTL index.
3. `POST .../portal/verify {phone, code}`: returns a signed session token (`purpose: customer-session`, `businessId`, `customerId`, 30 days), stateless like the manage link.
4. The portal calls `GET /api/customer/appointments` etc. with that token.

## Screens
- **Upcoming** (reschedule, cancel), **Past and cancelled**, **Profile** (name, email, language), **Preferences** (SMS/email opt-in), **My data** (export as JSON, request deletion).
- If neither SMS nor email is configured on the server: a clear message, never a login that cannot deliver.

## Rules
Per business only: a customer of the salon sees nothing from the dentist. No enumeration (uniform responses), no pre-fill before verification, logout clears the token, deletion requests go to the owner's exceptions queue.

## Build order
OTP collection and endpoints, session token, read-only pages, reschedule and cancel (reuse `rescheduleBooking` / `cancelBooking` with the customer's own bookings only), preferences, export and delete, tests.
