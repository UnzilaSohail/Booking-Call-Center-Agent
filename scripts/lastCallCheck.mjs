// Checks the most recent real phone call and says whether everything that should have been saved was saved
// (Jira 31j, 23d). Run it right after a test call:
//
//   npm run call:check                       the latest call to any business
//   npm run call:check -- +15551234567       the latest call FROM that caller number
//
// Reads the database named in .env (MONGODB_URI / MONGODB_DB_NAME); changes nothing.
import 'dotenv/config';
import { getDb, client } from '../src/db.js';

const phone = process.argv[2];
const db = await getDb();
const call = await db.collection('call_logs').find({ is_test: { $ne: true }, ...(phone ? { phone } : {}) }).sort({ created_at: -1 }).limit(1).next();
if (!call) { console.log(`No calls found${phone ? ` from ${phone}` : ''}. Place a call to the business number first.`); await client.close(); process.exit(1); }

const business = await db.collection('businesses').findOne({ _id: call.business_id }, { projection: { name: 1, recording_enabled: 1 } });
const ageMin = Math.round((Date.now() - new Date(call.created_at).getTime()) / 60_000);
console.log(`Latest call: ${business?.name ?? call.business_id}, from ${call.phone ?? 'unknown'}, ${ageMin} minute(s) ago, outcome "${call.outcome ?? 'none'}"\n`);

const lines = String(call.transcript ?? '').split('\n').filter(Boolean);
const spoke = (who) => lines.some((l) => new RegExp(`^\\s*${who}\\s*:`, 'i').test(l));
const checks = [
  ['The call finished (not stuck "in progress")', call.outcome && call.outcome !== 'in_progress', 'The call never closed properly: check the backend log for errors around that time.'],
  ['The call length was saved', typeof call.duration_seconds === 'number' && call.duration_seconds > 0, 'Without it the call is not billed: the call end was not recorded.'],
  ['A transcript was saved', String(call.transcript ?? '').trim().length > 20, 'This is the 29 September problem: the call worked but nothing was written down. Check the backend log and the Gemini key.'],
  ['The transcript has the AI speaking', spoke('agent|ai|assistant'), 'No AI lines: the AI may not have answered.'],
  ['The transcript has the caller speaking', spoke('caller|customer|user'), 'No caller lines: the caller audio may not have reached the AI.'],
  ['A summary was written', Boolean(call.summary), 'The summary comes from Gemini after the call; if missing, check the Gemini key and quota.'],
  ['The AI understood what the caller wanted (intent)', Boolean(call.intent), 'Same cause as the summary.'],
];
const warns = [
  ['A recording exists', Boolean(call.recording_url) || business?.recording_enabled === false, 'No recording: see the "not eligible for recording" part of docs/guides/TWILIO_SETUP.md (AIN-391). Calls still work without it.'],
  ['A booking was linked (only expected if you booked during the call)', Boolean(call.booking_id), 'Fine if you did not book anything on this call.'],
];

let failed = 0;
for (const [name, ok, hint] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) { failed++; console.log(`      ${hint}`); } }
for (const [name, ok, hint] of warns) { console.log(`${ok ? 'PASS' : 'note'}  ${name}`); if (!ok) console.log(`      ${hint}`); }
if (call.summary) console.log(`\nSummary: ${call.summary}`);
console.log(failed ? `\n${failed} check(s) failed.` : '\nThe call was saved properly.');
await client.close();
process.exit(failed ? 1 : 0);
