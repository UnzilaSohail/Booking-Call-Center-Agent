# Deploy runbook — for the teammate with server access (Jira 31)

Everything here needs SSH to the production server. Nothing in this file can be done
without it — see `docs/plans/README.md` for what was already fixed locally and pushed.

## 1. Drift check (31b)

The server copy of some files may have been hand-patched directly (this has happened
before — `src/voice/geminiSession.js` was hand-patched with the same fix as commit
`9d8449f`). Before pulling:

```
cd /var/www/booking-call-center
git status
```

If any tracked file shows as modified, decide per-file: if the local edit matches what's
already in `main` (check `git diff`), just `git checkout <file>`; if it's a genuine
server-only fix nobody committed, copy it out before you pull so it isn't lost.

## 2. Deploy backend (31c, 31d)

```
git pull
npm run migrate
pm2 restart booking-backend --update-env
```

What `npm run migrate` now also does (safe to repeat): adds a TTL index on `booking_slot_locks.expires_at`,
backfills that field on existing locks (old locks and orphans are cleaned up by MongoDB within a minute),
and gives every business a booking link (`slug`) and its unique index.

**Restarts and live calls (Jira 27l).** On SIGTERM/SIGINT the backend now stops taking new calls
(callers hear "we are restarting, call back in a minute") and waits for calls in progress to finish,
up to `DRAIN_TIMEOUT_MS` (default 10 minutes), before exiting. PM2 must be told to wait that long,
otherwise it kills the process after 1.6 seconds and the drain never gets a chance:

```
pm2 restart booking-backend --update-env --kill-timeout 660000
# or once, in the process config:  kill_timeout: 660000
```
Optional tuning (`.env`): `SILENCE_TIMEOUT_MS` (default 30000, how long a line may be silent before we hang up),
`DRAIN_TIMEOUT_MS`.

## 3. Deploy dashboard (31e, 31f)

```
cd dashboard
npm ci && npm run build
pm2 restart booking-dashboard --update-env
```

Set `NEXT_PUBLIC_SITE_URL` in `dashboard/.env.local` to the real public address (it builds the links in `sitemap.xml` and `robots.txt`; the default is localhost).
Confirm `PUBLIC_DASHBOARD_URL` in the backend's `.env` matches the dashboard's real public
URL (it's used to build reschedule/cancel and team-invite links sent in messages — a wrong
value produces working-but-wrong links, not an error).

## 4. Email (Gmail SMTP or SendGrid) — Jira 29k/29l/29m

To make emails reach the inbox instead of spam (SPF, DKIM, DMARC), follow `docs/guides/EMAIL_SPF_DKIM.md` (Jira 29n).

Team invites and verification codes are silently skipped without one of these configured
(`src/notifications/email.js` — `sendEmail` now returns `{sent, reason}` so the dashboard
can show *why*, but nothing fixes a missing provider itself). Gmail is tried first if set,
falling back to SendGrid.

**Gmail SMTP (faster to set up — self-service, no account/verification wait):**
1. On the sending Gmail account: Google Account > Security > 2-Step Verification (must be
   on) > App Passwords > generate one.
