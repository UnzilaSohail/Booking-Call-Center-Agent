// The Media Stream WebSocket (/voice/stream) is reachable by anyone on the internet, and the business id it asks for
// is not secret (it sits inside the public manage-link token). The TwiML our signature-checked Twilio webhook
// returns carries this HMAC of (business, call), and the bridge refuses a `start` without it, so only a call we
// actually answered can open a Gemini session. Keyed with JWT_SECRET, which the server already refuses to start without.
import { createHmac, timingSafeEqual } from 'node:crypto';

const mac = (businessId, callSid) => createHmac('sha256', process.env.JWT_SECRET).update(`stream:${businessId}:${callSid}`).digest('hex');

export const signStreamToken = (businessId, callSid) => mac(businessId, callSid);

export function verifyStreamToken(businessId, callSid, token) {
  if (!businessId || !callSid || typeof token !== 'string') return false;
  const want = Buffer.from(mac(businessId, callSid));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}
