// Sends ONE real test text and reports what Twilio did with it, in plain words (Jira 31i, KG-19).
// Why: Twilio can say "delivered" or accept a text and the phone still gets nothing. This follows the message for
// about 30 seconds and explains any Twilio error code.
//
//   npm run sms:check -- +15551234567                 (send from TWILIO_SMS_FROM in .env)
//   npm run sms:check -- +15551234567 +18135550142    (send from a specific Twilio number)
//
// It sends a real text (a trial account adds its own "Sent from your Twilio trial account" prefix) and costs about a cent.
import 'dotenv/config';
import twilio from 'twilio';

const [to, fromArg] = process.argv.slice(2);
const from = fromArg || process.env.TWILIO_SMS_FROM;
if (!to || !/^\+\d{10,15}$/.test(to)) {
  console.log('Usage: npm run sms:check -- +<phone to text> [+<Twilio number to send from>]\nThe phone number must be in international format, for example +15551234567.');
  process.exit(2);
}
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) { console.log('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set in .env.'); process.exit(2); }
if (!from) { console.log('No sending number: pass one as the second argument or set TWILIO_SMS_FROM in .env.'); process.exit(2); }

// What the common Twilio error codes mean for us, and what to do (see docs/guides/TWILIO_SETUP.md)
const EXPLAIN = {
  21408: 'Texting to this country/region is switched off on your Twilio account. Fix: Twilio Console > Messaging > Settings > Geo permissions, tick the country.',
  21608: 'This is a Twilio TRIAL account: it can only text phone numbers you have verified. Fix: verify the number in the Console (Phone Numbers > Verified Caller IDs) or upgrade the account.',
  21211: 'That phone number is not valid. Check the country code and digits.',
  21614: 'That number cannot receive text messages (for example a landline).',
  30003: 'The phone was unreachable or switched off.',
  30005: 'The number does not exist or is not active.',
  30006: 'A landline or a number that cannot get texts.',
  30007: 'The carrier filtered the message as spam. Usually the sending number is not registered for business texting (A2P 10DLC) in the US, or needs a sender ID abroad. See docs/guides/TWILIO_SETUP.md.',
  30034: 'US numbers must be registered (A2P 10DLC) before they can text. Register the brand and campaign in the Twilio Console, then attach the number to the campaign.',
  30008: 'Delivery failed for an unknown reason (carrier). Try another phone or number.',
};

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
let msg;
try {
  msg = await client.messages.create({ to, from, body: 'Test message from the booking system. If you can read this, texting works.' });
} catch (err) {
  console.log(`FAIL  Twilio refused the message straight away: ${err.message}`);
  if (EXPLAIN[err.code]) console.log(`      ${EXPLAIN[err.code]}`);
  console.log(`      (Twilio error ${err.code ?? 'unknown'}: https://www.twilio.com/docs/api/errors/${err.code ?? ''})`);
  process.exit(1);
}
console.log(`Sent. Following message ${msg.sid} (to ${to} from ${from})...`);

for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const m = await client.messages(msg.sid).fetch();
  console.log(`  ${(i + 1) * 3}s: ${m.status}${m.errorCode ? ` (error ${m.errorCode})` : ''}`);
  if (m.status === 'delivered') {
    console.log('PASS  Twilio says it was delivered. Now check that the phone really received it. If it did not, the carrier filtered it silently: see "silent filtering" in docs/guides/TWILIO_SETUP.md.');
    process.exit(0);
  }
  if (['undelivered', 'failed'].includes(m.status)) {
    console.log(`FAIL  ${EXPLAIN[m.errorCode] ?? `Twilio could not deliver it (error ${m.errorCode ?? 'unknown'}).`}`);
    console.log(`      https://www.twilio.com/docs/api/errors/${m.errorCode ?? ''}`);
    process.exit(1);
  }
}
console.log('UNKNOWN  Still not delivered after 30 seconds. Check the message in the Twilio Console (Monitor > Logs > Messaging) and look at the phone.');
process.exit(1);
