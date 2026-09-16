# Booking Call Center Agent

Multi-tenant AI call center: an inbound phone call books an appointment, which is
simultaneously the source of truth in MongoDB and mirrored to the business's Google
Calendar. Admins manage the same bookings from a dashboard. Full design rationale is in
[plan.md](plan.md); this file is just "how do I run it."

## Layout

```
src/                  Express API + voice pipeline + background workers (the backend)
  routes/             REST endpoints (auth, services/staff/hours, bookings, calendar, phone number)
  services/           bookingService.js — shared logic used by both the REST API and the voice agent
  voice/              Twilio Media Streams <-> Gemini Live bridge, audio resampling, tool definitions
  calendar/           Google Calendar OAuth + the sync worker that mirrors bookings
  notifications/      SMS/email confirmation + reminder worker
  webhooks/           Twilio inbound-call webhook
db/                   schema.js (index definitions) + migrate.js
dashboard/            Next.js admin dashboard (separate app, separate package.json)
test/                 node:test unit tests
scripts/              standalone scripts (e.g. the concurrency load test)
```

## Database

MongoDB **must run as a replica set** — booking creation uses a multi-document
transaction (src/services/bookingService.js) that a standalone `mongod` doesn't support.
Two options:

- **MongoDB Atlas** (recommended — no local setup): create a free-tier cluster at
  [mongodb.com/atlas](https://www.mongodb.com/atlas) (it's a replica set by default),
  copy the connection string into `MONGODB_URI`.
- **Local**: install MongoDB, start it with `mongod --replSet rs0 --dbpath <path>`, then
  once, connect with `mongosh` and run `rs.initiate()`.

There's no `EXCLUDE USING gist`-style constraint in Mongo to lean on for "no two
overlapping bookings," so that guarantee is built by hand: `src/services/bookingService.js`
decomposes each booking into 5-minute slot-lock documents with a deterministic `_id`
(`business_id:staffId:slotStart`) and inserts them in the same transaction as the
booking — two overlapping attempts collide on that `_id` and Mongo's unique index lets
exactly one win. `db/schema.js` has the full index rationale.

## Two admin roles

Companies don't self-register — a **platform admin** registers them. There's no public
endpoint to create a platform admin (that would defeat the point), so bootstrap yourself
once with `npm run create-platform-admin -- you@example.com "a strong password"`, then
log in at the dashboard's `/platform/login` to register companies from `/platform/companies`.
Each company gets its own admin login (email/password you set when registering it) at
the regular `/login` — that account only ever sees its own company's data, same as before.
Bookings made by the voice agent land in the same database the calendar reads from, so
they show up immediately — no separate sync step.

## Backend setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in what you have. Nothing beyond
   `MONGODB_URI` and `JWT_SECRET` is required just to run the booking API — Twilio,
   Gemini, Google Calendar and SendGrid are all optional and degrade gracefully (features
   they power are skipped/logged, not crashes) until configured.
3. `npm run migrate` — creates all the indexes in `db/schema.js` (safe to re-run; index
   creation is idempotent) and checks that transactions actually work against your
   `MONGODB_URI`, warning loudly if they don't (see the replica-set note above).
4. `npm start` (or `npm run dev` for auto-restart on change).
5. `npm test` — the one correctness test that matters most (plan.md §6): two concurrent
   bookings for the same slot, only one may win. It skips cleanly if `MONGODB_URI` isn't set.
6. `npm run load-test` — the same property, but through a *running* server over real
   HTTP concurrency rather than calling the booking service directly. Needs the server
   running and `MONGODB_URI` set.

## Dashboard setup

```
cd dashboard
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL — point at the backend above
npm run dev   # http://localhost:3002 (backend defaults to :3000, kept separate on purpose)
```

Sign up creates a business + its first admin in one step, then log in. Settings has
services/staff/business-hours, the Google Calendar connect button, and phone number
provisioning.

## Voice pipeline (Phase 4) — what it needs to actually take a call

This is the one phase that can't be fully verified without live third-party accounts, so
be aware of what's built vs. what's untestable from here:

- **Twilio**: a number pointed at `POST <PUBLIC_HTTPS_URL>/voice/incoming` (the dashboard's
  "Get a phone number" button does this automatically, or set it manually on an existing
  number). Twilio then opens a Media Streams WebSocket to `<PUBLIC_WSS_URL>/voice/stream`.
  Both URLs need to be *publicly reachable* — in local dev, tunnel with ngrok or similar
  and put the tunnel URL in `PUBLIC_HTTPS_URL`/`PUBLIC_WSS_URL`.
- **Gemini Live**: `GEMINI_API_KEY` + `GEMINI_LIVE_MODEL`. The Live API's exact model id
  and message shapes move fast (flagged in plan.md §3) — `src/voice/geminiSession.js`
  targets the documented `@google/genai` `ai.live.connect` interface as of when this was
  written; confirm against Google's current docs before a real call, especially the model
  name in `.env`.
- **Audio format**: Twilio sends/expects 8kHz mu-law; Gemini Live's native audio session
  is 16kHz PCM in / 24kHz PCM out. `src/voice/audio.js` does the codec conversion +
  linear resampling both directions — no native build step, but also not
  audiophile-grade; phone audio is already band-limited so this is a reasonable tradeoff.
- This has been verified for: syntax correctness, the HTTP/WS wiring, and the booking
  logic it calls (shared with the REST API, which *is* tested). It has **not** been
  verified against a live phone call — that requires real Twilio/Gemini credentials and
  a real phone, which this environment doesn't have. Phase 6 in plan.md §8 calls this out
  explicitly ("test call quality/latency under real phone network conditions, not just
  localhost") — do that before relying on this in production.

## Tenant isolation

Postgres's Row-Level Security is gone along with Postgres — there's no DB-enforced
"tenant A can never see tenant B's rows" guarantee anymore. `src/db.js`'s `withTenant()`
is the mitigation: every tenant-facing route goes through it, and it force-merges
`business_id` into every filter/insert so a route can't accidentally query cross-tenant
by forgetting a clause. `withSystemAccess()` is the explicit, request-input-free escape
hatch for the handful of operations that are legitimately cross-tenant (login-by-email,
the two background workers) — grep for it if you're auditing what bypasses the boundary.
This is weaker than DB-enforced RLS; it's what "no database-level guarantee for this
part" costs when moving off Postgres.

## Background workers

`npm start` runs two interval-based pollers in-process (not separate deploys — see
plan.md §8's "simple job queue" note):
- Calendar sync (`src/calendar/sync-worker.js`, every 15s): mirrors confirmed/cancelled
  bookings to Google Calendar, retrying failures up to 10 attempts.
- Reminders (`src/notifications/reminder-worker.js`, every 5 min): sends the 24h/1h
  reminder SMS/email for upcoming bookings.

## Known open items from plan.md §10

These were given defaults rather than blocking the build (see plan.md §10 for the
reasoning): English-only, Google Calendar only (no Outlook), inbound-only (no outbound
reminder *calls*, only SMS/email), no SaaS pricing tiers yet. Revisit if requirements change.