2. Set `GMAIL_USER` (the Gmail address) and `GMAIL_APP_PASSWORD` (the generated password,
   not the account's login password) in `/var/www/booking-call-center/.env`.
3. `pm2 restart booking-backend --update-env`, then send a real test invite.
4. Gmail has a ~500/day sending limit on a regular account — fine for invites/verification
   codes at this scale; move to SendGrid below if that's ever actually hit.

**SendGrid (more scalable, more setup):**
1. Create a SendGrid API key (Mail Send scope) and verify a sender address.
2. Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` in `.env` (leave `GMAIL_USER` unset so
   this is actually used, since Gmail is tried first).
3. `pm2 restart booking-backend --update-env`, then send a real test invite. If it still
   doesn't arrive, check SPF/DKIM on the sending domain (Jira 29n) before assuming the key
   is bad.

**Either way**, also confirm `PUBLIC_DASHBOARD_URL` in `.env` matches the dashboard's real
public URL (it's used to build reschedule/cancel and team-invite links sent in messages —
a wrong value produces working-but-wrong links, not an error).

If the dashboard isn't deployed yet, or an invitee still doesn't get the email: run
`npm run make-invite-link -- <email>` on the server to print the link directly and send it
by hand (Jira 29h) — works regardless of email provider status.

## 5. Twilio (31h, 31i)

Step-by-step guide with the error codes: `docs/guides/TWILIO_SETUP.md`. Test a text with `npm run sms:check -- +<phone>`.

- **"not eligible for recording"** in the logs: check the Twilio console for recording
  permissions on the account/number — trial accounts often can't record.
- **SMS limits**: US numbers need A2P 10DLC registration for SMS at volume; trial accounts
  can only text pre-verified numbers. Check the Twilio console's Messaging section.

## 6. Gemini Live quota (31l, 27m)

Check the Live API's concurrent-session limit for the configured key in Google AI Studio.
Only once that number is known, set `MAX_CONCURRENT_CALLS` in `.env` (see
`docs/CONCURRENCY.md`) — setting it before you know the real quota either wastes capacity
(too low) or does nothing (too high).

## 7. Smoke test (31g, 31j)

Full test-call checklist: `docs/guides/POST_DEPLOY_CALL_TEST.md`. After a call, `npm run call:check` says whether everything was saved.

- Health check: `curl https://<domain>/health` (or whatever the app's health route is).
- WebSocket upgrade: confirm `/voice/stream` accepts a connection (a real inbound call is
  the simplest check — see below).
- Public dashboard page loads over HTTPS.
- Place one real call to the business's Twilio number. Confirm: the AI answers, a booking
  can be made, and afterward `call_logs.transcript` for that call is non-empty (this was
  the actual production incident on 2026-09-29 this repo's Plan 2 test suite now guards
  against — see `docs/testing/KNOWN_GAPS.md` KG-07).

## 7b. Demo data (for showing the product before a real client exists)

- Easiest: log in as a platform admin, open the platform Overview, scroll to **Demo data**, press **Add demo data**
  (tick "Show demo businesses in the public directory" only if people should find them on /find). The login
  password is shown once on screen. **Remove demo data** deletes all of it in one click.
- Or from the server: `npm run demo:seed -- --listed` (prints the password) and `npm run demo:remove`.
- Everything is flagged `demo: true`, uses made-up `.example.test` emails and 555 phone numbers, and is inserted
  directly, so no real SMS or email is sent. Real companies are never touched by "remove".
- Remove it before the first real client signs up if you do not want fake businesses in the public directory.

## 7c. pm2 process file, log rotation and the call limit (Jira 31k, 31l)

One file now describes both processes: `ecosystem.config.cjs` (already sets the 11-minute `kill_timeout`, fork mode, one instance).
If the server was started by hand with `pm2 start ...`, switch once:
```
pm2 delete booking-backend booking-dashboard
pm2 start ecosystem.config.cjs
pm2 save          # and `pm2 startup` once, so both come back after a server reboot
```
After that, a deploy is `pm2 reload ecosystem.config.cjs --update-env`.

Log rotation (logs grow without limit otherwise), once:
```
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```
`MAX_CONCURRENT_CALLS` goes in the backend `.env` (not the process file). Until the Gemini Live quota is known (AIN-395), start with `MAX_CONCURRENT_CALLS=5`; a call over the limit hears "all lines are busy" and costs nothing. Raise it when Google AI Studio shows a higher concurrent-session quota and a many-phones test (AIN-303) passes.

Check the deployment any time with the smoke test (from any computer):
```
npm run smoke -- https://bookingagent.sparkmind.online
```

## 7d. Content-Security-Policy and other new switches (Jira 36)

- The dashboard now sends a Content-Security-Policy (`dashboard/proxy.js`). If a page ever looks broken after a deploy, set `CSP_MODE=report` in the dashboard's environment and restart it (`pm2 reload ecosystem.config.cjs --update-env`): the browser then only logs problems in its console and blocks nothing. `CSP_MODE=off` removes it. Default is enforcing.
- Pages are now built per request (needed for the one-time script code); nothing to do, but you will see `ƒ` next to every page in the `npm run build` output.
- `npm run migrate` adds one new index (`rate_limits`). Run it as usual when deploying.
- Optional: `DIRECTORY_CACHE_MS` (backend `.env`, default 30000) is how long the public directory is remembered; `0` turns it off.
- Locked accounts: after 8 wrong passwords a login is locked for 15 minutes and the owner is emailed. The platform console, company page, shows **Locked** with an **Unlock login** button.
- Passwords set from now on need at least 10 characters and must not be a common password.

## 7e. Reminders you can answer, waiting list, review texts, monthly report (Jira 38 to 41)

- **Reminders** now go out **24 hours and 2 hours** before a visit (the 1-hour one is gone). The text says "Reply C to cancel".
  For "C" to work, the business's Twilio number needs its **messaging webhook** pointed at `https://<domain>/webhooks/twilio/sms-inbound`
  (HTTP POST). Numbers bought from now on get this automatically. **Numbers bought earlier need it set once by hand:**
  Twilio Console > Phone Numbers > the number > Messaging > "A message comes in" > Webhook. (If you use a Messaging Service for
  A2P registration, set the same URL on the service's "Integration" settings.) Test: text "C" from a customer phone that has an
  appointment; it must answer "...is cancelled." STOP and START already use this URL.
- **Waiting list:** no setup. `npm run migrate` adds two indexes (`waitlist`). Customers join from a full day on the booking page; staff see it under Bookings.
- **Google review text:** the owner pastes the review link in Settings > Business. Nothing is sent until they do.
- **Monthly report email:** sent on the 1st to 3rd of each month from 9am (business time) to the business's contact email, using the same email provider
  as invites. Owners can turn it off in Settings and press "Email me a sample report now" to see it. It needs the email provider working (AIN-367, AIN-370).
- All of these texts respect "STOP", never go out between 9pm and 8am (business time), and are tracked with the other delivery data.
- After deploying run `npm run migrate`, then `pm2 reload ecosystem.config.cjs --update-env`.

## 7f. Bot check on the public forms: Cloudflare Turnstile (Jira AIN-433)

Stops bots from filling the booking, waiting-list, signup, sign-in-code and "tell us what you need" forms. The widget is already created in
Cloudflare (hostnames `bookingagent.sparkmind.online` and `localhost`). It needs two keys, and **both** must be set (one alone breaks the forms):
1. **Backend** `.env`: `TURNSTILE_SECRET_KEY=<the secret key>` (private: never put it in chat, a commit or a screenshot; Aiza has it in the Cloudflare dashboard, Turnstile > the widget).
2. **Dashboard** `dashboard/.env.local`: `NEXT_PUBLIC_TURNSTILE_SITE_KEY=<the site key>` (public). This one is read when the dashboard is **built**, so run `cd dashboard && npm run build` after adding it.
3. `pm2 reload ecosystem.config.cjs --update-env`.
4. Check: open the booking page in a private window: a small "Verify you are human" box appears before "Confirm booking". Make a booking: it must work. If the box never appears or bookings fail, set the backend to forget the key (delete `TURNSTILE_SECRET_KEY`, reload): the forms work again without the check, then tell the developer.
- Local development and tests need no keys: with none set, the check is off. To test it locally use Cloudflare's own test keys: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA` (always pass).
- If Cloudflare is unreachable the visitor is let through (and it is logged), so a Cloudflare outage cannot stop customers booking.

## 8. Housekeeping

- `pm2 logs booking-backend --lines 0` then watch briefly for unexpected errors after
  restart, before considering the deploy done.
- Set up PM2 log rotation if not already (`pm2 install pm2-logrotate`) — logs grow
  unbounded otherwise (Jira 31k).
- **Do not switch PM2 to cluster mode** without reading `docs/CONCURRENCY.md` first — the
  concurrent-call counter and the reminder/billing/sync workers are single-process state.
