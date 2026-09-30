// Race-condition and overlap cases for booking (docs/testing/TEST_CASES.md, group RC).
// Headline case RC-01: a caller books 2pm through the voice agent at the same moment staff
// book the same 2pm slot from the dashboard — exactly one may win, the loser must fail
// cleanly (and a voice loser must be logged in failed_bookings).
// Cases marked `todo` describe a known gap (see docs/testing/KNOWN_GAPS.md): they run and
// report, but do not fail the suite until the gap is fixed.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { createBooking, rescheduleBooking, cancelBooking, getAvailability, listBookings, BookingError } from '../src/services/bookingService.js';
import { createToolHandlers } from '../src/voice/tools.js';

const atMonth = (month, day, hh, mm = '00') => `2030-${month}-${String(day).padStart(2, '0')}T${hh}:${mm}:00.000Z`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (day, hh, mm = '00') => atMonth('02', day, hh, mm); // each test owns its own day so tests never collide

describe('booking race conditions', { skip }, () => {
  let t; // tenant A
  let t2; // tenant B
  let db;

  before(async () => {
    db = await getDb();
    t = await createTenant({
      name: '__race_a__',
      services: [
        { name: 'haircut', duration: 30, buffer: 0 },
        { name: 'massage', duration: 60, buffer: 0 },
        { name: 'colour', duration: 30, buffer: 15 },
      ],
    });
    t2 = await createTenant({ name: '__race_b__' });
  });
  after(() => dropTenants(t.businessId, t2.businessId));

  const book = (startTime, { staff = 'Jessica', service = 'haircut', phone = '+15550000001', key, tenant = t } = {}) =>
    createBooking(tenant.businessId, {
      customerName: 'Test', phone, serviceId: tenant.serviceIds[service],
      staffId: staff ? tenant.staffIds[staff] : null, startTime, idempotencyKey: key, createdVia: 'dashboard',
    });

  const confirmedAt = (startTime, staff = 'Jessica') =>
    db.collection('bookings').countDocuments({ business_id: t.businessId, staff_id: staff ? t.staffIds[staff] : null, status: 'confirmed', start_time: new Date(startTime) });
  const lockCount = (bookingId) => db.collection('booking_slot_locks').countDocuments({ booking_id: bookingId });
  const rejected409 = (r) => r.status === 'rejected' && r.reason instanceof BookingError && r.reason.status === 409;

  it('RC-01 call vs manual booking on the same 2pm slot: exactly one wins (20 rounds, random arrival order)', async () => {
    const tally = { voice: 0, manual: 0 };
    for (let i = 0; i < 20; i++) {
      const startTime = atMonth('06', 1 + i, '14');
      const voice = createToolHandlers(t.business, `call-${newId()}`);
      const [v, m] = await Promise.allSettled([
        voice.create_booking({ serviceName: 'haircut', staffName: 'Jessica', startTime, customerName: 'Caller', phone: '+15550000101' }),
        sleep(i % 2 ? 0 : Math.floor(Math.random() * 8)).then(() => book(startTime, { phone: '+15550000102' })),
      ]);
      const voiceWon = v.status === 'fulfilled' && Boolean(v.value.bookingId);
      const manualWon = m.status === 'fulfilled';
      assert.equal(Number(voiceWon) + Number(manualWon), 1, `round ${i}: exactly one of voice/manual must win`);
      assert.equal(await confirmedAt(startTime), 1, `round ${i}: exactly one confirmed booking on the slot`);

      if (voiceWon) {
        tally.voice++;
        assert.ok(rejected409(m), 'manual loser gets a 409 slot conflict');
      } else {
        tally.manual++;
        assert.equal(v.value.error, 'slot no longer available', 'voice loser gets the conflict message to speak');
        const failed = await db.collection('failed_bookings').findOne({ business_id: t.businessId, requested_start_time: new Date(startTime) });
        assert.ok(failed, 'voice loser is logged in failed_bookings for staff follow-up');
        assert.equal(failed.status, 'open');
      }
    }
    console.log(`    RC-01 tally over 20 rounds: voice won ${tally.voice}, manual won ${tally.manual}`);
  });

  it('RC-02 20 simultaneous requests for one slot: one 201, nineteen 409, locks belong to the winner only', async () => {
    const startTime = at(5, '14');
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => book(startTime, { phone: `+1555000${1000 + i}`, key: `rc02-${i}` })));
    const winners = results.filter((r) => r.status === 'fulfilled');
    assert.equal(winners.length, 1);
    assert.equal(results.filter(rejected409).length, 19);
    assert.equal(await lockCount(winners[0].value.booking.id), 6, '30 min = six 5-minute slot locks');
    assert.equal(await db.collection('booking_slot_locks').countDocuments({ business_id: t.businessId, _id: { $regex: `:${new Date(startTime).toISOString()}$` } }), 1);
  });

  it('RC-03 different staff at the same time do not block each other', async () => {
    const startTime = at(6, '14');
    const results = await Promise.allSettled([book(startTime, { staff: 'Jessica' }), book(startTime, { staff: 'Sam' })]);
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
  });

  it('RC-04 overlapping ranges (14:00-15:00 massage vs 14:30 haircut, and 13:45 haircut) collide', async () => {
    for (const [day, other] of [[7, '30'], [8, '45']]) {
      const hour = other === '30' ? '14' : '13';
      const results = await Promise.allSettled([
        book(at(day, '14'), { service: 'massage', phone: '+15550000401' }),
        book(at(day, hour, other), { service: 'haircut', phone: '+15550000402' }),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, `day ${day}: exactly one overlapping booking wins`);
      assert.equal(results.filter(rejected409).length, 1);
    }
  });

  it('RC-05 back-to-back bookings (14:00-14:30 and 14:30-15:00) both succeed', async () => {
    const results = await Promise.allSettled([book(at(9, '14', '00')), book(at(9, '14', '30'))]);
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
  });

  it('RC-06 buffer time is enforced: colour 14:00 (+15 min buffer) blocks 14:30 but not 14:45', async () => {
    await book(at(11, '14'), { service: 'colour' });
    await assert.rejects(book(at(11, '14', '30')), (e) => e.status === 409);
    await book(at(11, '14', '45'));
  });

  it('RC-07 start times off the 5-minute grid still collide (14:02 vs 14:00)', async () => {
    await book(at(12, '14', '00'));
    await assert.rejects(book(at(12, '14', '02')), (e) => e.status === 409);
  });

  it('RC-08a cancelling frees the slot and someone else can rebook it', async () => {
    const startTime = at(13, '14');
    const a = await book(startTime);
    await cancelBooking(t.businessId, a.booking.id);
    assert.equal(await lockCount(a.booking.id), 0, 'cancel releases every lock');
    const b = await book(startTime, { phone: '+15550000802' });
    assert.equal(await lockCount(b.booking.id), 6);
  });

  it('RC-08b cancel racing a new booking on the same slot always ends consistent', async () => {
    const startTime = at(14, '14');
    const a = await book(startTime);
    await Promise.allSettled([cancelBooking(t.businessId, a.booking.id), book(startTime, { phone: '+15550000803' })]);
    const confirmed = await confirmedAt(startTime);
    assert.ok(confirmed <= 1, 'never two confirmed bookings on one slot');
    const locks = await db.collection('booking_slot_locks').countDocuments({ business_id: t.businessId, _id: { $regex: `:${startTime}$` } });
    assert.equal(locks, confirmed, 'a slot is locked exactly when it holds a confirmed booking');
  });

  it('RC-09 rescheduling into a taken slot fails with 409 and keeps the original slot', async () => {
    await book(at(15, '14'));
    const b = await book(at(15, '15'), { phone: '+15550000902' });
    await assert.rejects(rescheduleBooking(t.businessId, b.booking.id, at(15, '14')), (e) => e.status === 409);
    const stored = await db.collection('bookings').findOne({ _id: b.booking.id });
    assert.equal(stored.start_time.toISOString(), at(15, '15'));
    assert.equal(await lockCount(b.booking.id), 6, 'original locks restored by the aborted transaction');
    await assert.rejects(book(at(15, '15'), { phone: '+15550000903' }), (e) => e.status === 409);
  });

  it('RC-10 two bookings rescheduled into the same free slot: one wins, the loser keeps its own slot', async () => {
    const b = await book(at(16, '15'), { phone: '+15550001001' });
    const c = await book(at(16, '16'), { phone: '+15550001002' });
    const results = await Promise.allSettled([
      rescheduleBooking(t.businessId, b.booking.id, at(16, '17')),
      rescheduleBooking(t.businessId, c.booking.id, at(16, '17')),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(rejected409).length, 1);
    const loserOriginal = results[0].status === 'rejected' ? at(16, '15') : at(16, '16');
    await assert.rejects(book(loserOriginal, { phone: '+15550001003' }), (e) => e.status === 409);
  });

  it('RC-11 ten retries with the same idempotency key produce one booking', async () => {
    const startTime = at(17, '14');
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => book(startTime, { key: 'rc11-same-key' })));
    assert.ok(results.every((r) => r.status === 'fulfilled'), 'retries are answered, not rejected');
    assert.equal(new Set(results.map((r) => r.value.booking.id)).size, 1, 'all retries return the same booking');
    assert.equal(results.filter((r) => !r.value.replayed).length, 1, 'exactly one real insert');
    assert.equal(await db.collection('bookings').countDocuments({ business_id: t.businessId, idempotency_key: 'rc11-same-key' }), 1);
  });

  it('RC-12 two businesses booking the same time and staff name never interfere', async () => {
    const startTime = at(18, '14');
    const [a, b] = await Promise.all([book(startTime), book(startTime, { tenant: t2, phone: '+15550001201' })]);
    assert.notEqual(a.booking.id, b.booking.id);
    const listA = await listBookings(t.businessId, { from: at(18, '00'), to: at(18, '23') });
    assert.deepEqual(listA.map((x) => x.id), [a.booking.id], 'tenant A sees only its own booking');
  });

  it('RC-13 [known limitation] bookings with no staff and with a named staff do not block each other', async () => {
    const startTime = at(19, '14');
    const noStaff = await Promise.allSettled([book(startTime, { staff: null }), book(startTime, { staff: null, phone: '+15550001302' })]);
    assert.equal(noStaff.filter((r) => r.status === 'fulfilled').length, 1, 'two no-staff bookings still collide');
    await book(startTime, { staff: 'Jessica' }); // documented behaviour (KG-03): separate lock namespace
  });

  it('RC-14 a cancelled booking cannot be rescheduled', async () => {
    const a = await book(at(20, '14'));
    await cancelBooking(t.businessId, a.booking.id);
    await assert.rejects(rescheduleBooking(t.businessId, a.booking.id, at(20, '16')));
  });

  it('RC-15 availability reflects a booking immediately and again after cancel', async () => {
    const date = '2030-02-21';
    const slot = at(21, '14');
    const ask = () => getAvailability(t.businessId, { serviceId: t.serviceIds.haircut, date, staffId: t.staffIds.Jessica });
    assert.ok((await ask()).slots.includes(slot));
    const a = await book(slot);
    assert.ok(!(await ask()).slots.includes(slot));
    await cancelBooking(t.businessId, a.booking.id);
    assert.ok((await ask()).slots.includes(slot));
  });

  it('RC-16 60 parallel bookings on distinct slots all succeed (no false conflicts under load)', async () => {
    const base = new Date('2030-03-01T00:00:00.000Z').getTime();
    const started = Date.now();
    const results = await Promise.allSettled(Array.from({ length: 60 }, (_, i) =>
      book(new Date(base + i * 30 * 60_000).toISOString(), { staff: 'Sam', phone: `+1555002${String(i).padStart(4, '0')}` })));
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(failed.length, 0, `unexpected failures: ${failed.map((f) => f.reason?.message).join(', ')}`);
    console.log(`    RC-16: 60 concurrent bookings took ${Date.now() - started} ms`);
  });
});
