# Booking Call Center Agent — Plan

> Ek AI-powered call center jo phone calls handle kare, bookings le, aur har booking automatically ek calendar mein add ho jaye — admin bhi usi calendar se manually schedule kar sake. Repo abhi khaali hai, is liye yeh plan zero se architecture, stack, data model aur phased build-out define karta hai.

## 1. Problem statement

- Customer call karta hai → AI agent baat karke booking le leta hai (service, date, time, name, phone).
- Booking turant ek calendar mein reflect ho (double-booking na ho).
- Admin ek dashboard se calendar dekh sake, manually bhi slot book/cancel/reschedule kar sake.
- Dono paths (call se aur manual se) same source of truth use karein — conflict-free.

## 2. Core components

| # | Component | Responsibility |
|---|-----------|-----------------|
| 1 | Telephony layer | Call receive/dial, audio in/out |
| 2 | Speech (STT/TTS) | Voice ↔ text |
| 3 | Conversational AI (LLM) | Intent detection, dialogue, function-calling into scheduling tools |
| 4 | Scheduling engine + DB | Source of truth for availability, prevents double-booking |
| 5 | Calendar sync | Push confirmed bookings to Google Calendar (view/share) |
| 6 | Admin dashboard | Calendar view + manual booking/reschedule/cancel |
| 7 | Notifications | SMS/email confirmation + reminders |

### Why a separate DB + calendar sync, not "just Google Calendar"
Google Calendar API has no atomic "reserve if free" primitive and rate limits make it unsafe as the single source of truth under concurrent writes (two callers picking the same slot at once). Pattern used everywhere in production booking systems: **DB is the lock/authority, Calendar is a mirror for humans to view.**

```
Call/Dashboard → check_availability (DB query)
              → create_booking (DB transaction w/ unique constraint)
              → on success: push event to Google Calendar (async, retried)
```

## 3. Recommended stack

