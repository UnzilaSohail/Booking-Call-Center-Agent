// Load test for the PUBLIC booking page API (Jira 23a): real concurrent HTTP against a running
// server, then checks that the guarantees still hold under load:
//   1. race        N people book the SAME slot at once -> exactly one 201, everyone else 409
//   2. no false    N bookings on DIFFERENT slots at once -> all 201 (no phantom conflicts)
//   3. reads       many parallel availability requests -> all 200; prints p50/p95 latency
//
// Usage:  npm start                                   (one terminal, same MONGODB_URI/DB as below)
//         API_URL=http://localhost:3000 npm run load-test:public
//
// It creates its own business directly in the database (so it needs the same MONGODB_URI as the
// server) and deletes everything afterwards. Per-IP rate limits would stop a single machine, so
// each request sends its own X-Forwarded-For. That only works when talking to node directly; behind
// nginx the real IP is appended last and the limits (10 bookings / 10 min / IP) will, correctly, kick in.
// Set LOADTEST_SPOOF_IP=0 to see exactly that.
import 'dotenv/config';
import { DateTime } from 'luxon';
import { client, getDb, newId } from '../src/db.js';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const RACE = Number(process.env.LOAD_TEST_CONCURRENCY || 20);
const SPREAD = Number(process.env.LOAD_TEST_SPREAD || 40);
const READS = Number(process.env.LOAD_TEST_READS || 100);
const SPOOF = process.env.LOADTEST_SPOOF_IP !== '0';

let ipCounter = 0;
const nextIp = () => { ipCounter += 1; return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; };

async function call(path, body) {
  const t0 = performance.now();
  const res = await fetch(`${API_URL}/api/public${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(SPOOF ? { 'x-forwarded-for': nextIp() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - t0 };
}

const tally = (rs) => rs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
const pct = (rs, p) => [...rs].map((r) => r.ms).sort((a, b) => a - b)[Math.min(rs.length - 1, Math.floor(rs.length * p))].toFixed(0);

async function main() {
  const db = await getDb();
  const suffix = Date.now();
  const slug = `loadtest-${suffix}`;
  const businessId = newId();
  const serviceId = newId();
  const staffId = newId();
  const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '18:00' }));
  await db.collection('businesses').insertOne({
    _id: businessId, name: `__loadtest_${suffix}__`, slug, timezone: 'UTC', hours, status: 'active', onboarding_completed_at: new Date(),
    google_calendar_id: 'primary', reschedule_cutoff_minutes: 120, created_at: new Date(),
  });
  await db.collection('services').insertOne({ _id: serviceId, business_id: businessId, name: 'load-test-service', duration_minutes: 30, buffer_minutes: 0 });
  await db.collection('staff').insertOne({ _id: staffId, business_id: businessId, name: 'Load Tester' });

  const day = (n) => DateTime.utc().plus({ days: n }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const booking = (i, startTime) => ({
    serviceId, staffId, startTime: startTime.toISO(), name: `caller-${i}`, phone: `+1555${String(8000000 + i)}`,
    consent: { sms: false, email: false }, idempotencyKey: `lt-${suffix}-${i}`,
  });
  const failures = [];
  const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

  console.log(`public load test against ${API_URL} (slug ${slug}, ${SPOOF ? 'spoofed client IPs' : 'single client IP'})`);
  try {
    const race = await Promise.all(Array.from({ length: RACE }, (_, i) => call(`/${slug}/bookings`, booking(i, day(2)))));
    const r = tally(race);
    console.log(`race:   ${RACE} people, same slot -> ${JSON.stringify(r)}`);
    check(r[201] === 1, `exactly one winner (got ${r[201] ?? 0})`);
    check((r[201] ?? 0) + (r[409] ?? 0) + (r[429] ?? 0) === RACE, 'everyone else got a clean 409 (or 429 if rate limited)');
    check(await db.collection('bookings').countDocuments({ business_id: businessId, start_time: day(2).toJSDate() }) === 1, 'one booking row in the database');

    const spread = await Promise.all(Array.from({ length: SPREAD }, (_, i) => call(`/${slug}/bookings`, booking(1000 + i, day(10 + i)))));
    const s = tally(spread);
    console.log(`spread: ${SPREAD} people, different slots -> ${JSON.stringify(s)}`);
    check(s[201] === SPREAD, `no false conflicts under load (${s[201] ?? 0}/${SPREAD} created)`);

    const reads = await Promise.all(Array.from({ length: READS }, () => call(`/${slug}/availability?serviceId=${serviceId}&date=${day(3).toISODate()}&staffId=any`)));
    const rd = tally(reads);
    console.log(`reads:  ${READS} availability requests -> ${JSON.stringify(rd)}  p50 ${pct(reads, 0.5)} ms, p95 ${pct(reads, 0.95)} ms`);
    check(rd[200] === READS, 'every read answered 200');
  } finally {
    for (const c of ['services', 'staff', 'bookings', 'booking_slot_locks', 'customers', 'failed_bookings', 'sms_sends']) await db.collection(c).deleteMany({ business_id: businessId });
    await db.collection('businesses').deleteOne({ _id: businessId });
    await client.close();
  }
  if (failures.length) throw new Error(`${failures.length} check(s) failed`);
  console.log('public load test PASSED');
}

export async function run() {
  try {
    await main();
  } catch (err) {
    console.error('public load test FAILED:', err.message);
    process.exitCode = 1;
  }
}

// Runs by itself when started directly (npm run load-test:public); scripts/loadTest.js --public calls run().
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/loadTestPublic.js')) await run();
