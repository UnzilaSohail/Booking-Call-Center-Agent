// Bridges a Twilio Media Streams WebSocket to a Gemini Live session (plan.md §3/§5/§8
// phase 4). Twilio pushes 8kHz mu-law audio frames as JSON text messages over this
// socket per https://www.twilio.com/docs/voice/media-streams/websocket-messages —
// this handler speaks that protocol directly (no Twilio server-side SDK needed for it).
import { WebSocketServer } from 'ws';
import { twilioPayloadToGeminiPCM, geminiPCMToTwilioPayload, mulawFrameLevel, SPEECH_LEVEL } from './audio.js';
import { startGeminiSession, summarizeCall } from './geminiSession.js';
import { transferCallToHuman, endCallWithMessage } from '../webhooks/twilio.js';
import { getDb, withTenant, newId, serialize } from '../db.js';

// KG-11/27f: single-process guard against overloading one Gemini Live API key/Mongo
// pool. Only meaningful in PM2 fork mode (27i) — a cluster of N processes would each
// allow this many, since the counter is in-memory per process, not shared.
const MAX_CONCURRENT_CALLS = process.env.MAX_CONCURRENT_CALLS ? Number(process.env.MAX_CONCURRENT_CALLS) : null;
let activeCalls = 0;

// 27l: on SIGTERM/restart, stop taking new calls and let the ones in progress finish (up to a
// limit) instead of cutting every caller off mid-sentence. server.js calls beginDrain().
// pm2 must be told to wait too (kill_timeout), see docs/TEAMMATE_RUNBOOK.md.
const DRAIN_TIMEOUT_MS = Number(process.env.DRAIN_TIMEOUT_MS) || 10 * 60_000;
let draining = false;
export const getActiveCalls = () => activeCalls;
export function resetDrain() { draining = false; }
// Resolves true once no call is active, or false when timeoutMs runs out first.
export function beginDrain(timeoutMs = DRAIN_TIMEOUT_MS) {
  draining = true;
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (activeCalls === 0) { clearInterval(timer); resolve(true); return; }
      if (Date.now() - startedAt >= timeoutMs) { clearInterval(timer); resolve(false); }
    };
    const timer = setInterval(check, 250);
    check();
  });
}

