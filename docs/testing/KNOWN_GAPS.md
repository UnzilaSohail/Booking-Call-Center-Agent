# Known gaps register

Found by code review and by the tests in `test/`. Gaps with an automated test show as `todo` in `npm test`
(they run and report, but do not fail the suite) and turn into normal passing tests when fixed.
Jira numbers refer to the AIN board.

| ID | Gap | Impact | Evidence | Planned fix |
|---|---|---|---|---|
| KG-01 | Slot locks are not aligned to the 5-minute grid (`slotLockIds` steps from the raw start time) | 14:02 and 14:00 for the same staff do not collide, so a double booking is possible when a start time is not on the grid (dashboard API accepts any time) | test RC-07 (todo) | Jira 28d |
| KG-02 | `createBooking` only re-checks minimum notice and booking window, not opening hours, holidays, staff hours, breaks or time off | A caller (voice), a crafted request or a stale page can book at 23:00 when the business closes at 18:00 | test VB-07 (todo) | Jira 28b/28c (`isSlotOffered`), used by voice and the public page; dashboard stays permissive on purpose (staff override) |
| KG-03 | Bookings with no staff use lock namespace `none`; named-staff bookings use the staff id, so they never block each other | "Any staff" booking and a named-staff booking can share one time | test RC-13 (characterisation) | Public page always assigns a concrete staff (Jira 17g) |
| KG-04 | A misheard staff name resolves to `null` and the booking is created with nobody assigned | Caller wanted Jessica, gets an unassigned booking, agent says "booked" | test VB-08 (todo) | Jira 28a |
| KG-05 | Idempotent replay ignores status: cancel then rebook the identical slot inside one call returns the cancelled booking as if confirmed | Rare, same-call only | reviewed, no test yet | Jira 28g |
| KG-06 | `rescheduleBooking` does not check status or minimum notice | Rescheduling a cancelled booking leaves locks on a cancelled booking | test RC-14 (todo) | Jira 28e |
| KG-07 | If the Gemini session fails to start (bad key, quota, model 404) the caller hears silence until the 15-minute cap; nothing is logged for staff | Lost calls, no follow-up. Happened in production on 2026-09-29 (missing key) | reviewed (`twilioBridge` start handler only logs) | Jira 27c, 27d |
| KG-08 | Phone numbers are not normalised with a country code: `5550200005` and `+15550200005` are different customers | A returning customer typing a local number on the web is treated as new | test MT-05 (todo) | Jira 18b |
| KG-09 | `upsertCustomer` is find-then-insert: simultaneous first-time upserts for one phone throw a duplicate-key error for the losers | Harmless today (booking still succeeds, error logged); would surface as a failed web booking | test MT-06 (todo) | Jira 18p |
| KG-10 | Transcript, outcome and `duration_seconds` are only saved when Twilio sends `stop`; a server-initiated close (watchdog, Gemini ended, transfer) may skip it | Lost transcript and lost billable minutes | reviewed | Jira 27e |
| KG-11 | No cap or queue on concurrent calls; limits are the Gemini Live quota of the single API key, Twilio and the Mongo pool | Overload shows up as failed Gemini sessions (KG-07) | reviewed | Jira 27f, 27m |
| KG-12 | Silence watchdog never fires because every Twilio media frame (even silence) refreshes `lastMediaAt` | Dead lines stay open until the 15-minute cap | reviewed | Jira 27k |
| KG-13 | Reminder, billing and sync workers run inside the web process; PM2 cluster mode would run each N times (reminder sweep is find-then-send) | Duplicate reminder SMS if clustered | reviewed | Jira 27j |
| KG-14 | Slot-lock documents are never deleted for old bookings | Slow collection growth | reviewed | Jira 28h |
| KG-15 | Staff time off created after bookings exist is not checked against those bookings | Booked customers on a day the staff later takes off | reviewed | Jira 28i |
| KG-16 | `service_ids` on staff (which services a staff member does) is only a UI filter, not enforced when booking | Staff can be booked for services they do not offer | reviewed | Jira 17h |
| KG-17 | No temporary slot hold between checking availability and booking | Two people can both see a slot, one then gets "just taken" | reviewed (roadmap item 5n) | Jira 17w (friendly recovery); real hold later |