| Layer | Choice | Why |
|-------|--------|-----|
| Telephony | **Twilio Voice** (Media Streams) | Real-time bidirectional audio over a WebSocket per call, into our own orchestration server |
| Conversational AI (STT+LLM+TTS) | **Gemini Live API** (realtime, native audio) | Google's realtime multimodal endpoint takes streamed audio in, runs Gemini with function calling, and streams synthesized speech back over one WebSocket — no separate STT/TTS vendor needed |
| Calendar | **Google Calendar API** | Free, universal, has `freebusy` endpoint, every admin already has an account |
| Backend | **Node.js + Express** | Bridges the Twilio Media Stream WebSocket ↔ the Gemini Live WebSocket (resampling audio between Twilio's 8kHz μ-law and what Gemini Live expects), plus the REST API for the dashboard |
| DB | **MongoDB** (replica set — Atlas free tier or local `--replSet`, needed for the multi-document transactions §4 relies on) | Chosen over Postgres/Supabase per explicit instruction; conflict-free booking now built by hand (§4) rather than leaning on a DB-native exclusion constraint |
| Admin dashboard | **Next.js + FullCalendar.js** | FullCalendar is the standard, batteries-included calendar UI component — no need to build one |
| Notifications | **Twilio SMS / SendGrid** | Booking confirmation + reminder |

**Why Gemini Live instead of Gemini-for-text + a separate TTS**: you asked to drop Claude and ElevenLabs for Gemini — the lazy way to do that isn't "Deepgram STT → Gemini text → Gemini TTS" bolted together, it's Gemini's own realtime voice endpoint, which also absorbs Deepgram's job and handles turn-taking/interruption (barge-in) natively. That cuts a vendor and most of the turn-taking code this plan previously scoped as its own build phase. Net effect: **Deepgram and ElevenLabs both drop out**, not just the two you named. If you'd rather keep speech-to-text on a separate proven vendor (e.g. Deepgram) and only use Gemini for the text LLM + text-to-speech steps, say so — that's a valid, slightly more piecemeal alternative.

Caveat: Gemini Live's exact model name, language coverage, and function-calling behavior move fast — confirm current specifics against Google's docs before locking the build, this plan assumes the capability (realtime audio in/out + tool calling in one session) holds.

Confirmed: **multi-tenant SaaS** (multiple businesses on one product), **international** (no India-specific DLT/SMS constraint), **no payment/deposit at booking**, admin dashboard uses **email/password** login (custom JWT + bcrypt, not a third-party auth provider — see §7), **Twilio** for telephony, **Gemini Live** for the conversational voice pipeline, **MongoDB** (not Postgres/Supabase) for the database.

Skipped: multi-region infra, custom calendar UI, payments — none requested; payments is the one likely to come back later if no-shows become costly, everything else genuinely isn't needed yet.

## 4. Data model (multi-tenant)

Every business-scoped table carries `business_id` — this is the one change that ripples through the whole system now that it's confirmed SaaS, not single-business.

Mongo collections, not Postgres tables — `business_hours` is embedded on `businesses`
as a `hours` array rather than a separate collection, since it's always read/replaced as
one whole week at a time (db/schema.js, src/routes/config.js):

```
businesses          (_id, name, timezone, phone_number,      -- phone_number = their dedicated Twilio inbound number
                     google_refresh_token, google_calendar_id, reschedule_cutoff_minutes,
                     hours: [{day_of_week, open_time, close_time}], created_at)
admins              (_id, business_id, email, password_hash, created_at)   -- custom JWT + bcrypt, not a third-party auth provider
services            (_id, business_id, name, duration_minutes, buffer_minutes, price)
staff               (_id, business_id, name, google_calendar_id)  -- skip entirely if a business is single-resource
bookings            (_id, business_id, customer_name, phone, customer_email, service_id, staff_id,
                     start_time UTC, end_time UTC, status, google_event_id,
                     created_via [call|dashboard], idempotency_key, created_at,
                     sync_status, sync_attempts, sync_error, confirmation_sent_at,
                     reminder_24h_sent_at, reminder_1h_sent_at)
booking_slot_locks  (_id: "business_id:staffId:slotStart", business_id, booking_id)  -- see conflict prevention below
call_logs           (_id, business_id, call_sid, phone, transcript, booking_id, outcome, created_at)
```

- **Tenant isolation**: Mongo has no Postgres-RLS equivalent, so this moved to the
  application layer — every tenant-facing query goes through `withTenant(businessId, ...)`
  (src/db.js), which force-merges `business_id` into the filter/document. Weaker than a
  DB-enforced guarantee; `withSystemAccess()` is the explicit, non-request-derived escape
  hatch for the few genuinely cross-tenant operations (login by email, the two background
  workers) — see README.md's "Tenant isolation" section.
- **Call routing**: the inbound webhook's very first job is `business = lookup(business_by_phone_number=called_number)` — everything downstream (services, staff, hours, calendar) comes from that one row. Each business needs its own dedicated inbound number.
- **Calendar OAuth per tenant**: each business connects its own Google account during onboarding; the refresh token lives on `businesses` (or per-`staff` row if a business has multiple staff each with their own calendar).
- **Conflict prevention**: no `EXCLUDE USING gist` equivalent exists in Mongo, so this is
  built by hand via `booking_slot_locks` — a booking's time range is decomposed into
  5-minute slots, each inserted as its own document with a deterministic `_id`
  (`business_id:staffId:slotStart`), in the same multi-document transaction as the
  booking itself. Two concurrent overlapping bookings collide on that `_id`; Mongo's
  unique `_id` index lets exactly one insert win, and the transaction aborts the loser
  cleanly — never rely on "check then insert" in application code alone
  (src/services/bookingService.js has the full implementation).

## 5. Call flow (sequence)

1. Customer calls the business's Twilio number → Twilio answers and opens a **Media Stream** WebSocket to our backend.
2. Backend looks up `business = lookup(business_by_phone_number=called_number)`, opens a **Gemini Live** session (audio in/out + the four tool definitions, scoped to that business's services/hours/staff), and bridges audio both ways between the Twilio and Gemini Live WebSockets.
3. Gemini asks what service/date the customer wants, entirely inside the Live session (speech in → speech out); if the caller talks over the agent, Gemini Live's own interruption handling stops the response — no custom barge-in code needed.
4. Gemini calls `check_availability(service, date)` → backend queries `bookings` + `business_hours` → returns free slots.
5. Gemini speaks the slots back, customer picks one.
6. Gemini **reads the slot back** ("11:30 AM Tuesday for a haircut, confirm?") before booking — speech recognition mishears dates/names often enough that skipping this step is the #1 source of wrong bookings.
7. On explicit yes, Gemini calls `create_booking(..., idempotency_key=call_id+turn_id)` → backend runs DB transaction (fails cleanly if slot just got taken) → on success, enqueues a Google Calendar event creation job. The idempotency key matters because tool-calls get retried on timeouts; without it a retry can create two identical bookings.
8. Backend confirms verbally + sends SMS/email confirmation.
9. Calendar worker creates the Google Calendar event, stores `google_event_id` back on the booking (retry with backoff if the API call fails — booking is already safely in the DB either way).

Reschedule/cancel follow the same shape: look up booking by phone/booking-id → update DB row inside a transaction → update/delete the mirrored Google Calendar event.

## 6. Edge cases this plan accounts for

- **Double-booking**: DB-level exclusion constraint, not app-level checks.
- **Duplicate booking from a retried tool-call**: idempotency key on `create_booking` (see §5).
- **Wrong slot from mis-heard speech**: mandatory verbal read-back/confirm before `create_booking` fires.
- **Staff has a personal/manual event Calendar knows about but the DB doesn't**: `check_availability` also calls Google Calendar's `freebusy` endpoint for that staff's calendar and intersects it with the DB query — DB is still the lock authority for conflict prevention, but Calendar is consulted so a manually-added personal appointment isn't double-booked.
- **Back-to-back bookings with no gap**: `service.duration_minutes` should include buffer/cleanup time, or add a separate `buffer_minutes` column — otherwise a 30-min haircut booked at 10:00 and another at 10:30 leaves zero changeover time.
- **Calendar API failure**: booking still succeeds (DB first); calendar push retried via a queue, not inline in the call flow.
- **Timezones**: store UTC in DB, convert to business timezone for speech/UI only.
- **Cancellation/reschedule via call**: lookup by phone number (+ last booking) or a spoken booking ID; define how close to `start_time` a cancellation/reschedule is still allowed (business rule, e.g. no changes within 2 hours).
- **Business hours/holidays**: `business_hours` table checked in `check_availability`, not hardcoded.
- **After-hours calls**: if outside `business_hours`, Gemini should still be able to take a booking for the next open slot, or state hours and offer a callback/voicemail — decide which before building, since silent failure is worse than either option.
- **No-shows**: reminder job (cron) 24h/1h before `start_time`.
- **AI failure / escalation**: Gemini has a `transfer_to_human` tool for out-of-scope requests.
- **Non-English calls**: Gemini Live supports multiple languages, but coverage/quality per language varies — confirm which languages are actually needed and test that specific language before committing.
- **Spoofed webhooks**: verify Twilio's request signature (`X-Twilio-Signature`, using the account auth token) on every webhook — an unverified webhook endpoint lets anyone POST fake call/booking events.
- **Audio format mismatch**: Twilio Media Streams send 8kHz μ-law audio; Gemini Live expects its own format/sample rate — the bridge needs to resample both directions, or audio comes through garbled/silent.
- **Gemini Live session drop mid-call**: if the WebSocket to Gemini disconnects, the backend needs to either reconnect with context or gracefully end the call ("sorry, having a technical issue, please call back") rather than leaving the caller listening to silence.
- **Dead air / silence handling**: Gemini Live has its own voice-activity detection, but a fully dead line (bad connection) should still be caught by a call-level timeout that ends the call rather than billing for silence indefinitely.
- **Admin dashboard access**: needs auth (see §9) — an unauthenticated dashboard exposes every customer's name/phone/booking history.

## 7. Security & compliance (gap in v1 — no auth/legal/tenancy angle was covered at all)

- **Two admin roles, not one**: a **platform admin** (`platform_admins` collection, no `business_id`) registers companies — there is no public self-signup, and no public way to create a platform admin either (bootstrapped once via `scripts/createPlatformAdmin.js`, run by hand). Each company's own **admin** (`admins` collection, tied to one `business_id`) then manages just that company, same as before. Two separate JWTs (`role: 'platform'` vs `role: 'business'`), each rejected on the other's endpoints (src/platformAuth.js, src/auth.js) — do **not** ship any query that trusts a `business_id` passed from the client instead of derived from the authenticated session, that's the classic multi-tenant data leak.
- **Tenant onboarding flow**: platform admin registers the company (name, timezone, first company-admin email/password) → that admin logs in and sets services/hours/staff → admin connects Google Calendar (OAuth, optional) → admin gets a dedicated inbound phone number provisioned. Needs to exist before the voice agent is useful to a second tenant.
- **Webhook signature verification**: required on every Twilio inbound webhook, not optional.
- **Call recording & transcript consent**: if calls are recorded (useful for QA/dispute resolution), most jurisdictions require an upfront disclosure ("this call may be recorded") — add it as the AI agent's opening line if recording is on.
- **Data retention**: decide how long call recordings/transcripts are kept (e.g. 90 days) rather than storing forever by default; a SaaS product should also support a tenant deleting their own data.
- **Secrets**: per-tenant Google OAuth refresh tokens, plus LLM/telephony API keys and DB credentials, all go in environment variables/secrets storage (an empty `.env` already exists in this repo) — never commit real values, and encrypt refresh tokens at rest since they grant calendar access.

## 8. Build phases

1. **DB + booking API** — schema above, REST endpoints (`GET availability`, `POST booking`, `PATCH/DELETE booking`), unit test for the concurrency constraint.
2. **Admin dashboard** — Next.js + FullCalendar reading/writing the same API (no calendar logic duplicated).
3. **Google Calendar sync worker** — on booking create/update/cancel, push to Calendar; simple job queue (e.g. a `sync_status` column polled by a cron, or BullMQ if volume justifies it).
4. **Voice pipeline (the big one)** — Twilio Media Streams WebSocket handler bridged to a Gemini Live session (audio resampling both directions), with the four tools pointed at the Phase 1 API. Get one call working end-to-end first; turn-taking/interruption comes largely for free from Gemini Live, so this phase is mostly the audio bridge + tool wiring, not custom VAD/barge-in logic.
5. **Notifications** — SMS/email confirmation + reminder cron.
6. **Hardening** — load-test concurrent booking attempts on the same slot, verify only one wins; test call quality/latency under real phone network conditions, not just localhost.

## 9. Resolved decisions

| Question | Decision |
|---|---|
| Single business vs multi-tenant SaaS | **Multi-tenant SaaS** — data model, auth, and calendar OAuth are all per-`business_id` (§4, §7) |
| Region | **International** — no DLT/TRAI SMS registration constraint; standard Twilio/SendGrid works as-is |
| Payment/deposit at booking | **No payment** — bookings are free/unpaid; revisit only if no-shows become a real problem |
| Admin dashboard auth | **Email/password**, custom JWT + bcrypt (no third-party auth provider) |
| Telephony platform | **Twilio** (Media Streams bridged to Gemini Live, more control than an all-in-one voice platform, more build effort — see §3) |
| Conversational AI (LLM + TTS, and STT by extension) | **Gemini Live API** — replaces Claude and ElevenLabs; also absorbs the Deepgram STT role since Live handles audio in/out natively (see §3 for the piecemeal alternative if you'd rather keep STT separate) |
| Database | **MongoDB** (replica set) — replaces PostgreSQL/Supabase per explicit instruction; loses the DB-native exclusion constraint and RLS, both rebuilt by hand (§4) |

## 10. Still open before coding starts

- Confirm the Deepgram-drop is fine (§3) — or say if you want Gemini for text+TTS only, with STT kept on a separate vendor.
- Per business: single resource/calendar, or multiple staff each with their own calendar? (Affects whether the `staff` table is used at all.)
- Calendar target: Google Calendar only, or also Outlook/Microsoft 365? (Outlook support means a second OAuth+API integration per tenant.)
- Call language(s): English only, or others too?
- Outbound calls (reminders, follow-ups) in addition to inbound booking calls, or inbound-only for now?
- Pricing/plan tiers for the SaaS itself (e.g. per-tenant call volume limits) — not needed for an MVP but worth deciding before onboarding a real second tenant.

Defaults if you don't have a strong preference: Gemini Live end-to-end (no separate STT vendor), Google Calendar only, English only, inbound-only — all cheap to change now, expensive after Phase 4.
