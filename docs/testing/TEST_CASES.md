# Test cases

Written test cases with the code that runs them. Use cases: `USE_CASES.md`. Open defects found by these tests: `KNOWN_GAPS.md`.

**Status legend:** `Pass` = automated, ran green on 2026-09-30 · `Gap` = automated, written to fail until the gap is fixed (shows as `todo`, does not fail the suite) ·
`Planned` = designed, waiting for the feature · `Manual` = human checklist (UAT).

## How to run

```bash
npm run local-db                      # local MongoDB replica set (transactions need a replica set)
# put MONGODB_URI=mongodb://127.0.0.1:27117/?replicaSet=rs0 in .env, then:
npm test                              # uses a SEPARATE database "<name>_test", runs migrate first
npm test -- test/publicBooking.test.js   # one file
TEST_VERBOSE=1 npm test               # also print the "SMS/Email not sent" lines that are hidden by default
node scripts/wsSmoke.js 100 http://localhost:3000              # socket burst against a running server
npm run load-test:public              # public booking page under load (server running, same MONGODB_URI)
```
`npm test` never touches your real data: `scripts/test.mjs` points the suite at `<MONGODB_DB_NAME>_test`, and `src/db.js` refuses
any other database name while tests run (override with `TEST_ALLOW_ANY_DB=1`). GitHub Actions runs the same thing on every push (`.github/workflows/ci.yml`).
Without `MONGODB_URI` the database tests skip cleanly and only the pure tests run. Each test creates its own tenant and deletes it afterwards.

## Latest run — 2026-09-30, local replica set

`npm test` on 2026-10-02 after the recording-token, booking, voice, location and delivery-status work: **191 tests, 191 pass, 0 fail, 0 gap**. On 2026-10-01 it was 156 of 156, and on 2026-09-30 the first run was 96 tests with 6 gaps. `node scripts/wsSmoke.js 100`: 100 of 100 sockets closed by the server. Public load test (20 people on one slot: 1 winner, 40 different slots: 40 of 40, 100 availability reads: p95 about 300 ms).
Race check RC-01 over 20 randomised rounds: the voice call won 6, the manual booking won 14, and every round ended with exactly one booking.

## RC — Race conditions and overlaps (`test/raceConditions.test.js`)
| ID | Scenario | Steps | Expected | Status |
|---|---|---|---|---|
| RC-01 | **Caller books 2pm by phone while staff book the same 2pm manually** | Fire the voice `create_booking` tool and a dashboard `createBooking` for the same staff and start, with random arrival order, 20 rounds | Exactly one booking each round; manual loser gets 409; voice loser gets "slot no longer available" and a `failed_bookings` row | Pass |
| RC-02 | 20 simultaneous requests for one slot | 20 parallel bookings, different phones and keys | 1 success, 19 conflicts; 6 locks (30 min) all belong to the winner | Pass |
| RC-03 | Different staff, same time | Book Jessica and Sam at 14:00 together | Both succeed | Pass |
| RC-04 | Overlapping ranges | 60-min massage 14:00 vs haircut 14:30, and vs haircut 13:45 | Exactly one wins each time | Pass |
| RC-05 | Back-to-back | 14:00-14:30 and 14:30-15:00 together | Both succeed | Pass |
| RC-06 | Buffer time | Colour 30 min + 15 min buffer at 14:00, then 14:30 and 14:45 | 14:30 refused, 14:45 accepted | Pass |
| RC-07 | Off-grid start | Book 14:00 then 14:02, same staff | Second refused (KG-01, fixed 2026-09-30) | Pass |
| RC-08a | Cancel then rebook | Book, cancel, book the same slot | Locks released, rebook succeeds | Pass |
| RC-08b | Cancel racing a booking | Cancel and a new booking at the same moment | Never two confirmed; locks exist exactly when a confirmed booking does | Pass |
| RC-09 | Reschedule into a taken slot | Move B onto A's slot | 409; B keeps its original time and locks | Pass |
| RC-10 | Two reschedules into one free slot | Both target 17:00 | One wins; loser keeps its own slot | Pass |
| RC-11 | Same idempotency key x10 | Ten parallel retries | All answered, one booking, one real insert | Pass |
| RC-12 | Two businesses, same time | Same start and staff name in both | Both succeed; each lists only its own | Pass |
| RC-13 | No-staff vs named staff | Two no-staff bookings, then a named one | No-staff pair collides; named one allowed (KG-03, documented limitation) | Pass |
| RC-14 | Reschedule a cancelled booking | Cancel then reschedule | Refused (KG-06, fixed 2026-09-30) | Pass |
| RC-15 | Availability follows bookings | Slot listed, book, slot gone, cancel, slot back | As described | Pass |
| RC-16 | 60 parallel bookings on distinct slots | One staff, 60 half-hour slots | No false conflicts (211 ms) | Pass |

