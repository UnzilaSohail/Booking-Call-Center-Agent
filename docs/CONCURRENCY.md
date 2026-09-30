# Concurrency model (Jira 27a, 27b, 27h, 27i)

One Node process. Each call is its own WebSocket (`src/voice/twilioBridge.js`) bridged to
its own Gemini Live session (`src/voice/geminiSession.js`). All per-call state (transcript,
`streamSid`, watchdog timers) lives in that connection's closure — no shared mutable state
between calls, so one call can never leak into another.

## What actually caps concurrency

No cap of our own by default — the real limits are external:

- **Gemini Live**: one API key has a concurrent-session quota (check Google AI Studio for
  the current number). This is almost always the first limit hit.
- **Twilio**: account-level concurrent call limits (higher on paid accounts, low on trial).
- **Mongo**: the driver's connection pool (default 100) — each call does DB reads/writes
  per tool call, well within pool size at any realistic call volume.

`MAX_CONCURRENT_CALLS` (env var, optional) adds our own in-process guard on top: once set,
a call past that count is told "all our lines are busy" via `endCallWithMessage` and never
starts a Gemini session (saving quota) — see `src/voice/twilioBridge.js`. Leave it unset
until the Gemini Live quota for the account is known (Jira 27m, tomorrow item); setting it
too low rejects calls the account could actually have handled.

## Known limitations (won't silently break, but worth knowing)

- **Silence watchdog is best-effort, not exact.** Every Twilio media frame — including
  comfort noise on an otherwise silent line — refreshes the watchdog's timer. A call with
  literally zero audio (rare; most "dead" lines still send frames) won't trip the
  30-second silence timeout. The 15-minute hard cap (`MAX_CALL_DURATION_MS`) is the actual
  backstop for a call that never legitimately ends.
- **PM2 cluster mode would break this.** `activeCalls` (the `MAX_CONCURRENT_CALLS` counter)
  and the reminder/billing/sync workers are all in-process state — PM2 fork mode (one
  process) is required. Cluster mode (`-i` / `instances`) would run N independent counters
  and N copies of every cron worker, over-admitting calls and sending duplicate reminder
  SMS (see `docs/testing/KNOWN_GAPS.md` KG-13). Do not switch to cluster mode without first
  moving `activeCalls` to a shared store (e.g. Redis) and making the workers claim work
  atomically.

## Failure handling

- **Gemini session fails to start** (bad key, quota exceeded, model 404): the call is
  ended gracefully with an apology (`endCallWithMessage`), logged as
  `call_logs.outcome = 'failed: ai_unavailable'`, and a callback request is queued — see
  `docs/testing/KNOWN_GAPS.md` KG-07.
- **Server-initiated close** (watchdog, Gemini ending the session, a transfer): the
  transcript/outcome/duration write happens through `finalizeCall()`, called from both
  Twilio's `stop` frame and the socket's own `close` event, guarded so it only ever runs
  once per call — see KG-10.
