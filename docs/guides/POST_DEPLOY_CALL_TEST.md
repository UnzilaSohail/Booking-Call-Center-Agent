# Guide: test the live system after a deploy · Jira AIN-393 (31j), AIN-304 (23d)

For the teammate (or Aiza, who can do the browser parts). About 30 minutes. You need a real phone and the live business phone number.

## 0. Before calling (2 minutes)
1. On any computer: `npm run smoke -- https://bookingagent.sparkmind.online`. It must say **smoke test passed**. If not, stop and fix that first.
2. Log in to the dashboard as the business owner and open **Settings > Booking & hours**: opening hours must include the time of your call (otherwise the AI correctly says the business is closed), and at least one service must exist.

## 1. The calls (use your own phone). Write the result next to each
| # | What to do | What you must see |
|---|---|---|
| 1 | Call the business number. When the AI answers, book a service for tomorrow | The AI greets you by the business name, offers real free times, confirms the booking, and you get a confirmation text (if texting works, AIN-392). The booking appears in Bookings and Calendar, "Booked via: Phone" |
| 2 | Call again and ask for a time that is already taken | The AI offers other times. A failed attempt appears under **Needs attention** |
| 3 | Call and ask a question the business answered under "What your AI should know" (for example opening hours) | The AI answers correctly from that text |
| 4 | Call and say you want to speak to a person | The call is transferred, or a call-back request appears under Needs attention |
| 5 | Call, then hang up in the middle of the conversation | Nothing breaks; the call still shows up in Calls |

## 2. Right after each call: did we save everything? (the AIN-393 check)
On the server (or any computer with the `.env`):
```
npm run call:check
```
It reads the latest call and prints PASS or FAIL for: the call finished, its length, the transcript (both the AI and the caller speaking), the summary and intent, and whether a recording exists. **All must be PASS** except a missing recording (that is AIN-391, see `TWILIO_SETUP.md`) and "booking linked" (only expected if you booked on that call).
- A FAIL on "transcript was saved" is the serious one: it is the 29 September problem (the call worked but nothing was written down). Send the backend log lines for that call (`pm2 logs booking-backend --lines 300`).

## 3. Look at it in the dashboard (2 minutes per call)
Dashboard > **Calls** > click the call: you must see a written summary and the conversation as chat bubbles, in the right order. Booking calls show the booking next to the call. Also check Overview: "calls answered" has gone up.

## 4. Things to try once (AIN-304, manual UAT)
- **Two calls at the same time** from two phones: both answered, two separate transcripts. (Already proven with 8 real concurrent calls on 5 October; just re-check after any change to the call limit, `MAX_CONCURRENT_CALLS`.)
- **Restart during a call** (`pm2 reload ...`): the caller hears the restart message or the call ends cleanly, and the dashboard stays consistent (UAT-11).
- **Booking page on a real phone:** open `/find` and book (UAT-13): no sideways scrolling, buttons easy to tap, confirmation shows. Open the "Change or cancel" link from the confirmation text or screen. It must open **our live site**, not localhost (this is AIN-439).
- **Team invite email** to a Gmail address arrives (UAT-06; see `EMAIL_SPF_DKIM.md` if it goes to spam).

## 5. Report back
Put the results in the Jira ticket: **AIN-393** (transcript saved: PASS/FAIL, paste the `call:check` output) and **AIN-304** (which of section 4 you tried). If everything passes, mark both Done. If something fails, add the exact output of `npm run call:check` and the matching `pm2 logs` lines to the ticket and tell the developer.

The full list of manual checks is in `docs/testing/TEST_CASES.md`, section "UAT".
