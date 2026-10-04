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

## 8. Housekeeping

- `pm2 logs booking-backend --lines 0` then watch briefly for unexpected errors after
  restart, before considering the deploy done.
- Set up PM2 log rotation if not already (`pm2 install pm2-logrotate`) — logs grow
  unbounded otherwise (Jira 31k).
- **Do not switch PM2 to cluster mode** without reading `docs/CONCURRENCY.md` first — the
  concurrent-call counter and the reminder/billing/sync workers are single-process state.
