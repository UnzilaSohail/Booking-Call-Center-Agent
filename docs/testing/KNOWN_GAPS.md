# Known gaps register

Found by code review and by the tests in `test/`. Gaps with an automated test show as `todo` in `npm test`
(they run and report, but do not fail the suite) and turn into normal passing tests when fixed.
Jira numbers refer to the AIN board.

| ID | Gap | Impact | Evidence | Planned fix |
|---|---|---|---|---|
| KG-01 | ~~Slot locks are not aligned to the 5-minute grid~~ **FIXED** (commit 38e5e3d) — `slotLockIds` now floors to the grid | 14:02 and 14:00 for the same staff now correctly collide | test RC-07 (was todo, now passes) | Jira 28d |
| KG-02 | ~~`createBooking`/voice do not re-check opening hours, holidays, staff hours~~ **FIXED** (commit 38e5e3d) — `isSlotOffered` helper | Voice booking outside hours is now refused | test VB-07 (was todo, now passes) | Jira 28b/28c — dashboard stays permissive on purpose (staff override) |
| KG-03 | Bookings with no staff use lock namespace `none`; named-staff bookings use the staff id, so they never block each other | "Any staff" booking and a named-staff booking can share one time | test RC-13 (characterisation) | Public page always assigns a concrete staff (Jira 17g) — not fixed, awaits Plan 1's public booking page |
| KG-04 | ~~A misheard staff name resolves to `null` and the booking is created with nobody assigned~~ **FIXED** (commit 38e5e3d) — unmatched staff name is now a spoken error | Caller wanted Jessica, gets a clear "no staff member found" error instead of a silent unassigned booking | test VB-08 (was todo, now passes) | Jira 28a |
| KG-05 | Idempotent replay ignores status: cancel then rebook the identical slot inside one call returns the cancelled booking as if confirmed | Rare, same-call only | reviewed, no test yet | Jira 28g — not fixed, tagged Tomorrow |
| KG-06 | ~~`rescheduleBooking` does not check status or minimum notice~~ **FIXED** (commit 38e5e3d) — rejects non-confirmed bookings | Rescheduling a cancelled booking now errors instead of re-locking it | test RC-14 (was todo, now passes) | Jira 28e |
| KG-07 | ~~If the Gemini session fails to start the caller hears silence until the 15-minute cap~~ **FIXED** (commit 38e5e3d) — `endCallWithMessage` + callback queue | Caller gets a graceful apology + hangup; staff see a callback request and `outcome: 'failed: ai_unavailable'` | reviewed, no automated test (needs a live/mocked Gemini failure) | Jira 27c, 27d |
| KG-08 | ~~Phone numbers are not normalised with a country code~~ **FIXED** (commit pending) — `normalizePhone` defaults to NANP (+1) for a bare 10-digit number | A returning customer typing a local number on the web now matches the same customer a phone call created | test MT-05 (was todo, now passes) | Jira 18b |
| KG-09 | `upsertCustomer` is find-then-insert: simultaneous first-time upserts for one phone throw a duplicate-key error for the losers | Harmless today (booking still succeeds, error logged); would surface as a failed web booking | test MT-06 (todo) | Fixed 2026-10-01: atomic upsert, MT-06 now passes |
| KG-10 | ~~Transcript/outcome/duration only saved on Twilio's `stop` event~~ **FIXED** (commit 38e5e3d) — idempotent `finalizeCall()` runs on both `stop` and socket `close` | A server-initiated close (watchdog, transfer, Gemini ending) no longer loses the transcript/duration | reviewed, no automated test (needs a live/simulated WS close) | Jira 27e |
| KG-11 | ~~No cap or queue on concurrent calls~~ **FIXED** (commit 38e5e3d) — optional `MAX_CONCURRENT_CALLS` env guard | A call past the configured cap is told lines are busy instead of starting a Gemini session | reviewed, no automated test (needs live concurrency) | Jira 27f — quota itself (27m) still needs verifying against the live Gemini account |
| KG-12 | Silence watchdog never fires because every Twilio media frame (even silence) refreshes `lastMediaAt` | Dead lines stay open until the 15-minute cap | reviewed | Jira 27k |
| KG-13 | Reminder, billing and sync workers run inside the web process; PM2 cluster mode would run each N times (reminder sweep is find-then-send) | Duplicate reminder SMS if clustered | reviewed | Jira 27j |
| KG-14 | Slot-lock documents are never deleted for old bookings | Slow collection growth | reviewed | Jira 28h |
| KG-15 | Staff time off created after bookings exist is not checked against those bookings | Booked customers on a day the staff later takes off | reviewed | Jira 28i |
| KG-16 | `service_ids` on staff (which services a staff member does) is only a UI filter, not enforced when booking | Staff can be booked for services they do not offer | reviewed | Jira 17h |
| KG-17 | No temporary slot hold between checking availability and booking | Two people can both see a slot, one then gets "just taken" | reviewed (roadmap item 5n) | Jira 17w (friendly recovery); real hold later |
