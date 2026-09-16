import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_SMS_FROM; // may differ from the per-business inbound voice number

let client = null;
function getClient() {
  if (!accountSid || !authToken) return null;
  client ??= twilio(accountSid, authToken);
  return client;
}

export async function sendSms(to, body) {
  const c = getClient();
  if (!c || !fromNumber) {
    console.warn('SMS not sent (Twilio not configured):', to, body);
    return;
  }
  await c.messages.create({ to, from: fromNumber, body });
}
