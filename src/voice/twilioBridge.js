// Bridges a Twilio Media Streams WebSocket to a Gemini Live session (plan.md §3/§5/§8
// phase 4). Twilio pushes 8kHz mu-law audio frames as JSON text messages over this
// socket per https://www.twilio.com/docs/voice/media-streams/websocket-messages —
// this handler speaks that protocol directly (no Twilio server-side SDK needed for it).
import { WebSocketServer } from 'ws';
import { twilioPayloadToGeminiPCM, geminiPCMToTwilioPayload } from './audio.js';
import { startGeminiSession } from './geminiSession.js';
import { transferCallToHuman } from '../webhooks/twilio.js';
import { getDb, withTenant, newId, serialize } from '../db.js';

export function attachTwilioMediaStreamServer(httpServer, path = '/voice/stream') {
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
    const transcript = [];

    // plan.md §6 "Dead air / silence handling": Gemini Live's own VAD handles normal
    // turn-taking, but a genuinely dead line (no media frames at all — not even comfort
    // noise) needs a call-level watchdog so we don't hold the line open indefinitely.
    let lastMediaAt = Date.now();
    const SILENCE_TIMEOUT_MS = 30_000;
    const MAX_CALL_DURATION_MS = 15 * 60_000;
    const startedAt = Date.now();
    const watchdog = setInterval(() => {
      const now = Date.now();
      if (now - lastMediaAt > SILENCE_TIMEOUT_MS || now - startedAt > MAX_CALL_DURATION_MS) {
        console.warn(`ending call ${callSid} — ${now - lastMediaAt > SILENCE_TIMEOUT_MS ? 'silence timeout' : 'max duration reached'}`);
        ws.close();
      }
    }, 5_000);
    ws.on('close', () => clearInterval(watchdog));

    ws.on('message', async (raw) => {
      lastMediaAt = Date.now();
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

            const db = await getDb();
            const foundBusiness = await db.collection('businesses').findOne({ _id: businessId });
            business = foundBusiness ? serialize(foundBusiness) : null;
            if (!business) {
              console.error(`media stream started with unknown businessId ${businessId}`);
              ws.close();
              return;
            }

            gemini = await startGeminiSession({
              business,
              callSid,
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
                ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: geminiPCMToTwilioPayload(base64Pcm24k) } }));
              },
              onTranscript: (speaker, text) => transcript.push(`${speaker}: ${text}`),
              onTransferToHuman: async (reason, transferPhoneNumber) => {
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

                if (redirected) {
                  await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: `transferred: ${reason}`.slice(0, 200) } }));
                  return;
                }

                // No target configured, or the redirect itself failed — never leave the
                // caller with nothing: queue a callback the same way an explicit
                // request_callback tool call would (ROADMAP.md §5 "Callback creation
                // when staff are unavailable"), then end gracefully like before.
                await withTenant(business.id, (c) => Promise.all([
                  c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: `transferred: ${reason}`.slice(0, 200) } }),
                  fromNumber
                    ? c('callback_requests').insertOne({ _id: newId(), call_sid: callSid, phone: fromNumber, preferred_time: null, reason, status: 'pending', created_at: new Date() })
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
            break;
          }

          case 'media': {
            if (!gemini) return;
            gemini.sendCallerAudio(twilioPayloadToGeminiPCM(msg.media.payload));
            break;
          }

          case 'stop': {
            gemini?.close();
            if (business) {
              await withTenant(business.id, async (c) => {
                const current = await c('call_logs').findOne({ call_sid: callSid });
                const outcome = current?.outcome && current.outcome !== 'in_progress' ? current.outcome : 'completed';
                await c('call_logs').updateOne({ call_sid: callSid }, { $set: { transcript: transcript.join('\n'), outcome } });
              });
            }
            break;
          }
        }
      } catch (err) {
        console.error('error handling twilio media stream message:', err);
      }
    });

    ws.on('close', () => gemini?.close());
    ws.on('error', (err) => console.error('twilio media stream socket error:', err.message));
  });

  return wss;
}
