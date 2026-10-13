// ROADMAP.md §8 "Calls answered" / "Missed calls" — a call_logs row with a 'failed:'
// outcome (KG-07: Gemini unavailable, or MAX_CONCURRENT_CALLS busy) means the AI never
// got to help the caller, so it counts as missed, not answered.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { DateTime } from 'luxon';
import { getAnalytics } from '../src/services/analyticsService.js';
import { getDashboardStats } from '../src/services/bookingService.js';

describe('analytics: calls answered vs missed', { skip }, () => {
  let t, db, tz;

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
  after(() => dropTenants(t.businessId, tz?.businessId));

  it('missed counts only failed: outcomes; answered is the rest', async () => {
    const { calls } = await getAnalytics(t.businessId);
    assert.equal(calls.total, 3);
    assert.equal(calls.missed, 2);
    assert.equal(calls.answered, 1);
  });

  // B-ENG-11: "today" is the business's calendar day. In Auckland 02:00 local is still yesterday in UTC, so a
  // server-time or UTC day would count it for the wrong date.
  it('days follow the business timezone', async () => {
    const zone = 'Pacific/Auckland';
    const localToday = DateTime.now().setZone(zone).startOf('day');
    tz = await createTenant({ name: '__analytics_tz__', timezone: zone });
    const start = localToday.plus({ hours: 2 });
    await db.collection('bookings').insertOne({
      _id: newId(), business_id: tz.businessId, customer_name: 'Tz', phone: '+15550009999', service_id: tz.serviceIds.haircut,
      status: 'confirmed', start_time: start.toJSDate(), end_time: start.plus({ minutes: 30 }).toJSDate(), is_test: false,
    });
    assert.equal((await getDashboardStats(tz.businessId)).todayCount, 1);
    const { daily } = await getAnalytics(tz.businessId);
    assert.equal(daily.at(-1).date, localToday.toISODate());
    assert.equal(daily.at(-1).confirmed, 1);
  });
});
