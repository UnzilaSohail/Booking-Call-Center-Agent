// Proof that the person booking online owns the phone number they typed (Jira 47). Without it, anyone could book (and text
// confirmations to) somebody else's number. Before confirming, the customer gets a 6-digit code by text and types it in.
// It is OFF until the owner switches it on in Settings (a code nobody receives would stop all online booking, so turn it on only
// after a real test text arrives) AND it applies only when text messaging works on this server; if texts cannot be sent there is
// no way to deliver a code, so booking stays open rather than shut.
import { getDb } from '../db.js';
import { generateCode, hashCode, verifyCode, fakeVerify, CODE_TTL_MS, MAX_ATTEMPTS } from '../verification.js';
import { sendSms, smsConfigured } from '../notifications/sms.js';

const RESEND_COOLDOWN_MS = 60_000;
const codes = async () => (await getDb()).collection('booking_codes');

export const phoneCodeRequired = (business) => business.phone_verification === true && smsConfigured();

// -> 'sent' | 'wait' (one was just sent) | 'failed' (the text could not be sent). `send` is injectable for tests.
export async function sendPhoneCode(business, phone, { send = sendSms } = {}) {
  const col = await codes();
  const _id = `${business._id}:${phone}`;
  const existing = await col.findOne({ _id });
  if (existing && Date.now() - new Date(existing.created_at).getTime() < RESEND_COOLDOWN_MS) return 'wait';
  const code = generateCode();
  await col.replaceOne({ _id }, { _id, business_id: business._id, phone, code_hash: await hashCode(code), attempts: 0, created_at: new Date(), expires_at: new Date(Date.now() + CODE_TTL_MS) }, { upsert: true });
  const sid = await send(business._id, phone, `${business.name}: your booking code is ${code}. It expires in 10 minutes.`);
  return sid ? 'sent' : 'failed';
}

// -> 'missing' (nothing usable typed) | 'wrong' | 'ok'. Every try is counted first, atomically, so parallel guesses cannot beat the limit.
export async function checkPhoneCode(business, phone, code) {
  const typed = String(code ?? '').trim();
  if (!/^\d{6}$/.test(typed)) return 'missing';
  const row = await (await codes()).findOneAndUpdate({ _id: `${business._id}:${phone}` }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
  if (!row) { await fakeVerify(typed); return 'wrong'; } // same time as a wrong code
  if (row.attempts > MAX_ATTEMPTS || !(await verifyCode(typed, row.code_hash, row.expires_at))) return 'wrong';
  return 'ok';
}

// Used once: after the booking succeeded (a clash on the time keeps the code so the customer can pick another slot).
export async function consumePhoneCode(business, phone) {
  await (await codes()).deleteOne({ _id: `${business._id}:${phone}` });
}
