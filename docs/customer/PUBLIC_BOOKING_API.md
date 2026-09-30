# Public booking API

Unauthenticated endpoints under `/api/public`, used by `/find` and `/book/[slug]`. Jira parent 17. All responses are JSON. A business that does not exist, is suspended, deactivated or has its booking page off returns **404 `{error:"not found"}`** (same answer for all, so nothing is leaked).

| Endpoint | Purpose |
|---|---|
| `GET /public/directory`, `/directory/categories`, `/directory/cities` | Discovery (see DISCOVERY_AND_LISTING.md) |
| `GET /public/:slug` | Name, categories, address, city, timezone, phone, description, opening hours, locations |
| `GET /public/:slug/services` | `[{id, name, durationMinutes, price}]` |
| `GET /public/:slug/staff?serviceId=` | `[{id, name}]`, only staff who offer that service (staff with no restriction offer every service) |
| `GET /public/:slug/availability?serviceId=&date=YYYY-MM-DD&staffId=` | `{slots:[ISO UTC], durationMinutes, timezone}`. `staffId` can be an id, `any`, or omitted. For `any` (or omitted when the business has staff) slots are the union over eligible staff. Reuses `getAvailability`. |
| `POST /public/:slug/bookings` | Create a booking |

## `POST /public/:slug/bookings`
Body: `serviceId`, `staffId` (id, `any` or omitted), `startTime` (ISO from a slot), `name`, `phone`, optional `email`, `consent: {sms, email}`, `idempotencyKey`, `website` (honeypot, must be empty).

Steps on the server:
1. Rate limits (below); honeypot filled returns a normal-looking 201 without booking.
2. Validate name, phone (at least 10 digits, normalised to E.164 with +1 default) and `startTime`.
3. Pick staff: a named staff member must offer the service (400 otherwise); `any` tries each eligible staff member in turn.
4. `isSlotOffered` must be true for that staff member and time (hours, holidays, breaks, time off), otherwise 409.
5. Record the customer and their consent first, so the confirmation respects an unchecked box.
6. `createBooking(... createdVia: 'web')`: the slot lock decides a race; a loser gets 409 `slot no longer available` and, for `any`, the next staff member is tried. Confirmation SMS/email and the manage link are sent by `createBooking` as for every other booking.

Success `201`: `{booking:{id, startTime, endTime, serviceName, staffName|null}, business:{name, address, city, timezone, phone}, manageUrl}`.

## Errors
`400` bad input, `404` unknown business, `409` slot taken, `422` booking rules (notice, window), `429` rate limit or daily cap, all with `{error}`.

## Limits
Per IP: 120 reads per minute, 10 booking attempts per 10 minutes. Per phone number: 5 bookings per hour. Per business: `PUBLIC_BOOKING_DAILY_CAP` web bookings a day (default 200). In-memory counters (single server process; move to Mongo before running several processes). `app.set('trust proxy', 1)` so nginx's `X-Forwarded-For` gives the real client IP.

## Data
`bookings.created_via` is `call`, `dashboard` or `web` (shown as a Phone / Dashboard / Web badge in the dashboard). Consent is stored on the customer: `consent.smsOptIn`, `consent.emailOptIn` and `consent.lastWeb = {at, sms, email, text}`. An existing STOP (opt-out) is never overridden by a web booking.
