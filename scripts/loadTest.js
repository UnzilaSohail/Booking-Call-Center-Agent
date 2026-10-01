// Phase 6 hardening (plan.md §8): fires real concurrent HTTP requests at a *running*
// server (unlike test/booking.test.js, which calls the booking service directly) to
// prove the whole stack — Express route, service layer, Mongo transaction + slot-lock
// collision guard (src/services/bookingService.js) — still lets only one caller win a
// race for the same slot.
//
// Usage: npm run migrate && npm start   (in one terminal)
//        API_URL=http://localhost:3000 npm run load-test   (in another)
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { client, getDb, newId } from '../src/db.js';

// `npm run load-test -- --public` runs the public booking page load test instead.
if (process.argv.includes('--public')) {
  await (await import('./loadTestPublic.js')).run();
  process.exit(process.exitCode ?? 0);
}

const API_URL = process.env.API_URL || 'http://localhost:3000';
const CONCURRENCY = Number(process.env.LOAD_TEST_CONCURRENCY || 20);

async function api(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  console.log(`load-testing ${API_URL} with ${CONCURRENCY} concurrent booking attempts on one slot...`);

  // Self-signup (POST /api/auth/signup) no longer exists, so create the business and its owner
  // directly in the database (this script already shares the server's MONGODB_URI) and sign a
  // session token the same way the login route does.
  const suffix = Date.now();
  const email = `loadtest+${suffix}@example.com`;
  const db0 = await getDb();
  const businessId = newId();
  const adminId = newId();
  await db0.collection('businesses').insertOne({
    _id: businessId, name: `__loadtest_${suffix}__`, timezone: 'UTC', status: 'active', google_calendar_id: 'primary', reschedule_cutoff_minutes: 120,
    hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '18:00' })), created_at: new Date(),
  });
  await db0.collection('admins').insertOne({ _id: adminId, business_id: businessId, email, name: 'Load Test', role: 'owner', status: 'active', password_hash: 'x' });
  const token = jwt.sign({ role: 'business', adminId, businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const auth = { Authorization: `Bearer ${token}` };

  const service = await api('/api/services', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'load-test-service', durationMinutes: 30 }),
  });
  const serviceId = service.body.id;

  const startTime = '2031-01-01T10:00:00.000Z';

  try {
    // Round 1: every attempt has a DIFFERENT idempotency key — only the slot-lock
    // collision guard (not the idempotency shortcut) can be what stops the duplicates.
    const attempts = Array.from({ length: CONCURRENCY }, (_, i) =>
      api('/api/bookings', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          customerName: `caller-${i}`, phone: `+1000000${i}`, serviceId, startTime,
          idempotencyKey: `loadtest-${suffix}-${i}`,
        }),
      })
    );
    const results = await Promise.all(attempts);
    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);

    console.log(`  distinct-key round: ${created.length} created, ${conflicted.length} rejected as 409 (of ${CONCURRENCY})`);
    if (created.length !== 1) throw new Error(`expected exactly 1 booking to win the race, got ${created.length}`);
    if (created.length + conflicted.length !== CONCURRENCY) throw new Error('some requests neither succeeded nor got a clean 409 — investigate');

    // Round 2: SAME idempotency key — every attempt should resolve to the one booking
    // (201 once, 200 replay for the rest), proving retried tool-calls can't double-book.
    const dupKey = `loadtest-dup-${suffix}`;
    const dupAttempts = Array.from({ length: CONCURRENCY }, (_, i) =>
      api('/api/bookings', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          customerName: 'dup-caller', phone: '+19999999999', serviceId, startTime: '2031-01-01T11:00:00.000Z',
          idempotencyKey: dupKey,
        }),
      })
    );
    const dupResults = await Promise.all(dupAttempts);
    const ids = new Set(dupResults.map((r) => r.body?.id).filter(Boolean));
    console.log(`  same-key round: ${dupResults.filter((r) => r.status === 201).length} created, ${dupResults.filter((r) => r.status === 200).length} replayed, ${ids.size} distinct booking id(s)`);
    if (ids.size !== 1) throw new Error(`idempotency key should have produced exactly 1 booking id, got ${ids.size}`);

    console.log('load test PASSED');
  } finally {
    const db = await getDb();
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('admins').deleteOne({ email });
    await db.collection('services').deleteMany({ business_id: businessId });
    await db.collection('bookings').deleteMany({ business_id: businessId });
    await db.collection('booking_slot_locks').deleteMany({ business_id: businessId });
    await client.close();
  }
}

main().catch((err) => {
  console.error('load test FAILED:', err);
  process.exitCode = 1;
});
