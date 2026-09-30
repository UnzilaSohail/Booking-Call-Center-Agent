# Use-case catalogue

What people and systems do with the platform, written once so tests, Jira and the UI all point at the same list.
Status: **Live** = works today, **Planned** = designed in `docs/plans/`, not built yet.
Each use case lists the test cases that cover it (see `TEST_CASES.md`).

Actors: **Caller** (phones a business), **Customer** (uses the web page), **Staff** (dashboard), **Owner**, **AI agent**, **Platform admin**, **Teammate** (server/ops).

## A. Customer books on the web without calling — Built, awaiting deploy
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-A1 | New customer opens a business link and books | Booking and customer created, confirmation on screen + SMS/email with manage link | PB-01 |
| UC-A2 | Returning customer (known from earlier phone calls) books on the web with the same phone | Matched to the same customer record, history unified, no pre-fill | MT-03, PB-02 |
| UC-A3 | Customer chooses a specific stylist ("Jessica") | Only staff who offer the service are listed; booking assigned to Jessica | PB-03 |
| UC-A4 | Customer chooses "Any available" | Server assigns a free eligible staff member; conflicts retried | PB-04, PB-05 |
| UC-A5 | Two customers pick the same slot together | One booking; the other sees "just taken" and fresh slots | PB-06, RC-02 |
| UC-A6 | Customer double-clicks or the browser retries | One booking (idempotency key) | PB-07, RC-11 |
| UC-A7 | Customer submits a time outside opening hours | Refused | PB-08, VB-07 |
| UC-A8 | Business is suspended or closed | Friendly message, no data leaked | PB-09 |
| UC-A9 | Bot or spam submits the form | Honeypot and rate limits stop it; daily cap protects SMS spend | PB-10, PB-11 |

## B. Customer finds the right business — Built, awaiting deploy
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-B1 | Customer searches "ABC Salon" | Only that business (and same-name ones) listed with city/address | DR-01, DR-02 |
| UC-B2 | Two "ABC Salon"s in different cities | Told apart by city and address on the result cards | DR-02 |
| UC-B3 | Customer searches category "Dentist" in a city | Only listed dentists in that city | DR-03 |
| UC-B4 | Customer searches a service word ("teeth cleaning") | Businesses offering it, customer picks one before seeing slots | DR-03 |
| UC-B5 | Business is not listed | Not in search, direct link still works | DR-04 |
| UC-B6 | Customer booked the wrong business | Business name + address on every screen and message; free cancel via manage link | UAT-12 (header checked in the browser) |

## C. Caller books by phone — Live
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-C1 | Caller books an available slot | Booking created, confirmation sent | VB-06, UAT-01 |
| UC-C2 | Caller wants a slot that was just taken | Agent explains and offers alternatives; the miss is logged for staff | VB-01, RC-01 |
| UC-C3 | Caller asks for a named stylist | Booking assigned to that staff member; unknown name is an error | VB-08 |
| UC-C4 | Caller reschedules | Moves atomically; if the new slot is taken the old one is kept | VB-04, RC-09 |
| UC-C5 | Caller cancels | Slot freed for others | RC-08a |
| UC-C6 | Caller asks a question | Answered from the published knowledge base | UAT-05 |
| UC-C7 | Caller phones when the business has no hours saved | No slots offered, callback taken (production incident 2026-09-29) | VB-05 |
| UC-C8 | AI cannot start | Caller hears a message, staff get a callback record (today: silence) | CC-02 (planned), UAT-10 |
| UC-C9 | Caller asks for a human | Warm transfer or callback | existing `transferRouting` tests, UAT-09 |

## D. Staff and dashboard — Live
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-D1 | Staff books a customer manually | Same rules and locks as the voice path | RC-01 |
| UC-D2 | Staff reschedules or cancels | Locks moved/freed in one transaction | RC-08a, RC-09, RC-10 |
| UC-D3 | Staff overrides opening hours | Allowed on purpose (manager override) | KG-02 |
| UC-D4 | Staff sees where a booking came from | Source badge phone / web / dashboard | PB-12 (planned) |
| UC-D5 | Staff works the exceptions queue | Failed bookings, sync/SMS failures listed, assign/resolve/retry | existing `exceptions` tests |

## E. Concurrency — Live
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-E1 | Caller and staff book the same 2pm slot at the same moment | Exactly one wins; loser gets a clear conflict | RC-01 |
| UC-E2 | Twenty requests for one slot | One booking, nineteen 409 | RC-02 |
| UC-E3 | Different staff at the same time | Both succeed | RC-03 |
| UC-E4 | Overlapping or back-to-back bookings, buffers | Overlap blocked, adjacent allowed, buffer respected | RC-04, RC-05, RC-06, RC-07 |
| UC-E5 | Cancel racing a new booking | Never two confirmed on one slot; locks match reality | RC-08b |
| UC-E6 | Two reschedules into one slot | One wins, loser keeps its slot | RC-10 |
| UC-E7 | Sixty parallel bookings on distinct slots | No false conflicts | RC-16 |
| UC-E8 | Many phone calls at once | Each call isolated; socket layer survives | CC-01, UAT-04 |

## F. Multi-tenant and identity — Live
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-F1 | Same person books at a salon and a dentist | Two independent customer records | MT-01 |
| UC-F2 | One business reads another's data | Impossible even by id | MT-02, RC-12 |
| UC-F3 | Same number in different formats | One customer | MT-04, MT-05 |
| UC-F4 | Simultaneous first-time customer creation | One record, no errors | MT-06 (gap) |

## G. Notifications and team — mixed
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-G1 | Booking confirmation SMS/email | Sent when a provider is configured and the customer consented | existing `notifyConsent` tests |
| UC-G2 | Provider not configured | Booking still succeeds; skip is logged | RC-* run this way |
| UC-G3 | Owner invites a team member | Invite created, link emailed | existing `teamInvite` tests |
| UC-G4 | Invite email not delivered (SendGrid unset) | Owner sees a warning and can copy/resend the link (today: silent) | EM-01 (planned), UAT-06 |
| UC-G5 | Invited person accepts and sets a password | Account active | existing `teamInvite` tests |

## H. Reliability and operations
| ID | Use case | Expected | Tests |
|---|---|---|---|
| UC-H1 | Server restarts during calls | Calls drop; nothing corrupt in the database | UAT-11 |
| UC-H2 | Gemini quota exceeded | Graceful message + callback, not silence | CC-02 (planned) |
| UC-H3 | Call ends by server action (watchdog, transfer) | Transcript and duration still saved | CC-03 (planned) |
| UC-H4 | Transcript captured for both sides | Caller and agent lines in `call_logs.transcript` | UAT-05 |

## I. Billing — Live (covered by existing tests)
Usage and invoice maths, period close, suspension after a failed payment: `billingPlans`, `billingUsage`, `billingWorker`.

## J. Customer portal "My appointments" — Planned (Plan 1, Stage 2)
Verified customer sees upcoming/past appointments, reschedules, cancels, edits preferences, exports or deletes data. Tests come with the build (Jira 19u).
