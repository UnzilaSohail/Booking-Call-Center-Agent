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
import { DateTime } from 'luxon';
import { GoogleGenAI, Modality } from '@google/genai';
import { toolDeclarations, createToolHandlers } from './tools.js';
import { withTenant } from '../db.js';
import { DEFAULT_VOICE } from '../routes/onboarding.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A business that never touched the Knowledge Base UI (src/routes/knowledge.js) has no
// `knowledge` yet — same fallback that endpoint uses, so a fresh business still gets a
// working prompt built from whatever legacy `faqs` it has.
function resolveKnowledge(business) {
  if (business.knowledge) return business.knowledge;
  return { faqs: business.faqs ?? [] };
}

// Whether the business is open right now, in its own timezone — distinct from
// check_availability's per-day hours lookup, this is "is anyone there *at this moment*"
// so the agent can greet accordingly instead of behaving as if a human just picked up.
function isOpenNow(business) {
  const hours = business.hours ?? [];
  if (!hours.length) return null; // hours not configured — don't claim either way
  const now = DateTime.now().setZone(business.timezone);
  const today = hours.find((h) => h.day_of_week === now.weekday % 7);
  if (!today) return false;
  const [openH, openM] = today.open_time.split(':').map(Number);
  const [closeH, closeM] = today.close_time.split(':').map(Number);
  const open = now.set({ hour: openH, minute: openM, second: 0 });
  const close = now.set({ hour: closeH, minute: closeM, second: 0 });
  return now >= open && now < close;
}

export async function buildSystemInstruction(business) {
  const [services, staff] = await withTenant(business.id, (c) => Promise.all([
    c('services').find({}, { projection: { name: 1, duration_minutes: 1, price: 1 } }).toArray(),
    c('staff').find({}, { projection: { name: 1 } }).toArray(),
  ]));
  return formatSystemInstruction(business, services, staff);
}

// Pure — no DB access — so it's directly unit-testable
// (test/geminiSystemInstruction.test.js) with fabricated services/staff arrays.
export function formatSystemInstruction(business, services, staff) {
  // business.hours is embedded on the business document itself (src/routes/config.js),
  // already loaded as part of the business object passed in — no separate query needed.
  const hours = business.hours ?? [];
  const hoursText = hours.length
    ? [...hours].sort((a, b) => a.day_of_week - b.day_of_week).map((h) => `${DAY_NAMES[h.day_of_week]}: ${h.open_time}-${h.close_time}`).join(', ')
    : 'not configured — tell the caller you\'ll need to check and call them back';

  const k = resolveKnowledge(business);
  const faqs = k.faqs ?? [];
  const faqText = faqs.length
    ? faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')
    : null;
  const pronunciation = k.pronunciation ?? [];
  const pronunciationText = pronunciation.length
    ? pronunciation.map((p) => `Say "${p.term}" like "${p.pronunciation}".`).join(' ')
    : null;

  const departments = business.transfer_departments ?? [];
  const departmentsText = departments.length ? departments.map((d) => d.name).join(', ') : null;

  const open = isOpenNow(business);
  const openingLine = k.greeting
    ? `Open the call by saying, in your own natural voice, essentially: "${k.greeting}"${open === false ? ' — then let them know you\'re currently closed.' : '.'}`
    : `Open the call with a brief, warm greeting naming the business (e.g. "Thanks for calling ${business.name}, how can I help?")${open === false ? ', and let them know you\'re currently closed.' : '.'}`;

  return `You are the phone receptionist for "${business.name}". Speak naturally and concisely, like a helpful receptionist — this is a live phone call, not a chat.
${pronunciationText ? `\nPronunciation: ${pronunciationText}` : ''}

${openingLine}

Services offered: ${services.map((s) => `${s.name} (${s.duration_minutes} min)`).join(', ') || 'none configured yet'}.
${staff.length ? `Staff: ${staff.map((s) => s.name).join(', ')}.` : 'This business has a single shared calendar — do not ask which staff member.'}
Business hours (${business.timezone}): ${hoursText}.
${open === false ? '\nThe business is CLOSED right now (outside its business hours). You can still check availability and book future appointments — just be upfront that no one is there this moment. If the caller wants to leave a message, use leave_voicemail; if they\'d rather be called back, use request_callback.\n' : ''}
${faqText ? `\nCommon questions you can answer directly from this business's own answers (use these verbatim in spirit, don't invent extra policy beyond them):\n${faqText}\n` : ''}
${k.booking_policy ? `\nBooking policy: ${k.booking_policy}` : ''}
${k.cancellation_policy ? `\nCancellation policy: ${k.cancellation_policy}` : ''}
${k.preparation_instructions ? `\nTell the caller, once a booking is confirmed: ${k.preparation_instructions}` : ''}
${k.restricted_topics ? `\nDo NOT discuss or advise on: ${k.restricted_topics}. If asked, politely decline and offer to transfer to a human.` : ''}
${k.emergency_rules ? `\nEmergency rules for this business: ${k.emergency_rules}\nIf the caller's situation matches this, say what these rules say to say, then call flag_emergency with a brief reason (in addition to transfer_to_human if the rules call for that).` : ''}

Rules:
- Always call check_availability before offering a time slot. Never invent times.
- Before calling create_booking or reschedule_booking, read the exact date and time back to the caller in plain speech ("Tuesday the 14th at 11:30 AM") and get an explicit yes. This is mandatory — misheard dates are the most common error.
- For reschedule/cancel requests, call find_upcoming_bookings with the caller's phone number first to get the booking id.
- If the caller asks a question covered by the common-questions list above, answer from it.
- If the caller wants to leave a message for staff, use leave_voicemail (confirm the message back to them first). If they'd rather staff call them back, use request_callback.
- If they ask for something else this system doesn't support (outside booking/reschedule/cancel/business-info/messages/callbacks), explicitly ask for a person, seem upset, or you're not confident you understood their request correctly even after asking once to clarify, call transfer_to_human. Tell them you're transferring first, and give a genuinely useful reason (what they need, not just "caller request") — that reason is read to whoever picks up before you're connected.
${departmentsText ? `- This business has these departments a caller might ask for: ${departmentsText}. Pass the matching one as transfer_to_human's department argument.` : ''}
${staff.length ? `- If the caller names a specific staff member for the transfer, pass their name as transfer_to_human's staffName argument.` : ''}
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
              if (call.name === 'transfer_to_human' && !response.error) onTransferToHuman?.(response.reason, response.transferPhoneNumber);
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