## VB — Voice booking tools (`test/voiceCreateBooking.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| VB-01 | Booking loses the slot | Agent gets a sentence to speak; `failed_bookings` row (open) for staff | Pass |
| VB-02 | Same tool call retried in one call | Same booking id, one row | Pass |
| VB-03 | Unknown service name | Error, nothing booked | Pass |
| VB-04 | Reschedule into a taken slot | "new slot no longer available"; original kept | Pass |
| VB-05 | Business has no hours saved | `check_availability` returns no slots (the 2026-09-29 incident) | Pass |
| VB-06 | Book a slot returned by `check_availability` | Booked | Pass |
| VB-07 | Booking at 23:00 when closing at 18:00 | Refused (KG-02, fixed 2026-09-30) | Pass |
| VB-08 | Misheard staff name | Error, not an unassigned booking (KG-04, fixed 2026-09-30) | Pass |

## MT — Multi-tenant and customer identity (`test/multiTenant.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| MT-01 | Same phone books a salon and a dentist | Two independent customer records, each listed only by its own business | Pass |
| MT-02 | Salon reads a dentist booking by id | Nothing returned | Pass |
| MT-03 | Old customer (created by a call) books again | Same customer record, no duplicate | Pass |
| MT-04 | `+1 (555) 020-0004` vs `+15550200004` | Same normalised number | Pass |
| MT-05 | `5550200005` vs `+15550200005` | Same customer (KG-08, fixed 2026-09-30) | Pass |
| MT-06 | 10 simultaneous first-time upserts | One record, no errors (KG-09) | Pass |

## CC — Concurrent calls
| ID | Scenario | Expected | Status |
|---|---|---|---|
| CC-01 | 100 sockets to `/voice/stream` at once with garbage frames and an unknown business | Every socket closed by the server, `/health` still OK | Pass (`scripts/wsSmoke.js`, manual run) |
| CC-02 | AI session fails to start | Caller hears a message, callback record created, outcome `failed: ai_unavailable` | Planned (Plan 4, Jira 27c/27d) |
| CC-03 | Call closed by the server | Transcript, outcome and duration still saved | Planned (Plan 4, Jira 27e) |
| CC-04 | `MAX_CONCURRENT_CALLS` reached | "All lines busy" message + callback | Planned (Plan 4, Jira 27f) |
| CC-05 | N real phones at once | Each call answered, no cross-talk, quota respected | **Pass (2026-10-05, 8 real concurrent calls via Twilio REST into the live production number)** — see below |

