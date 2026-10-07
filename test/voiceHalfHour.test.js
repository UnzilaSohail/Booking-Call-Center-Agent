// The voice agent's half-hour slot grid, the "that time is taken, here are free ones" answer, the caller's email and the
// English-only rule (commit 8e3d018). Group VH in docs/testing/TEST_CASES.md.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { getAvailability, createBooking } from '../src/services/bookingService.js';
import { createToolHandlers } from '../src/voice/tools.js';
import { formatSystemInstruction } from '../src/voice/geminiSession.js';

const DAY = '2030-04-10'; // a Wednesday, far enough ahead that nothing is "in the past"
const NY = 'America/New_York';
const minutesOfDay = (iso) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: NY, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
};

describe('voice: half-hour slots and free-time answers', { skip }, () => {
  let t;
  let db;
  const handlers = () => createToolHandlers(t.business, `call-${newId()}`);

  before(async () => {
    db = await getDb();
    t = await createTenant({
      name: '__voice_halfhour__', timezone: NY,
      services: [{ name: 'haircut', duration: 30, buffer: 0 }, { name: 'colour', duration: 60, buffer: 0 }],
      staff: ['Jessica'],
    });
    t.business.timezone = NY;
  });
  after(() => dropTenants(t.businessId));

  it('VH-01 a 30-minute service is offered every half hour across opening hours (09:00-18:00)', async () => {
    const { slots } = await getAvailability(t.businessId, { serviceId: t.serviceIds.haircut, date: DAY, staffId: t.staffIds.Jessica });
    const mins = slots.map(minutesOfDay);
    assert.equal(slots.length, 18, '9:00 to 17:30');
    assert.equal(mins[0], 9 * 60);
    assert.equal(mins.at(-1), 17 * 60 + 30);
    assert.ok(mins.every((m) => m % 30 === 0), 'every start is on :00 or :30');
  });

  it('VH-02 a 60-minute service still starts every half hour, and never runs past closing (VH-02)', async () => {
    const { slots } = await getAvailability(t.businessId, { serviceId: t.serviceIds.colour, date: DAY, staffId: t.staffIds.Jessica });
    const mins = slots.map(minutesOfDay);
    assert.equal(mins[0], 9 * 60);
    assert.equal(mins[1], 9 * 60 + 30, 'a 60-minute job may start at 9:30');
    assert.equal(mins.at(-1), 17 * 60, 'the last 60-minute start is 17:00 so it ends at 18:00');
  });

  it('VH-03 a booked 60-minute job hides every start it would overlap, and only those', async () => {
    await createBooking(t.businessId, { customerName: 'Blocker', phone: '+15550108801', serviceId: t.serviceIds.colour, staffId: t.staffIds.Jessica, startTime: `${DAY}T14:00:00.000Z` }); // 10:00 New York (EDT)
    const { slots } = await getAvailability(t.businessId, { serviceId: t.serviceIds.colour, date: DAY, staffId: t.staffIds.Jessica });
    const mins = slots.map(minutesOfDay);
    assert.ok(mins.includes(9 * 60), '9:00 ends at 10:00 exactly, so it is still free');
    assert.ok(!mins.includes(9 * 60 + 30), '9:30 would end at 10:30 and overlap');
    assert.ok(!mins.includes(10 * 60) && !mins.includes(10 * 60 + 30), '10:00 and 10:30 are inside the booking');
    assert.ok(mins.includes(11 * 60), '11:00 is free again');
  });

  it('VH-04 check_availability gives the agent the times in the business time zone, in the same order (VH-04)', async () => {
    const res = await handlers().check_availability({ serviceName: 'haircut', date: DAY, staffName: 'Jessica' });
    assert.equal(res.localTimes.length, res.slots.length);
    assert.equal(res.localTimes[0], '9:00 AM');
    assert.equal(res.localTimes[1], '9:30 AM');
    assert.equal(res.timezone, NY);
  });

  it('VH-05 a time that was just taken: the answer carries that day\'s free times, without the taken one', async () => {
    const taken = `${DAY}T15:00:00.000Z`; // 11:00 New York
    await createBooking(t.businessId, { customerName: 'First', phone: '+15550108802', serviceId: t.serviceIds.haircut, staffId: t.staffIds.Jessica, startTime: taken });
    const res = await handlers().create_booking({ serviceName: 'haircut', staffName: 'Jessica', startTime: taken, customerName: 'Late', phone: '+15550108803' });
    assert.equal(res.error, 'slot no longer available');
    assert.equal(res.date, DAY);
    assert.ok(res.freeSlots.length > 10, 'most of the day is still free');
    assert.ok(!res.freeSlots.includes(taken), 'the taken time is not offered again');
    assert.equal(res.freeLocalTimes.length, res.freeSlots.length);
    assert.ok(res.freeLocalTimes.includes('9:00 AM') && !res.freeLocalTimes.includes('11:00 AM'));
    assert.ok(await db.collection('failed_bookings').findOne({ business_id: t.businessId, phone: '+15550108803' }), 'the lost booking is still logged for staff');
  });

  it('VH-06 a time outside opening hours is refused with that day\'s free times, and books nothing', async () => {
    const before = await db.collection('bookings').countDocuments({ business_id: t.businessId });
    const res = await handlers().create_booking({ serviceName: 'haircut', staffName: 'Jessica', startTime: `${DAY}T07:00:00.000Z`, customerName: 'Early', phone: '+15550108804' }); // 03:00 New York
    assert.equal(res.error, 'that time is not available');
    assert.ok(res.freeSlots.length > 0 && res.freeLocalTimes[0] === '9:00 AM');
    assert.equal(await db.collection('bookings').countDocuments({ business_id: t.businessId }), before);
  });

  it('VH-07 the email the caller spells out is saved on the booking and on the customer', async () => {
    const res = await handlers().create_booking({ serviceName: 'haircut', staffName: 'Jessica', startTime: `${DAY}T17:00:00.000Z`, customerName: 'Emma Voice', phone: '+15550108805', customerEmail: 'emma.voice@example.test' });
    assert.ok(res.bookingId, JSON.stringify(res));
    const booking = await db.collection('bookings').findOne({ _id: res.bookingId });
    assert.equal(booking.customer_email, 'emma.voice@example.test');
    let customer = null;
    for (let i = 0; i < 30 && !customer?.email; i++) { customer = await db.collection('customers').findOne({ business_id: t.businessId, phone: '+15550108805' }); if (!customer?.email) await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(customer?.email, 'emma.voice@example.test');
  });

  it('VH-08 the English-only rule leads the agent\'s instructions and says what to do for other languages', () => {
    const text = formatSystemInstruction(t.business, [{ name: 'haircut', duration_minutes: 30, price: 40 }], [{ name: 'Jessica' }]);
    assert.ok(text.startsWith('HARD RULE'), 'first thing the model reads');
    assert.match(text, /ONLY English/);
    assert.match(text, /transfer_to_human|transfer/i, 'offers a person when the caller cannot use English');
    assert.match(text, /check_availability/, 'told to look up times before offering any');
    assert.match(text, /email/i, 'told to ask for the email');
  });
});
