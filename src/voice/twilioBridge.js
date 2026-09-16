// Bridges a Twilio Media Streams WebSocket to a Gemini Live session (plan.md §3/§5/§8
// phase 4). Twilio pushes 8kHz mu-law audio frames as JSON text messages over this
// socket per https://www.twilio.com/docs/voice/media-streams/websocket-messages —
// this handler speaks that protocol directly (no Twilio server-side SDK needed for it).
import { WebSocketServer } from 'ws';
import { twilioPayloadToGeminiPCM, geminiPCMToTwilioPayload } from './audio.js';
import { startGeminiSession } from './geminiSession.js';
import { getDb, withTenant, serialize } from '../db.js';

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
              onTransferToHuman: async (reason) => {
                await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: `transferred: ${reason}`.slice(0, 200) } }));
                // Give Gemini's in-flight audio (e.g. "let me transfer you") a moment to
                // reach Twilio before hanging up. MVP: ends the call cleanly rather than
                // a real warm transfer — wiring <Dial> to a human queue number is a
                // Twilio REST call away but needs a real queue/number to dial.
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
