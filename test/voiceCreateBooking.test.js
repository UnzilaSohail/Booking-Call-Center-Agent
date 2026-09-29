// The voice agent's booking tools, exercised directly (no Gemini) — docs/testing/TEST_CASES.md
// group VB. VB-05 is a regression for the 2026-09-29 production incident: a business with no
// hours saved never offers a slot, so every caller ended up in "callback requested".
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { createBooking } from '../src/services/bookingService.js';
import { createToolHandlers } from '../src/voice/tools.js';

const at = (day, hh, mm = '00') => `2030-04-${String(day).padStart(2, '0')}T${hh}:${mm}:00.000Z`;

describe('voice booking tools', { skip }, () => {
  let t;
  let noHours;
  let db;
  const voice = () => createToolHandlers(t.business, `call-${newId()}`);

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__voice__', services: [{ name: 'haircut', duration: 30, buffer: 0 }] });
    noHours = await createTenant({ name: '__voice_nohours__', hours: [] });
  });
  after(() => dropTenants(t.businessId, noHours.businessId));

  it('VB-01 a booking that loses the slot is logged in failed_bookings and the agent gets a sentence to speak', async () => {
    const startTime = at(1, '14');
    await createBooking(t.businessId, { customerName: 'First', phone: '+15550100001', serviceId: t.serviceIds.haircut, staffId: t.staffIds.Jessica, startTime });
    const res = await voice().create_booking({ serviceName: 'haircut', staffName: 'Jessica', startTime, customerName: 'Second', phone: '+15550100002' });
    assert.equal(res.error, 'slot no longer available');
    const failed = await db.collection('failed_bookings').findOne({ business_id: t.businessId, phone: '+15550100002' });
    assert.equal(failed.status, 'open');
    assert.equal(failed.error_message, 'slot no longer available');
  });

  it('VB-02 the same tool call retried inside one call returns the same booking', async () => {
    const handlers = voice();
    const args = { serviceName: 'haircut', staffName: 'Sam', startTime: at(2, '14'), customerName: 'Retry', phone: '+15550100003' };
    const [a, b] = [await handlers.create_booking(args), await handlers.create_booking(args)];
    assert.ok(a.bookingId);
    assert.equal(a.bookingId, b.bookingId);
    assert.equal(await db.collection('bookings').countDocuments({ business_id: t.businessId, phone: '+15550100003' }), 1);
  });

  it('VB-03 an unknown service name returns an error instead of booking something else', async () => {
    const res = await voice().create_booking({ serviceName: 'rocket surgery', startTime: at(3, '14'), customerName: 'X', phone: '+15550100004' });
    assert.match(res.error, /no service found/);
  });

  it('VB-04 rescheduling into a taken slot returns an error and keeps the original booking', async () => {
    await createBooking(t.businessId, { customerName: 'A', phone: '+15550100005', serviceId: t.serviceIds.haircut, staffId: t.staffIds.Jessica, startTime: at(4, '14') });
    const mine = await createBooking(t.businessId, { customerName: 'B', phone: '+15550100006', serviceId: t.serviceIds.haircut, staffId: t.staffIds.Jessica, startTime: at(4, '16') });
    const res = await voice().reschedule_booking({ bookingId: mine.booking.id, newStartTime: at(4, '14') });
    assert.equal(res.error, 'new slot no longer available');
    assert.equal((await db.collection('bookings').findOne({ _id: mine.booking.id })).start_time.toISOString(), at(4, '16'));
  });

  it('VB-05 a business with no hours saved offers no slots (production incident 2026-09-29)', async () => {
    const handlers = createToolHandlers(noHours.business, `call-${newId()}`);
    const res = await handlers.check_availability({ serviceName: 'haircut', date: '2030-04-10' });
    assert.deepEqual(res.slots, []);
  });

  it('VB-06 a slot returned by check_availability can be booked by voice', async () => {
    const handlers = voice();
    const { slots } = await handlers.check_availability({ serviceName: 'haircut', date: '2030-04-11', staffName: 'Jessica' });
    assert.ok(slots.length > 0);
    const res = await handlers.create_booking({ serviceName: 'haircut', staffName: 'Jessica', startTime: slots[0], customerName: 'Slot', phone: '+15550100007' });
    assert.ok(res.bookingId);
  });

  it('VB-07 booking at a time outside opening hours is refused', { todo: 'KG-02: createBooking/voice do not re-check hours (fix under Jira 28b)' }, async () => {
    const res = await voice().create_booking({ serviceName: 'haircut', staffName: 'Jessica', startTime: at(12, '23'), customerName: 'Late', phone: '+15550100008' });
    assert.ok(res.error, 'a 23:00 booking must be rejected when the business closes at 18:00');
  });

  it('VB-08 a misheard staff name is an error, not a silent booking with nobody assigned', { todo: 'KG-04: resolveStaffId returns null on no match (fix under Jira 28a)' }, async () => {
    const res = await voice().create_booking({ serviceName: 'haircut', staffName: 'Zzzyx', startTime: at(13, '14'), customerName: 'Who', phone: '+15550100009' });
    assert.ok(res.error, 'unknown staff name must not create a booking');
  });
});
