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

## 3. Deploy dashboard (31e, 31f)

```
cd dashboard
npm ci && npm run build
pm2 restart booking-dashboard --update-env
```

Confirm `PUBLIC_DASHBOARD_URL` in the backend's `.env` matches the dashboard's real public
URL (it's used to build reschedule/cancel and team-invite links sent in messages — a wrong
value produces working-but-wrong links, not an error).

## 4. Email (SendGrid) — Jira 29k/29l/29m

Team invites and verification codes are silently skipped without this
(`docs/notifications/email.js` — `sendEmail` now returns `{sent, reason}` so the dashboard
can show *why*, but nothing fixes the missing key itself).

1. Create a SendGrid API key (Mail Send scope) and verify a sender address.
2. Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and confirm `PUBLIC_DASHBOARD_URL` in
   `/var/www/booking-call-center/.env`.
3. `pm2 restart booking-backend --update-env`
4. Send a real test invite from the dashboard's Team page. If it still doesn't arrive,
   check SPF/DKIM on the sending domain (Jira 29n) before assuming the key is bad.
5. If the dashboard isn't deployed yet or the invitee still doesn't get it: run
   `npm run make-invite-link -- <email>` on the server to print the link directly and
   send it by hand (Jira 29h).

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

## 8. Housekeeping

- `pm2 logs booking-backend --lines 0` then watch briefly for unexpected errors after
  restart, before considering the deploy done.
- Set up PM2 log rotation if not already (`pm2 install pm2-logrotate`) — logs grow
  unbounded otherwise (Jira 31k).
- **Do not switch PM2 to cluster mode** without reading `docs/CONCURRENCY.md` first — the
  concurrent-call counter and the reminder/billing/sync workers are single-process state.
