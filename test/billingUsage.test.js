// Requires MONGODB_URI pointing at a migrated, replica-set-enabled deployment — skips
// cleanly if unset, same convention as test/booking.test.js.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, getDb, newId, withTenant } from '../src/db.js';
import { computeUsage } from '../src/services/billingService.js';

test('computeUsage sums only call/sms activity inside the given period window', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  await db.collection('businesses').insertOne({ _id: businessId, name: '__billing_usage_test__', timezone: 'UTC' });

  const periodStart = new Date('2026-03-01T00:00:00.000Z');
  const periodEnd = new Date('2026-04-01T00:00:00.000Z');

  try {
    await withTenant(businessId, (c) => Promise.all([
      // Inside the window: 120s + 180s = 300s = 5 minutes.
      c('call_logs').insertOne({ _id: newId(), call_sid: `CA-in-${newId()}`, phone: '+1', outcome: 'completed', duration_seconds: 120, created_at: new Date('2026-03-10T00:00:00.000Z') }),
      c('call_logs').insertOne({ _id: newId(), call_sid: `CA-in2-${newId()}`, phone: '+1', outcome: 'completed', duration_seconds: 180, created_at: new Date('2026-03-20T00:00:00.000Z') }),
      // Outside the window (before/after) — must not count.
      c('call_logs').insertOne({ _id: newId(), call_sid: `CA-before-${newId()}`, phone: '+1', outcome: 'completed', duration_seconds: 600, created_at: new Date('2026-02-15T00:00:00.000Z') }),
      c('call_logs').insertOne({ _id: newId(), call_sid: `CA-after-${newId()}`, phone: '+1', outcome: 'completed', duration_seconds: 600, created_at: new Date('2026-04-15T00:00:00.000Z') }),
      // A call still in progress (no duration_seconds yet) must not blow up the sum.
      c('call_logs').insertOne({ _id: newId(), call_sid: `CA-live-${newId()}`, phone: '+1', outcome: 'in_progress', created_at: new Date('2026-03-15T00:00:00.000Z') }),
      // SMS: 3 inside the window, 1 outside.
      c('sms_sends').insertOne({ _id: newId(), sid: 'SM1', sent_at: new Date('2026-03-05T00:00:00.000Z') }),
      c('sms_sends').insertOne({ _id: newId(), sid: 'SM2', sent_at: new Date('2026-03-06T00:00:00.000Z') }),
      c('sms_sends').insertOne({ _id: newId(), sid: 'SM3', sent_at: new Date('2026-03-07T00:00:00.000Z') }),
      c('sms_sends').insertOne({ _id: newId(), sid: 'SM-outside', sent_at: new Date('2026-04-05T00:00:00.000Z') }),
    ]));

    const usage = await computeUsage(businessId, periodStart, periodEnd);
    assert.equal(usage.voiceMinutes, 5);
    assert.equal(usage.smsCount, 3);
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await Promise.all([
      db.collection('call_logs').deleteMany({ business_id: businessId }),
      db.collection('sms_sends').deleteMany({ business_id: businessId }),
    ]);
    await client.close();
  }
});
