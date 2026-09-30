// ROADMAP.md §8 "Calls answered" / "Missed calls" — a call_logs row with a 'failed:'
// outcome (KG-07: Gemini unavailable, or MAX_CONCURRENT_CALLS busy) means the AI never
// got to help the caller, so it counts as missed, not answered.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { getAnalytics } from '../src/services/analyticsService.js';

describe('analytics: calls answered vs missed', { skip }, () => {
  let t, db;

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__analytics__' });
    const now = new Date();
    await db.collection('call_logs').insertMany([
      { _id: newId(), business_id: t.businessId, call_sid: 'a', phone: '+1', outcome: 'completed', booking_id: null, created_at: now, is_after_hours: false },
      { _id: newId(), business_id: t.businessId, call_sid: 'b', phone: '+1', outcome: 'failed: ai_unavailable', booking_id: null, created_at: now, is_after_hours: false },
      { _id: newId(), business_id: t.businessId, call_sid: 'c', phone: '+1', outcome: 'failed: lines_busy', booking_id: null, created_at: now, is_after_hours: false },
    ]);
  });
  after(() => dropTenants(t.businessId));

  it('missed counts only failed: outcomes; answered is the rest', async () => {
    const { calls } = await getAnalytics(t.businessId);
    assert.equal(calls.total, 3);
    assert.equal(calls.missed, 2);
    assert.equal(calls.answered, 1);
  });
});
