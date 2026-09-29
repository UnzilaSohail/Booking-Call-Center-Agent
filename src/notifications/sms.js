import twilio from 'twilio';
import { withTenant, newId } from '../db.js';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_SMS_FROM; // may differ from the per-business inbound voice number

let client = null;
function getClient() {
  if (!accountSid || !authToken) return null;
  client ??= twilio(accountSid, authToken);
  return client;
}

// Returns the sent message's sid (so callers can track delivery status — see
// src/webhooks/twilio.js POST /webhooks/twilio/sms-status), or null if it wasn't sent.
// businessId is optional (verification-code sends during signup aren't billable tenant
// usage) — when given, this is the single choke point every SMS send goes through, so
// it's where usage gets logged for billing (ROADMAP.md §11 "SMS usage tracking") rather
// than each caller remembering to.
export async function sendSms(businessId, to, body) {
  const c = getClient();
  if (!c || !fromNumber) {
    console.warn('SMS not sent (Twilio not configured):', to, body);
    return null;
  }
  const statusCallback = process.env.PUBLIC_HTTPS_URL ? `${process.env.PUBLIC_HTTPS_URL}/webhooks/twilio/sms-status` : undefined;
  const message = await c.messages.create({ to, from: fromNumber, body, ...(statusCallback ? { statusCallback } : {}) });
  if (businessId) {
    await withTenant(businessId, (col) => col('sms_sends').insertOne({ _id: newId(), sid: message.sid, sent_at: new Date() }))
      .catch((err) => console.error('failed to log sms usage:', err.message));
  }
  return message.sid;
}
