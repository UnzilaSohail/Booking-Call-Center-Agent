# Test cases

Written test cases with the code that runs them. Use cases: `USE_CASES.md`. Open defects found by these tests: `KNOWN_GAPS.md`.

**Status legend:** `Pass` = automated, ran green on 2026-09-30 · `Gap` = automated, written to fail until the gap is fixed (shows as `todo`, does not fail the suite) ·
`Planned` = designed, waiting for the feature · `Manual` = human checklist (UAT).

## How to run

```bash
npm run local-db                      # local MongoDB replica set (transactions need a replica set)
MONGODB_URI="mongodb://127.0.0.1:27117/?replicaSet=rs0" MONGODB_DB_NAME=booking_call_center_test npm run migrate
MONGODB_URI="mongodb://127.0.0.1:27117/?replicaSet=rs0" MONGODB_DB_NAME=booking_call_center_test npm test
node --test --test-reporter=spec test/raceConditions.test.js   # one file, readable output
TEST_VERBOSE=1 npm test               # also print the "SMS/Email not sent" lines that are hidden by default
node scripts/wsSmoke.js 100 http://localhost:3000              # socket burst against a running server
```
Without `MONGODB_URI` the database tests skip cleanly and only the pure tests run. Each test creates its own tenant and deletes it afterwards.

## Latest run — 2026-09-30, local replica set

`npm test` on 2026-10-01, after the team and the invite-email UI work's fixes: **135 tests, 134 pass, 0 fail, 1 gap (todo)** after the public booking page and directory were added (25 new tests). Only MT-06 (KG-09) is still open. On 2026-09-30 the first run was 96 tests, 90 pass, 6 gaps. `node scripts/wsSmoke.js 100`: 100 of 100 sockets closed by the server, `/health` still OK (173 ms).
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
| MT-06 | 10 simultaneous first-time upserts | One record, no errors (KG-09) | Gap |

## CC — Concurrent calls
| ID | Scenario | Expected | Status |
|---|---|---|---|
| CC-01 | 100 sockets to `/voice/stream` at once with garbage frames and an unknown business | Every socket closed by the server, `/health` still OK | Pass (`scripts/wsSmoke.js`, manual run) |
| CC-02 | AI session fails to start | Caller hears a message, callback record created, outcome `failed: ai_unavailable` | Planned (Plan 4, Jira 27c/27d) |
| CC-03 | Call closed by the server | Transcript, outcome and duration still saved | Planned (Plan 4, Jira 27e) |
| CC-04 | `MAX_CONCURRENT_CALLS` reached | "All lines busy" message + callback | Planned (Plan 4, Jira 27f) |
| CC-05 | N real phones at once | Each call answered, no cross-talk, quota respected | Manual (UAT-04, teammate) |

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
| UAT-04 | Place 5-10 calls at the same time from different phones | All answered, no dead air, each transcript separate |
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
