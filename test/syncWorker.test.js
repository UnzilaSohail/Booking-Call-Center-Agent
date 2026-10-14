// Calendar sync (AIN-505): a failed push waits longer each time and only becomes 'failed' (an Exceptions
// item) once every attempt is used; a booking whose retry time has not come is left alone.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { runSyncOnce, backoffMs } from '../src/calendar/sync-worker.js';

describe('calendar sync retries', { skip }, () => {
  let t, db;
  const failing = { createEvent: async () => { throw new Error('google down'); }, updateEvent: async () => {}, deleteEvent: async () => {} };
  const row = (extra) => ({
    _id: newId(), business_id: t.businessId, customer_name: 'Sync', phone: '+15550007777', service_id: t.serviceIds.haircut, staff_id: null,
    status: 'confirmed', start_time: new Date(Date.now() + 86_400_000), end_time: new Date(Date.now() + 88_000_000),
    is_test: false, created_at: new Date(), google_event_id: null, sync_status: 'pending', sync_attempts: 0, ...extra,
  });
  const run = () => runSyncOnce({ calendar: failing, businessIds: [t.businessId] });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__sync__' });
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { google_refresh_token: 'x' } });
  });
  after(() => dropTenants(t.businessId));

  it('backoff grows and is capped at 30 minutes', () => {
    assert.deepEqual([1, 2, 3].map(backoffMs), [30_000, 60_000, 120_000]);
    assert.equal(backoffMs(9), 30 * 60_000);
  });

  it('a failure stays pending with a later retry time; the last attempt becomes failed', async () => {
    const first = row({}), last = row({ sync_attempts: 9 });
    await db.collection('bookings').insertMany([first, last]);
    await run();
    const a = await db.collection('bookings').findOne({ _id: first._id });
    assert.equal(a.sync_status, 'pending');
    assert.equal(a.sync_attempts, 1);
    assert.ok(a.next_retry_at > new Date(), 'not tried again straight away');
    const b = await db.collection('bookings').findOne({ _id: last._id });
    assert.equal(b.sync_status, 'failed');
    assert.equal(b.sync_attempts, 10);
  });

  it('a booking waiting for its retry time is skipped, and one whose time has come is tried', async () => {
    const waiting = row({ next_retry_at: new Date(Date.now() + 600_000) }), due = row({ next_retry_at: new Date(Date.now() - 1000) });
    await db.collection('bookings').insertMany([waiting, due]);
    await run();
    assert.equal((await db.collection('bookings').findOne({ _id: waiting._id })).sync_attempts, 0);
    assert.equal((await db.collection('bookings').findOne({ _id: due._id })).sync_attempts, 1);
  });
});
