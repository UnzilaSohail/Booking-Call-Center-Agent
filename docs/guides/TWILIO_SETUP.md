# Guide: Twilio. Recording error and text messages · Jira AIN-391, AIN-392 (31h, 31i), KG-19

For the teammate with access to the Twilio Console (https://console.twilio.com). Part A fixes the recording error, Part B makes text messages reach real phones. Part B is also what stops sign-in codes, reminders and confirmations from silently going nowhere (AIN-442 is probably the same problem).

## Part A: "failed to start recording … not eligible for recording" (AIN-391)

**What it is:** when a call arrives, the backend asks Twilio to record it. Twilio sometimes answers "not eligible". The call itself works; only the recording is missing, so the Calls page has no audio to play.

**Step 1: get the exact error.** On the server run `pm2 logs booking-backend --lines 300 | grep "failed to start recording"`. Copy the whole line (it has the call id and Twilio's message). Also look in the Twilio Console > **Monitor > Logs > Errors** for the same time and note the **error code** (a number). Open `https://www.twilio.com/docs/api/errors/<code>` for Twilio's own explanation.

**Step 2: the usual causes, in the order to check them:**
1. **The account is still a trial account.** Console top bar shows "Trial". Upgrade it (Console > Billing > Upgrade). Several restrictions disappear after upgrading.
2. **Recording is switched off or restricted for the account/region.** Console > **Voice > Settings > General** and check recording-related options; also check **Voice > Settings > Geo permissions** for the country of the caller.
3. **Timing:** the code starts the recording the moment the call webhook arrives (`src/webhooks/twilio.js`), when the call may not be fully "in progress" yet. If the code in the log says the call is in the wrong state (for example "call is not in-progress"), tell the developer: the fix is to start the recording a moment later, when the voice stream begins. Do not guess; send the exact error line.
4. **Business setting:** each business can turn recording off (Settings > Business, the call-recording checkbox). If it is off, no recording is expected.

**Step 3: confirm the fix.** Place a test call, then run `npm run call:check`. The line **"A recording exists"** must say PASS (a recording can take about a minute after hang-up). Then open Calls in the dashboard and press play on the call.

## Part B: text messages that really arrive (AIN-392)

There are three separate things that block texts. Check them in this order.

### B1. Trial limits
A trial account can only text phone numbers you have **verified** in the Console (Phone Numbers > Manage > Verified Caller IDs), and every text starts with "Sent from your Twilio trial account". **Fix: upgrade the account.**

### B2. Geo permissions (error 21408)
Texting to a country is off by default. Console > **Messaging > Settings > Geo permissions** > tick **United States** (and every country our clients or test phones are in, for example Pakistan while testing). Changes take effect immediately.

### B3. US registration, "A2P 10DLC" (errors 30034 and 30007)
Since 2023 US carriers block business texts from **unregistered** US numbers. A message can show "delivered" in Twilio and still never reach the phone (silent filtering). This is the main reason real customers do not get codes.
1. Console > **Messaging > Regulatory Compliance > A2P 10DLC** (or "Trust Hub").
2. Create a **Customer Profile** and a **Brand**: the legal business name, address, website and **EIN** (US tax number). Companies without an EIN can register as a "sole proprietor", with much lower sending limits. **This is why the boss's answer on AIN-374 (do we have a US entity and EIN?) matters for texting too.**
3. Create a **Campaign** (use case: "Account notifications" or "Customer care"; add sample messages such as "Booking confirmed: Haircut on Friday 3pm. Reply STOP to opt out"). Approval takes from a few days up to about 3 weeks.
4. Create a **Messaging Service**, add the business phone number(s) to it, and link the approved campaign.
5. The Console prices: a one-time brand and campaign fee plus a small monthly fee. Check the current prices on the registration screens before approving.

### B4. Outside the US (for example Pakistan)
Unregistered US senders are often filtered by foreign carriers. Options: register an **Alphanumeric Sender ID** for that country (Console > Messaging > Senders > Alphanumeric Sender ID; availability and rules differ by country) or use a local number there. Only needed when real customers or staff abroad must receive texts.

### How to test
```
npm run sms:check -- +<a real phone number> [+<our Twilio number>]
```
It sends one real text and follows it for 30 seconds, then prints PASS or FAIL **with the reason in plain words** (it knows the error codes above). Then look at the phone: if Twilio says delivered but nothing arrives, it is silent filtering (B3 or B4).

After a pass, try the real thing: on a business's "My appointments" page (`/my/<business>`) request an SMS sign-in code to a verified number and see it arrive.

## When done
Tell the board: **AIN-391** (recording) and **AIN-392** (text registration) > Done, with a note of the `sms:check` result. If registration is still waiting for approval, leave AIN-392 In Progress and note the date submitted.
