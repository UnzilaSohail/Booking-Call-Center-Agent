// Calls a restart left 'in_progress' are closed; live and finished ones are not touched (Jira 54j).
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { closeStaleCalls } from '../src/services/staleCalls.js';

describe('stale in-progress calls', { skip }, () => {
  let db; let t;
  const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
  const call = (outcome, created_at) => ({ _id: newId(), business_id: t.businessId, call_sid: `CA${newId()}`, phone: '+15550900031', outcome, created_at });

  before(async () => { db = await getDb(); t = await createTenant({ name: '__stale__' }); });
  after(async () => { await db.collection('call_logs').deleteMany({ business_id: t.businessId }); await dropTenants(t.businessId); });

  it('SC-01 only a call stuck in progress for over 30 minutes is closed, as interrupted, without a duration', async () => {
    const stuck = call('in_progress', minutesAgo(120)); const live = call('in_progress', minutesAgo(2)); const done = call('completed', minutesAgo(120));
    await db.collection('call_logs').insertMany([stuck, live, done]);
    assert.ok(await closeStaleCalls() >= 1);
    const row = (c) => db.collection('call_logs').findOne({ _id: c._id });
    const closed = await row(stuck);
    assert.equal(closed.outcome, 'failed: interrupted');
    assert.ok(closed.ended_at);
    assert.equal(closed.duration_seconds, undefined);
    assert.equal((await row(live)).outcome, 'in_progress');
    assert.equal((await row(done)).outcome, 'completed');
  });
});
