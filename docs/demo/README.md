# Walkthrough video

`walkthrough-2026-10-02.webm` (about 5 minutes 30 seconds, 1280x720, 17 MB, no sound; captions explain each step).
It was recorded by a browser driven with Playwright against a demo copy of the system with test data, so nothing in it is a real customer.
Open it in Chrome, Edge, Firefox or VLC (WebM). Windows Media Player may need a codec.

## What it shows, in order

| Part | What you see |
|---|---|
| Intro slide | The five things built |
| 1. Directory | A customer searches without a link; two "Glow Studio"s told apart by city and address; filter by type; "nothing found" with Clear filters and the request form |
| 2. Booking page | Business name and address on every screen; the branch question; only that branch's stylists; day and time in the business time zone; inline validation on the details; confirmation with reference, Add to calendar and directions |
| 3. Customer portal | Sign-in with a code (and the honest "no SMS here" message), My appointments, reschedule, language, delete-my-data confirmation |
| 4. Business dashboard | Separate owner login; Bookings with "Booked via" and delivery status; calendar marks; duplicate customers and the merge dialog |
| 5. Team and settings | Time off over a booked day warns who is affected; Settings in tabs, "?" tooltips, plain names, glossary; Needs attention |
| Phone | The same dashboard in a phone-shaped frame: menu button, slide-in menu, forms that fit |
| 6. Platform console | Hide a listing from the public directory and see it disappear from search; leads |
| 7. New business | Signup validation, first-login tour, setup progress card and sidebar counter |
| Closing slides | The reliability fixes you cannot see on screen, and the automatic checks (212 tests, CI, load test, 38 browser checks, 12 screenshot comparisons) |

Not shown because they have no screen: the recording-link change, slot-lock clean-up, reminder claiming, silence detection and restart draining. They are covered by automated tests (`docs/testing/TEST_CASES.md`, groups RP, BF, VR).
Sign-in codes cannot be delivered on this test server (no SMS or email provider), so the portal scene continues with a test session.

## Recording it again

```bash
# backend and dashboard running against the same MongoDB (see docs/testing/TEST_CASES.md), then:
npm run demo:record                    # writes docs/demo/walkthrough-<date>.webm
DEMO_ONLY="booking,portal" DEMO_VIDEO_NAME=try.webm npm run demo:record   # just some scenes
```
The script (`scripts/demo/record.mjs`) creates fixed demo businesses (`scripts/demo/seedDemo.mjs`) and removes them afterwards. Use the production build of the dashboard (`npm run build && npm start` inside `dashboard/`), not `next dev`, so pages do not stall while compiling.

Related checks that use the same demo data: `npm run gui:check` (accessibility and phone layout), `npm run screenshots` (picture comparison).