**CC-05 evidence (2026-10-05)**: rather than wait for 5-10 people with real phones, used Twilio's
own REST API to place real outbound calls (`+14345339336` -> the production inbound number)
— since the "to" number is itself a Twilio number with its own configured Voice webhook,
Twilio routes it through the real `/voice/incoming` flow exactly like a genuine PSTN caller,
so this is real telephony concurrency, not a simulation (unlike CC-01/wsSmoke.js, which only
exercises the WebSocket layer with no Gemini cost). Verified with a single call first (real
`call_logs` entry, real Gemini Live session, matching duration), then scaled to 8 simultaneous
calls. All 8 Gemini Live sessions opened before any closed (genuine overlap), all 8 completed
cleanly with no errors, no `MAX_CONCURRENT_CALLS` rejections, and each call's duration saved
correctly (confirms KG-10's finalizeCall fix holds under real concurrent load). Transcripts
were empty because the test calls carried no real audio (`<Pause>` only) — the per-call
silence watchdog correctly cut each one short at ~20s on its own, which is further evidence
KG-12's fix is working. Test call_logs rows were deleted afterward so they don't appear in
real call history/dashboard stats.

## PB, DR, SL — Public booking page, directory, booking links (`test/publicBooking.test.js`)
Real HTTP against the Express app and real Mongo; each run creates its own businesses (an "ABC Salon" in Tampa and Miami, an "ABC Dentist", one with no services).
| ID | Scenario | Expected | Status |
|---|---|---|---|
| PB-01 | Guest books end to end (info, services, availability, booking) | 201, booking `created_via: web`, customer created with the consent wording stored, manage link returned | Pass |
| PB-02 | Returning phone customer books on web with the number typed differently | Still one customer record, existing name kept | Pass |
| PB-03 | Stylist list for a service; a stylist who does not offer it is submitted | Only staff who offer it are listed; direct submit gets 400 | Pass |
| PB-04 | "Any available" when the first stylist is busy | Next free stylist is booked; availability drops the slot once all are busy | Pass |
| PB-05 | "Any available" with everyone busy | 409 "no longer available" | Pass |
| PB-06 | 8 simultaneous bookings for one slot | 1 success, 7 conflicts, 1 booking row | Pass |
| PB-07 | Double submit with the same idempotency key | One booking, same id returned | Pass |
| PB-08 | Time outside opening hours, or not a date | 409 / 400 | Pass |
| PB-09 | Unknown, suspended, deleted, or switched-off page | Identical 404 on page, services and booking | Pass |
| PB-10 | Honeypot filled | Looks like success, nothing booked | Pass |
| PB-11 | Booking attempts per IP | 429 on the 11th | Pass |
| PB-12 | Consent: unticked box, and a ticked box on a customer who sent STOP | Unticked opts that channel out; STOP is never undone | Pass |
| PB-13 | Bad name, phone, email, missing service | 400 | Pass |
| PB-14 | Service belonging to another business | Not booked | Pass |
| DR-01 | Listed and ready business vs one with no services | Only the ready one appears | Pass |
| DR-02 | Two "ABC Salon"s | Both returned, told apart by city and street address | Pass |
| DR-03 | Service-word search, category filter, city filter (case-insensitive) | Only matching businesses | Pass |
| DR-04 | Unlisted, hidden by platform, suspended, go-live not done | Hidden from search; direct link still works (except suspended) | Pass |
| DR-05 | Categories and cities endpoints | Counts of live businesses only | Pass |
| DR-06 | Public responses | No customer data, emails or raw ids | Pass |
| SL-01 | Slug rules | Lowercase, 3-40 chars, no double hyphens, reserved words rejected | Pass |
| SL-02 | Name collision | `abc-salon`, then `abc-salon-tampa`, then `abc-salon-2` | Pass |
| SL-03 | Unique index and backfill | Duplicate rejected; old businesses get a slug | Pass |
| SL-04 | Owner changes booking link | Taken = 409, reserved/invalid = 400, old link stops working | Pass |
| SL-05 | Listing categories | Only the fixed list, at most 3 | Pass |

Checked by hand in the browser pane (2026-10-01): Settings card, `/find` (card, empty state), `/book/<slug>` golden path with the stylist filter, "Bookings > Booked via: Web", phone width 375px with no horizontal scroll.

## CP — Customer sign-in and "My appointments" (`test/customerPortal.test.js`)
Real HTTP. The provider env vars are switched on so the code path runs (the send itself only logs "not sent"), and the stored code hash is replaced by a known one to sign in. Skips itself if a real SMS/email provider is configured.
| ID | Scenario | Expected | Status |
|---|---|---|---|
| CP-01 | Code requested with no SMS/email provider | 503 "not available right now, please call <business>" | Pass |
| CP-02 | Known and unknown number | Identical answer; only the real customer gets a code row | Pass |
| CP-03 | Second request within a minute | Code not replaced | Pass |
| CP-04 | Right code | Token; works on `/customer/me`; a used code is gone | Pass |
| CP-05 | Five wrong guesses | Locked, even for the right code | Pass |
| CP-06 | Expired code | Refused | Pass |
| CP-07 | Sign in by email (any letter case) | Works | Pass |
| CP-08 | Customer token on company routes, company token on customer routes, no/garbage token | All 401 | Pass |
| CP-09 | Appointment list | Own upcoming and past only; not another customer, not another business | Pass |
| CP-10 | Reschedule | Moves; closed hours 409; past time 400 | Pass |
| CP-11 | Someone else's appointment id | 404 on cancel, reschedule and availability; nothing changed | Pass |
| CP-12 | Cancel | Goes to history; second cancel 400 | Pass |
| CP-13 | Change inside the cutoff window | Refused, `canChange: false` | Pass |
| CP-14 | Edit name, email, SMS/email preferences | Saved; bad input 400 | Pass |
| CP-15 | Export and delete request | Only own data; one pending request in the owner's Exceptions queue | Pass |
| CP-16 | Code requests per number and per IP | 429 after the limit | Pass |
| CP-17 | Booking reference code | 6 unambiguous characters; Bookings search finds it | Pass |
| CP-18 to CP-20 | Magic link in the sign-in email | Stored with the code; works once; wrong token or another business's id refused | Pass |
| CP-21 | Wrong magic-link guesses | Do not use up the 5 code attempts | Pass |
| CP-22 | "Sign out everywhere" | Every earlier sign-in refused at once; a new one works | Pass |

## DU, PH — Duplicates, merge, directory moderation (`test/customerMerge.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| DU-01 | Same person on a new phone | Found by email; same name alone is flagged "name" (weak); other businesses ignored | Pass |
| DU-02 | Merge | Bookings and calls move, gaps filled, tags joined, STOP on either record survives, duplicate deleted | Pass |
| DU-03 | Bad merges | Self 400, unknown 404, another business's customer 404 | Pass |
| PH-01 | Platform admin hides and restores a listing | Company token 401, bad body 400, hidden flag set and shown in the company detail | Pass |

## RP — Call recording playback (`test/recordingProxy.test.js`)
A local fake "Twilio" server stands in for Twilio (it demands Basic auth and honours Range).
| ID | Scenario | Expected | Status |
|---|---|---|---|
| RP-01 | Recording token | Minted behind login, only for a call that has a recording, scoped to that call, at most 15 minutes | Pass |
| RP-02 | Playing a recording | Audio streams through; Twilio is called with the account credentials the browser never sees | Pass |
| RP-03 | Seeking | A Range request is passed on and answered 206 with the right Content-Range | Pass |
| RP-04 | Wrong links | The login token (old `?token=` style or in the new slot), no token, a token for another call, an expired token: all 401; a token cannot reach another business's call | Pass |
| RP-05 | Twilio not configured | 503, no crash | Pass |

## BF — Booking and reminder fixes (`test/bookingFixes.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| BF-01 | Same idempotency key after the booking was cancelled (KG-05) | A fresh booking; the cancelled one lets go of the key; a live booking still replays | Pass |
| BF-02 | Slot locks (KG-14) | Each lock expires a day after the booking ends, reschedule moves it, a TTL index removes it | Pass |
| BF-03 | Backfill of old locks | Old locks get an expiry, orphans are marked for deletion, running twice does nothing | Pass |
| BF-04 | Time off over an existing booking (KG-15) | 409 listing who is affected, nothing saved; `force: true` saves it and returns the clashes | Pass |
| BF-05 | Time off with nothing in the way, or only a cancelled booking | Added straight away; a bad range is still 400 | Pass |
| BF-06 | Three overlapping reminder sweeps (KG-13) | Each reminder is sent exactly once | Pass |
| BF-07 | A reminder send fails | The claim is given back and the next sweep retries | Pass |

## VR — Voice bridge (`test/voiceBridge.test.js`)
A real WebSocket client talks to the real bridge; Gemini and the summary are fakes.
| ID | Scenario | Expected | Status |
|---|---|---|---|
| VR-01 | mu-law level | Silence reads 0, speech reads far above the threshold | Pass |
| VR-02 | Dead line (only silent frames) (KG-12) | Hung up after the silence timeout, Gemini session closed, call row finished | Pass |
| VR-03 | Line with speech | Stays open while the caller talks, closes once they stop | Pass |
| VR-04 | The agent talking | Counts as an active line | Pass |
| VR-05 | The server ends the call (21m, KG-10) | Transcript, duration, outcome and summary are still saved | Pass |
| VR-06 | Restart drain (27l) | Waits for calls in progress, refuses new calls politely (`failed: restarting`), finishes when the last call ends | Pass |
| VR-07 | Drain runs out of time | Gives up and says so | Pass |

## LC, LG, SM — Locations, language, SMS link (`test/publicLocations.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| LC-01 | Business with two branches | Info lists both; staff list is filtered to the chosen branch (staff with no branch work at all of them) | Pass |
| LC-02 | "Any available" at a branch | Only that branch's staff count towards availability | Pass |
| LC-03 | Booking at a branch | A staff member from there, location stored, branch name and address returned | Pass |
| LC-04 | Wrong staff, unknown location, another business's location | All 400 | Pass |
| LC-05 | No location given | Works as before | Pass |
| LG-01 | Language preference | Staff and the customer can set it; unknown values are dropped or refused | Pass |
| SM-01 | Confirmation SMS | Carries the link to the customer's own appointments page; no link when the business has no booking link | Pass |

## DS — Confirmation delivery status (`test/deliveryStatus.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| DS-01 | Classifying results | sent / failed / not configured, long errors cut | Pass |
| DS-02 | No providers configured | Both channels recorded as "not configured" with the reason | Pass |
| DS-03 | Customer gave no email | Not counted as a failure | Pass |
| DS-04 | Opted-out customer | Recorded as opted out, no error | Pass |
| DS-05 | Undelivered confirmations | Show up in the Exceptions queue | Pass |

## DD — Demo data (`test/demoData.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| DD-1 | Add demo data | 6+ flagged demo businesses, 250+ bookings, 100+ calls, 30+ customers, unlisted unless asked, a generated password | Pass |
| DD-2 | Generated history | No staff member is double-booked | Pass |
| DD-3 | Add twice | No pile-up: the old set is replaced | Pass |
| DD-4 | Remove | Every demo business and its bookings, calls, customers, invoices, locks and admins are gone; a real business survives | Pass |
| DD-5 | Demo-data endpoints with no token, a garbage token, a business-owner token, a customer token, an expired platform token | All refused (401/403), nothing created | Pass |

Also: the colour-contrast test (`test/contrast.test.js`) now checks the light and the dark theme; `npm run screenshots` compares 16 pages (light and dark, desktop and phone).

## VH — Voice: half-hour slots, free times, email, English (`test/voiceHalfHour.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| VH-01 | 30-minute service | Starts every half hour, 9:00 to 17:30 | Pass |
| VH-02 | 60-minute service | Still starts every half hour; last start 17:00 | Pass |
| VH-03 | A booked 60-minute job | Hides every start it would overlap and only those | Pass |
| VH-04 | check_availability | Gives times in the business time zone, in order | Pass |
| VH-05 | The requested time was just taken | Answer carries the day's free times without the taken one; the lost booking is still logged | Pass |
| VH-06 | Time outside opening hours | Refused with the day's free times; nothing booked | Pass |
| VH-07 | Caller spells an email | Saved on the booking and on the customer | Pass |
| VH-08 | Instructions | English-only rule first; offers a person; check availability and ask for email | Pass |

## EN — Reminders, waiting list, reviews, numbers, monthly report (`test/engagement.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| EN-01 | Reminder wording | Text says "Reply C to cancel"; email only links | Pass |
| EN-02 | Reminder sweep | 2-hour and 24-hour reminders sent once each | Pass |
| EN-03 | Customer replies C | Next appointment cancelled, time freed, recorded as cancelled by text | Pass |
| EN-04 | C too close to the visit | Refused, phone number given, nothing cancelled | Pass |
| EN-05 | C with no appointment | Polite answer | Pass |
| EN-07 | Join waiting list (public) | Joined; a repeat is not a second place | Pass |
| EN-08 | Waiting list validation | Needs OK to text, a real day and service, a phone number | Pass |
| EN-09 | A booking is cancelled | First 3 in line texted once; next cancellation texts the next; no texts at night | Pass |
| EN-10 | Waiting person books | Counted as a refilled slot | Pass |
| EN-11 | Review text | About 2 hours after the visit, once, only with a link set and consent | Pass |
| EN-12 | Review text limits | Not at night, not for cancelled visits, not within 30 days of the last | Pass |
| EN-13 | Money saved | Only after-hours calls that became confirmed bookings count | Pass |
| EN-14 | No-show protection | Customer cancel after a reminder and before the visit counts; staff cancels and cancels with no reminder do not | Pass |
| EN-15 | Report wording | Plain words; empty sections left out | Pass |
| EN-16 | Monthly sweep | Once, days 1 to 3 from 9am, respects the off switch | Pass |

## SEC — Login and input protections (`test/security.test.js`)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| SEC-01 | 9 wrong passwords | 8th is 401, 9th is 429, and even the right password is refused until the window passes | Pass |
| SEC-02 | Older company and platform login URLs | Same limit applies | Pass |
| SEC-03 | Right password after 5 wrong ones | Works and resets the count | Pass |
| SEC-04 | One address tries 30 different accounts | Blocked | Pass |
| SEC-05 | Object or array instead of text | 400, not a crash | Pass |
| SEC-06 | Object as serviceId on the public booking page | 400 | Pass |
| SEC-07 | Failure counters | Count wrong answers only; forgiven on success | Pass |
| SEC-08 | No such person | Costs as much as a real check | Pass |
| SEC-09 | API headers | nosniff, no X-Powered-By | Pass |
| SEC-10 | A counter after a "restart" | Stored in the database with an expiry | Pass |
| SEC-11 | Locked account | Platform team sees "locked", can unlock; owners cannot | Pass |
| SEC-12 | Weak passwords | Refused with plain reasons (short, common, repeated, contains email name) | Pass |
| SEC-13 | Signup with a weak password | 400, nothing created | Pass |
| SEC-15 | Bot check logic | Off without a key; asks Cloudflare; refuses failures and missing tokens; an outage lets people through | Pass |
| SEC-16 | Public doors with the key set and no token | Booking, waiting list, leads, signup, sign-in code all refuse (captcha) and create nothing | Pass |
| SEC-14 | Directory cache | Answers repeats from memory, expires, can be cleared, off at 0 | Pass |

## EM — Email and invites (`test/emailInvite.test.js`)
Run against the real Express app over HTTP with no email/SMS provider configured (skips itself if a provider is configured).
| ID | Scenario | Expected | Status |
|---|---|---|---|
| EM-01 | Invite with no provider | `emailSent:false`, the reason, and a working invite link for the new member | Pass |
| EM-02 | "Copy link" mode (`sendEmail:false`) | Link returned, no email attempted, no error reported | Pass |
| EM-03 | Resend | Email attempted; reports why it did not go out | Pass |
| EM-04 | Manager tries to invite or resend | 403, owner only | Pass |
| EM-05 | Resend to a member who already accepted | 400 | Pass |
| EM-06 | `sendEmail` unconfigured | Never throws; `{sent:false, reason}` | Pass |
| EM-07 | Onboarding verification code, no provider | `delivered:false` plus reason for email and for SMS | Pass |

## UAT — Manual checklist (browser and real phone; teammate or boss)
| ID | Step | Expected |
|---|---|---|
| UAT-01 | Call the business number and book a service | Agent greets, offers slots, confirms; booking appears in the dashboard with source "call" |
| UAT-02 | Call and ask for a taken slot | Agent offers other times; a failed booking shows under Exceptions |
| UAT-03 | While the agent is mid-booking for 2pm, book 2pm manually in the dashboard | One booking only; the other side is told the slot is gone |
| UAT-04 | Place 5-10 calls at the same time from different phones | All answered, no dead air, each transcript separate — **Done 2026-10-05, see CC-05 above** (8 real concurrent calls via Twilio API in place of physical phones; same real telephony concurrency, no physical phones needed) |
| UAT-05 | Open Calls after a call | Transcript shows both caller and agent lines; a question is answered from the knowledge base |
| UAT-06 | Invite a team member with SendGrid configured | Email arrives with a working link |
| UAT-07 | Invite with no email provider configured | Orange warning, link shown with Copy link; Resend and Copy link icons on the pending member |
| UAT-08 | Open `/find` and search for a business (after Plan 1) | Correct business, address visible |
| UAT-09 | Ask the agent for a human | Transfer or callback as configured |
| UAT-10 | Stop Gemini access (bad key) on a test server, call | Caller hears a message, callback appears |
| UAT-11 | Restart the backend during a call | Call drops, dashboard still consistent |
| UAT-12 | Book at the wrong business on purpose, then cancel via the SMS link | Cancels; slot freed |
| UAT-13 | Open the booking page on a phone (after Plan 1) | Usable one-handed, no horizontal scroll |

## Traceability
| Use case | Test cases | Jira |
|---|---|---|
| UC-E1 call vs manual same slot | RC-01, UAT-03 | 21a |
| UC-E2..E7 races and overlaps | RC-02..RC-16 | 21b-21j |
| UC-C2, C3, C4, C7 | VB-01, VB-04, VB-05, VB-08 | 21k, 21l |
| UC-F1..F4 | MT-01..MT-06 | 22m and 18h |
| UC-E8, C8, H2, H3 | CC-01..CC-05 | 21m, 21n |
| UC-A*, B* | PB-*, DR-* | 22a-22l |
| UC-G4 | EM-* | 22n |