// deps lets tests swap the Gemini session and summary for fakes.
export function attachTwilioMediaStreamServer(httpServer, path = '/voice/stream', deps = {}) {
  const startSession = deps.startGeminiSession ?? startGeminiSession;
  const summarize = deps.summarizeCall ?? summarizeCall;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== path) return; // not ours — leave the socket for any other upgrade handler
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    let streamSid = null;
    let callSid = null;
    let fromNumber = null;
    let business = null;
    let gemini = null;
    let isTest = false;
    let counted = false; // whether this call incremented activeCalls (only once it actually started)
    const transcript = [];

    // plan.md §6 "Dead air / silence handling": Gemini Live's own VAD handles normal
    // turn-taking, but a genuinely dead line (no media frames at all — not even comfort
    // noise) needs a call-level watchdog so we don't hold the line open indefinitely.
    // 27k: last time anyone actually spoke (caller audio above SPEECH_LEVEL, or the agent talking).
    // It used to be refreshed by every Twilio frame, which arrive every 20 ms even on a dead
    // line, so the silence timeout could never fire.
    let lastActivityAt = Date.now();
    const SILENCE_TIMEOUT_MS = Number(process.env.SILENCE_TIMEOUT_MS) || 30_000;
    const MAX_CALL_DURATION_MS = 15 * 60_000;
    const startedAt = Date.now();
    const watchdog = setInterval(() => {
      const now = Date.now();
      if (now - lastActivityAt > SILENCE_TIMEOUT_MS || now - startedAt > MAX_CALL_DURATION_MS) {
        console.warn(`ending call ${callSid} — ${now - lastActivityAt > SILENCE_TIMEOUT_MS ? 'silence timeout' : 'max duration reached'}`);
        ws.close();
      }
    }, Number(process.env.WATCHDOG_INTERVAL_MS) || 5_000);
    ws.on('close', () => clearInterval(watchdog));

    // KG-10/27e: a server-initiated close (watchdog above, Gemini ending the session,
    // a transfer redirect) never sends Twilio's own 'stop' frame back to us, so the
    // transcript/outcome/duration write used to only happen on the 'stop' case and got
    // silently skipped for every one of those paths. finalizeCall is now the one place
    // that write happens, called from both 'stop' and the socket's 'close' event, and
    // guarded so a call already finalized is never double-counted or double-written.
    let finalized = false;
    async function finalizeCall() {
      if (finalized) return;
      finalized = true;
      if (counted) { activeCalls--; counted = false; }
      gemini?.close();
      if (!business) return;
      const transcriptText = transcript.join('\n');
      // duration_seconds feeds voice-minute usage billing (ROADMAP.md §11) — reuses
      // startedAt, already tracked in this closure for the silence/max-duration
      // watchdog above, so this is the one place a call's real wall-clock length is known.
      const endedAt = new Date();
      const duration_seconds = Math.round((endedAt - startedAt) / 1000);
      await withTenant(business.id, async (c) => {
        const current = await c('call_logs').findOne({ call_sid: callSid });
        const outcome = current?.outcome && current.outcome !== 'in_progress' ? current.outcome : 'completed';
        await c('call_logs').updateOne({ call_sid: callSid }, { $set: { transcript: transcriptText, outcome, ended_at: endedAt, duration_seconds } });
      });
      // AI call summary + caller intent (ROADMAP.md §7) — after the row above so a
      // slow/failed Gemini call never delays the outcome/duration write callers rely on.
      const { summary, intent } = await summarize(transcriptText);
      if (summary || intent) {
        await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { summary, intent } }));
      }
    }

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      try {
        switch (msg.event) {
          case 'start': {
            streamSid = msg.start.streamSid;
            callSid = msg.start.callSid;
            fromNumber = msg.start.customParameters?.from ?? null;
            const businessId = msg.start.customParameters?.businessId;
            // Set by the onboarding test-call webhook (src/webhooks/twilio.js
            // /voice/test-call) — real inbound calls never carry this parameter.
            isTest = msg.start.customParameters?.isTest === 'true';

            const db = await getDb();
            const foundBusiness = await db.collection('businesses').findOne({ _id: businessId });
            business = foundBusiness ? serialize(foundBusiness) : null;
            if (!business) {
              console.error(`media stream started with unknown businessId ${businessId}`);
              ws.close();
              return;
            }

            lastActivityAt = Date.now();
            if (draining || (MAX_CONCURRENT_CALLS && activeCalls >= MAX_CONCURRENT_CALLS)) {
              console.warn(`call ${callSid} rejected — ${draining ? 'server is draining for a restart' : `at MAX_CONCURRENT_CALLS (${MAX_CONCURRENT_CALLS})`}`);
              await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: draining ? 'failed: restarting' : 'failed: lines_busy' } }));
              await endCallWithMessage(callSid, draining
                ? 'Sorry, we are restarting for a moment. Please call back in a minute.'
                : 'Sorry, all our lines are busy right now. Please try again in a few minutes.');
              await finalizeCall();
              ws.close();
              return;
            }

            // KG-07/27c,27d: a Gemini session that fails to start (bad key, quota,
            // model 404) must not leave the caller listening to silence until the
            // 15-minute cap — end the call gracefully and queue a callback instead.
            try {
              gemini = await startSession({
                business,
                callSid,
                isTest,
                onAudio: (base64Pcm24k, opts) => {
                  if (ws.readyState !== ws.OPEN) return;
                  if (opts?.interrupted) {
                    // Caller barged in — drop whatever Twilio has queued for playback so
                    // the agent doesn't keep talking over them (plan.md §3 "no custom
                    // barge-in code needed" refers to detection; clearing the outbound
                    // buffer on our side is still the bridge's job).
                    ws.send(JSON.stringify({ event: 'clear', streamSid }));
                    return;
                  }
                  if (!base64Pcm24k) return;
                  lastActivityAt = Date.now(); // the agent is talking, so the line is alive
                  ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: geminiPCMToTwilioPayload(base64Pcm24k) } }));
                },
                onTranscript: (speaker, text) => { lastActivityAt = Date.now(); transcript.push(`${speaker}: ${text}`); },
                onTransferToHuman: async (reason, transferPhoneNumber, category) => {
                  // transferCallToHuman redirects the *live* Twilio call via REST — that
                  // replaces the TwiML currently running (this Media Stream), so Twilio
                  // itself tears the stream down (triggering 'stop'/close below) once the
                  // redirect takes effect. Nothing more to do here on success.
                  const redirected = transferPhoneNumber
                    ? await transferCallToHuman(callSid, transferPhoneNumber, reason).catch((err) => {
                        console.error(`transfer redirect threw for call ${callSid}:`, err.message);
                        return false;
                      })
                    : false;

                  // transfer_category feeds the exceptions queue's "low-confidence call
                  // queue" (ROADMAP.md §9) — set once here regardless of whether the
                  // redirect itself succeeds, since either way the call needed escalating.
                  // transfer is a structured record alongside it — /voice/transfer-result
                  // (src/webhooks/twilio.js) fills in transfer.status/resolvedAt once the
                  // dial attempt actually finishes.
                  const transferRecord = { reason, targetPhone: transferPhoneNumber ?? null, requestedAt: new Date(), status: redirected ? 'redirected' : 'failed' };

                  if (redirected) {
                    await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: `transferred: ${reason}`.slice(0, 200), transfer_category: category ?? null, transfer: transferRecord } }));
                    return;
                  }

                  // No target configured, or the redirect itself failed — never leave the
                  // caller with nothing: queue a callback the same way an explicit
                  // request_callback tool call would (ROADMAP.md §5 "Callback creation
                  // when staff are unavailable"), then end gracefully like before.
                  await withTenant(business.id, (c) => Promise.all([
                    c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: `transferred: ${reason}`.slice(0, 200), transfer_category: category ?? null, transfer: transferRecord } }),
                    fromNumber
                      ? c('callback_requests').insertOne({ _id: newId(), call_sid: callSid, phone: fromNumber, preferred_time: null, reason, status: 'pending', created_at: new Date(), assigned_to: null, resolved_at: null, resolved_by: null, resolution_notes: null })
                      : Promise.resolve(),
                  ]));
                  // Give Gemini's in-flight audio (e.g. "let me transfer you") a moment to
                  // reach Twilio before hanging up.
                  setTimeout(() => ws.close(), 2000);
                },
                onBookingCreated: async (bookingId) => {
                  await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { booking_id: bookingId } }));
                },
                onEnded: () => {
                  if (ws.readyState === ws.OPEN) ws.close();
                },
              });
              activeCalls++;
              counted = true;
            } catch (err) {
              console.error(`gemini session failed to start for call ${callSid}:`, err.message);
              await withTenant(business.id, (c) => Promise.all([
                c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: 'failed: ai_unavailable' } }),
                fromNumber
                  ? c('callback_requests').insertOne({ _id: newId(), call_sid: callSid, phone: fromNumber, preferred_time: null, reason: 'AI agent was unavailable', status: 'pending', created_at: new Date(), assigned_to: null, resolved_at: null, resolved_by: null, resolution_notes: null })
                  : Promise.resolve(),
              ]));
              await endCallWithMessage(callSid, "Sorry, we're having a technical issue on our end. Please try calling back in a few minutes.");
              await finalizeCall();
              ws.close();
              return;
            }
            break;
          }

          case 'media': {
            if (!gemini) return;
            if (mulawFrameLevel(msg.media.payload) > SPEECH_LEVEL) lastActivityAt = Date.now();
            gemini.sendCallerAudio(twilioPayloadToGeminiPCM(msg.media.payload));
            break;
          }

          case 'stop': {
            await finalizeCall();
            break;
          }
        }
      } catch (err) {
        console.error('error handling twilio media stream message:', err);
      }
    });

    ws.on('close', () => finalizeCall().catch((err) => console.error(`finalizeCall on close failed for call ${callSid}:`, err.message)));
    ws.on('error', (err) => console.error('twilio media stream socket error:', err.message));
  });

  return wss;
}
