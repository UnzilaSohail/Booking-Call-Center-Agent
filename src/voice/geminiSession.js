// Wraps one Gemini Live session for one phone call (plan.md §3/§5/§8 phase 4).
//
// CAVEAT (also flagged in plan.md §3): the Live API's exact model name, message shapes
// and audio format move fast — 'gemini-2.0-flash-live-001' (the original model here)
// was retired at some point after this was written; 'gemini-3.8-live' is the current
// stable alias as of the last check (2026-09-16), confirmed directly against the API:
// connects, streams audio back via `message.data` (as this file already expects), and
// function-calling round-trips via `message.toolCall.functionCalls` (also already what
// this file expects) — so the message-shape assumptions below didn't need to change,
// only the model id did. If GEMINI_LIVE_MODEL ever starts failing with a 404, that's
// almost certainly the model having moved on again — check `ai.models.list()` for
// anything with "live" in the name and matching `bidiGenerateContent` support.
import { GoogleGenAI, Modality } from '@google/genai';
import { toolDeclarations, createToolHandlers } from './tools.js';
import { withTenant } from '../db.js';
import { DEFAULT_VOICE } from '../routes/onboarding.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

async function buildSystemInstruction(business) {
  const [services, staff] = await withTenant(business.id, (c) => Promise.all([
    c('services').find({}, { projection: { name: 1, duration_minutes: 1, price: 1 } }).toArray(),
    c('staff').find({}, { projection: { name: 1 } }).toArray(),
  ]));

  // business.hours is embedded on the business document itself (src/routes/config.js),
  // already loaded as part of the business object passed in — no separate query needed.
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hours = business.hours ?? [];
  const hoursText = hours.length
    ? [...hours].sort((a, b) => a.day_of_week - b.day_of_week).map((h) => `${dayNames[h.day_of_week]}: ${h.open_time}-${h.close_time}`).join(', ')
    : 'not configured — tell the caller you\'ll need to check and call them back';

  const faqs = business.faqs ?? [];
  const faqText = faqs.length
    ? faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')
    : null;

  return `You are the phone booking agent for "${business.name}". Speak naturally and concisely, like a helpful receptionist — this is a live phone call, not a chat.

Services offered: ${services.map((s) => `${s.name} (${s.duration_minutes} min)`).join(', ') || 'none configured yet'}.
${staff.length ? `Staff: ${staff.map((s) => s.name).join(', ')}.` : 'This business has a single shared calendar — do not ask which staff member.'}
Business hours (${business.timezone}): ${hoursText}.
${faqText ? `\nCommon questions you can answer directly from this business's own answers (use these verbatim in spirit, don't invent extra policy beyond them):\n${faqText}\n` : ''}
Rules:
- Always call check_availability before offering a time slot. Never invent times.
- Before calling create_booking or reschedule_booking, read the exact date and time back to the caller in plain speech ("Tuesday the 14th at 11:30 AM") and get an explicit yes. This is mandatory — misheard dates are the most common error.
- For reschedule/cancel requests, call find_upcoming_bookings with the caller's phone number first to get the booking id.
- If the caller asks a question covered by the common-questions list above, answer from it. If they ask something else outside booking/reschedule/cancel/business-info, or explicitly ask for a person, call transfer_to_human.
- If a request fails (e.g. slot no longer available or too close to the appointment to change), explain briefly and offer alternatives — don't just repeat the error.
- Keep responses short; this is a voice call, not a document.`;
}

export async function startGeminiSession({ business, callSid, onAudio, onTranscript, onTransferToHuman, onBookingCreated, onEnded }) {
  const systemInstruction = await buildSystemInstruction(business);
  const handlers = createToolHandlers(business, callSid);

  const session = await ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools: [{ functionDeclarations: toolDeclarations }],
      // Per-business AI voice, set via onboarding (src/routes/onboarding.js POST
      // /onboarding/voice); falls back to the same default a business gets before ever
      // touching that step.
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: business.voice_name || DEFAULT_VOICE } } },
      // Native audio in/out on one session absorbs turn-taking/interruption (barge-in)
      // handling — no custom VAD needed (plan.md §3, §6 "Dead air / silence handling").
    },
    callbacks: {
      onopen() {
        console.log(`gemini live session open for call ${callSid}`);
      },
      onmessage: async (message) => {
        try {
          const audioChunk = message.data
            ?? message.serverContent?.modelTurn?.parts?.find((p) => p.inlineData?.mimeType?.startsWith('audio/'))?.inlineData?.data;
          if (audioChunk) onAudio(audioChunk);

          const text = message.serverContent?.modelTurn?.parts?.find((p) => p.text)?.text;
          if (text) onTranscript?.('agent', text);

          const functionCalls = message.toolCall?.functionCalls;
          if (functionCalls?.length) {
            const responses = [];
            for (const call of functionCalls) {
              const handler = handlers[call.name];
              let response;
              try {
                response = handler ? await handler(call.args ?? {}) : { error: `unknown tool ${call.name}` };
              } catch (err) {
                console.error(`tool ${call.name} threw:`, err);
                response = { error: 'internal error handling this request' };
              }
              if (call.name === 'transfer_to_human' && !response.error) onTransferToHuman?.(response.reason);
              if (call.name === 'create_booking' && !response.error) onBookingCreated?.(response.bookingId);
              responses.push({ id: call.id, name: call.name, response });
            }
            session.sendToolResponse({ functionResponses: responses });
          }

          if (message.serverContent?.interrupted) {
            // Caller talked over the agent — Live API already stopped generating; the
            // bridge (twilioBridge.js) should flush anything queued for playback.
            onAudio?.(null, { interrupted: true });
          }
        } catch (err) {
          console.error('error handling gemini live message:', err);
        }
      },
      onerror(err) {
        console.error(`gemini live session error for call ${callSid}:`, err?.message ?? err);
      },
      onclose(event) {
        console.log(`gemini live session closed for call ${callSid}:`, event?.reason ?? '');
        onEnded?.();
      },
    },
  });

  return {
    sendCallerAudio(base64Pcm16kMono) {
      session.sendRealtimeInput({ audio: { data: base64Pcm16kMono, mimeType: 'audio/pcm;rate=16000' } });
    },
    close() {
      try { session.close(); } catch { /* already closed */ }
    },
  };
}
