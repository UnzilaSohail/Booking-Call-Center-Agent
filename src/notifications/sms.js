import twilio from 'twilio';
import { getDb, withTenant, newId } from '../db.js';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
// Platform-level fallback only — used for admin-facing sends with no business yet
// (src/routes/signup.js) or no business number yet (onboarding's own contact
// verification, before "Get a phone number" has run). Customer-facing sends always
// prefer the business's own number below.
const fallbackFromNumber = process.env.TWILIO_SMS_FROM;

let client = null;
function getClient() {
  if (!accountSid || !authToken) return null;
  client ??= twilio(accountSid, authToken);
  return client;
}

// Read at call time so tests can toggle it. Doesn't require TWILIO_SMS_FROM specifically
// any more — a business sending from its own number doesn't need the platform fallback
// configured at all; sendSms itself resolves whichever "from" is actually available.
export const smsConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

// Returns the sent message's sid (so callers can track delivery status — see
// src/webhooks/twilio.js POST /webhooks/twilio/sms-status), or null if it wasn't sent.
// businessId is optional (verification-code sends during signup aren't billable tenant
// usage) — when given, this is the single choke point every SMS send goes through, so
// it's where usage gets logged for billing (ROADMAP.md §11 "SMS usage tracking") rather
// than each caller remembering to.
export async function sendSms(businessId, to, body) {
  const c = getClient();
  if (!c) {
    console.warn('SMS not sent (Twilio not configured):', to, body);
    return null;
  }

  // Each tenant's customer-facing texts should come from their own number — the same one
  // the customer called — not a single number shared across every business on the
  // platform. Falls back to the platform number only when this business has none of its
  // own yet (new signups, or an admin-facing send with no business at all).
  let from = fallbackFromNumber;
  if (businessId) {
    const business = await (await getDb()).collection('businesses').findOne({ _id: businessId }, { projection: { phone_number: 1 } });
    if (business?.phone_number) from = business.phone_number;
  }
  if (!from) {
    console.warn('SMS not sent (no sending number available for this business, and no platform fallback configured):', to, body);
    return null;
  }

  const statusCallback = process.env.PUBLIC_HTTPS_URL ? `${process.env.PUBLIC_HTTPS_URL}/webhooks/twilio/sms-status` : undefined;
  // A real Twilio rejection (bad number, Geo Permissions not enabled for that region, A2P
  // 10DLC unregistered — see docs/testing/KNOWN_GAPS.md KG-19) used to throw straight out
  // of here. sendEmail already never throws; this brings sendSms in line so every caller
  // degrades gracefully instead of only the ones that happened to wrap their own try/catch
  // around it (most callers did; src/routes/onboarding.js's verify/send didn't, which is
  // what turned a routine SMS failure into a raw 500 "internal error").
  try {
    const message = await c.messages.create({ to, from, body, ...(statusCallback ? { statusCallback } : {}) });
    if (businessId) {
      await withTenant(businessId, (col) => col('sms_sends').insertOne({ _id: newId(), sid: message.sid, sent_at: new Date() }))
        .catch((err) => console.error('failed to log sms usage:', err.message));
    }
    return message.sid;
  } catch (err) {
    console.error(`SMS send to ${to} failed:`, err.message);
    return null;
  }
}
