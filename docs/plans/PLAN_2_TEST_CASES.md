# PLAN 2 — TEST CASES (documents + runnable code)

**Status: DONE 2026-09-30** (documents and code pushed). Remaining Plan 2 items are blocked on Plan 1/Plan 4 features or need the server (see `docs/testing/TEST_CASES.md`, statuses `Planned`/`Manual`).

Goal: complete written test-case document AND code for cases like "customer books 2pm by phone while staff/customer books the same 2pm manually", and many more.
Facts (from code review): already safe for identical starts (deterministic slot-lock ids in one transaction; one 201, loser 409; voice logs `failed_bookings`); only one 2-way concurrency test exists (`test/booking.test.js`).
Known gaps the tests will expose: off-grid starts (10:02 vs 10:00) don't collide; voice/public paths don't re-check hours; misheard staff name silently books "no staff"; reschedule of cancelled booking makes phantom locks; replay of cancelled booking with same key.
Format: `docs/testing/TEST_CASES.md` — ID, area, scenario, preconditions, steps, expected, automated file, status. `docs/testing/USE_CASES.md` — use-case catalog (public booking, directory, voice, dashboard, multi-tenant, failures, notifications, billing). Traceability matrix (use case -> test -> Jira).
Code: DB-gated with the existing `{skip: !process.env.MONGODB_URI}` pattern (needs replica set; `npm run local-db`).

| # | Step | NOW | TOMORROW |
|---|---|---|---|
| T1 | Use-case catalog + test-case format + traceability | yes | — |
| T2 | `test/raceConditions.test.js`: call-vs-manual same 2pm slot; 20-way; different staff both win; overlap 14:00-15:00 vs 14:30-15:30; adjacent both win; off-grid 14:02 vs 14:00; cancel-then-rebook; reschedule into taken slot; same idempotency key; two tenants same time | yes (tests that hit known gaps are written first, then fixed under Plan 4) | — |
| T3 | `test/voiceCreateBooking.test.js`: off-hours rejected, failed booking logged, misheard staff error | yes (depends on Plan 4 fixes) | — |
| T4 | `test/publicBooking.test.js` + `test/directory.test.js`: slug uniqueness, staff-service filter, any-staff, off-hours rejected, suspended 404, honeypot, rate limit, 20 parallel POSTs -> 1 winner; search returns only listed+active, ABC vs XYZ disambiguation, unlisted hidden, category/city filter | yes (depends on Plan 1 C2/C3) | — |
| T5 | `test/emailInvite.test.js`, `test/callFinalize.test.js` (fake ws) | yes (depends on Plan 4) | — |
| T6 | `scripts/loadTest.js` `--public` mode + many-WebSocket smoke script | yes | run against server = teammate |
| T7 | Manual UAT checklist (browser + real phone) | doc now | teammate/boss run it |
| T8 | Full `npm test` run + result report in TEST_CASES.md | yes | — |
| T9 | CI: GitHub Actions running `npm test` with mongodb-memory-server replica set | later (To Do) | — |
| T10 | Real multi-call test (N phones/Twilio) and post-deploy smoke | — | teammate |
Jira parents 20-23:
- **20. Test Use Cases & Docs**: 20a use-case catalog; 20b test-case format+IDs; 20c traceability matrix; 20d manual UAT checklist; 20e test run report.
- **21. Race & Concurrency Tests**: 21a call vs manual same 2pm; 21b 20-way same slot; 21c different staff same time; 21d overlapping ranges; 21e adjacent bookings; 21f off-grid vs grid; 21g cancel then rebook; 21h reschedule into taken slot; 21i same idempotency key; 21j two tenants same time; 21k voice off-hours rejected; 21l voice failed booking logged; 21m call finalize on close; 21n many-WebSocket smoke.
- **22. Public/Directory/Multi-tenant Tests**: 22a slug uniqueness; 22b staff-service filter; 22c any-staff; 22d offered-slot rejects off-hours; 22e honeypot; 22f rate limit; 22g suspended 404; 22h parallel POST one winner; 22i directory shows only listed+active; 22j ABC vs XYZ disambiguation; 22k category+city filter; 22l unlisted direct link still works; 22m same phone salon vs dentist separate; 22n invite result+link.
- **23. Load, CI & Live Tests**: 23a loadTest `--public`; 23b GitHub Actions CI [T]; 23c real multi-call test [T][TM]; 23d post-deploy smoke [T][TM]; 23e staging DB for tests [T].

## What was done
Files: `docs/testing/USE_CASES.md`, `TEST_CASES.md`, `KNOWN_GAPS.md`; tests `test/raceConditions.test.js`, `test/voiceCreateBooking.test.js`, `test/multiTenant.test.js`, fixture `test/support/tenantFixture.js`; script `scripts/wsSmoke.js`.
Result: 96 tests, 90 pass, 0 fail, 6 documented gaps (todo). Steps T4/T5/T9/T10 and the public/directory/email/finalize tests wait for Plan 1 and Plan 4 (listed as Planned in TEST_CASES.md).
