// Booking correctness and reminder fixes (docs/testing/TEST_CASES.md group BF):
// KG-05 replay of a cancelled booking, KG-14 slot-lock expiry, KG-15 time off over existing
// bookings, KG-13 reminder worker claiming. Real Mongo; time-off goes over real HTTP.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { createBooking, cancelBooking, rescheduleBooking } from '../src/services/bookingService.js';
import { backfillLockExpiry } from '../db/schema.js';
import { runReminderSweepOnce } from '../src/notifications/reminder-worker.js';

const at = (days, hh = 10) => new Date(Date.UTC(2032, 0, 1 + days, hh)).toISOString();

describe('booking and reminder fixes', { skip }, () => {
  let db;
  let t;
  let server;
  let base;
  let ownerToken;

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__fixes__', staff: ['Jessica'] });
    const adminId = newId();
    await db.collection('admins').insertOne({ _id: adminId, business_id: t.businessId, email: `o-${adminId}@example.test`, name: 'Owner', role: 'owner', status: 'active', password_hash: 'x' });
    ownerToken = jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('booking_slot_locks').deleteMany({ business_id: t.businessId });
    await db.collection('staff_time_off').deleteMany({ business_id: t.businessId });
    await db.collection('admins').deleteMany({ business_id: t.businessId });
    await dropTenants(t.businessId);
  });

  const book = (over = {}) => createBooking(t.businessId, {
    customerName: 'Sara', phone: '+15550700001', serviceId: t.serviceIds.haircut, staffId: t.staffIds.Jessica, startTime: at(1), ...over,
  });

  it('BF-01 replaying a key whose booking was cancelled books afresh instead of returning the cancelled one (KG-05)', async () => {
    const key = `key-${newId()}`;
    const first = await book({ idempotencyKey: key, startTime: at(2) });
    assert.equal((await book({ idempotencyKey: key, startTime: at(2) })).replayed, true, 'a live booking still replays');
    await cancelBooking(t.businessId, first.booking.id);
    const again = await book({ idempotencyKey: key, startTime: at(2) });
    assert.notEqual(again.booking.id, first.booking.id);
    assert.equal(again.booking.status, 'confirmed');
    assert.equal(again.replayed, false);
    assert.equal((await db.collection('bookings').findOne({ _id: first.booking.id })).idempotency_key, undefined, 'the cancelled booking let go of the key');
    assert.equal((await book({ idempotencyKey: key, startTime: at(2) })).booking.id, again.booking.id, 'and the new one replays normally');
  });

  it('BF-02 slot locks carry an expiry a day after the booking ends, and a TTL index removes them (KG-14)', async () => {
    const { booking } = await book({ startTime: at(3) });
    const locks = await db.collection('booking_slot_locks').find({ booking_id: booking.id }).toArray();
    assert.equal(locks.length, 6);
    const end = new Date(at(3, 10)).getTime() + 30 * 60_000;
    assert.ok(locks.every((l) => l.expires_at.getTime() === end + 24 * 60 * 60_000));
    const moved = await rescheduleBooking(t.businessId, booking.id, at(4));
    const after = await db.collection('booking_slot_locks').find({ booking_id: booking.id }).toArray();
    assert.ok(after.every((l) => l.expires_at.getTime() === new Date(moved.end_time).getTime() + 24 * 60 * 60_000), 'reschedule moves the expiry too');
    const idx = (await db.collection('booking_slot_locks').indexes()).find((i) => i.key.expires_at);
    assert.equal(idx.expireAfterSeconds, 0);
  });

  it('BF-03 backfill gives old locks an expiry and marks orphans for deletion', async () => {
    const { booking } = await book({ startTime: at(5) });
    await db.collection('booking_slot_locks').updateMany({ booking_id: booking.id }, { $unset: { expires_at: '' } });
    const orphanId = `${t.businessId}:orphan:${newId()}`;
    await db.collection('booking_slot_locks').insertOne({ _id: orphanId, business_id: t.businessId, booking_id: 'no-such-booking' });
    const touched = await backfillLockExpiry(db);
    assert.ok(touched >= 7);
    const fixed = await db.collection('booking_slot_locks').find({ booking_id: booking.id }).toArray();
    assert.ok(fixed.every((l) => l.expires_at > new Date()));
    assert.ok((await db.collection('booking_slot_locks').findOne({ _id: orphanId })).expires_at < new Date(), 'orphan is already expired, TTL sweeps it');
    assert.equal(await backfillLockExpiry(db), 0, 'idempotent');
  });

  const timeOff = (body) => fetch(`${base}/api/staff/${t.staffIds.Jessica}/time-off`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify(body),
  });

  it('BF-04 time off over an existing booking is refused with who is affected, unless forced (KG-15)', async () => {
    await book({ customerName: 'Booked Betty', phone: '+15550700009', startTime: at(10, 14) });
    const window = { startTime: at(10, 9), endTime: at(10, 17) };
    const refused = await timeOff(window);
    assert.equal(refused.status, 409);
    const body = await refused.json();
    assert.match(body.error, /1 confirmed booking overlap.*Booked Betty/);
    assert.equal(body.conflicts[0].customerName, 'Booked Betty');
    assert.equal(await db.collection('staff_time_off').countDocuments({ business_id: t.businessId }), 0, 'nothing saved');

    const forced = await timeOff({ ...window, force: true });
    assert.equal(forced.status, 201);
    assert.equal((await forced.json()).conflicts.length, 1);
    assert.equal(await db.collection('staff_time_off').countDocuments({ business_id: t.businessId }), 1);
  });

  it('BF-05 time off with no booking in the way, or only a cancelled one, is added straight away', async () => {
    assert.equal((await timeOff({ startTime: at(20, 9), endTime: at(20, 17) })).status, 201);
    const { booking } = await book({ startTime: at(21, 10) });
    await cancelBooking(t.businessId, booking.id);
    assert.equal((await timeOff({ startTime: at(21, 9), endTime: at(21, 17) })).status, 201);
    assert.equal((await timeOff({ startTime: at(22, 17), endTime: at(22, 9) })).status, 400, 'bad range still validated');
  });

  // ---- reminder worker ----
  // The due window is only 10 minutes wide, so each reminder booking needs its own staff member
  // (one person can't hold overlapping bookings).
  let spare = 0;
  const dueBooking = async (offsetMinutes, phone) => {
    const staffId = newId();
    await db.collection('staff').insertOne({ _id: staffId, business_id: t.businessId, name: `Spare ${spare++}` });
    const start = new Date(Date.now() + offsetMinutes * 60_000);
    start.setUTCSeconds(0, 0);
    const { booking } = await book({ phone, startTime: start.toISOString(), staffId });
    return booking.id;
  };

  it('BF-06 three overlapping sweeps send each reminder exactly once (KG-13)', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await dueBooking(24 * 60 - 3 - i, `+1555071000${i}`));
    const sent = [];
    const send = async (business, booking) => { sent.push(booking._id); await new Promise((r) => setTimeout(r, 30)); };
    await Promise.all([runReminderSweepOnce({ send, businessIds: [t.businessId] }), runReminderSweepOnce({ send, businessIds: [t.businessId] }), runReminderSweepOnce({ send, businessIds: [t.businessId] })]);
    for (const id of ids) assert.equal(sent.filter((s) => s === id).length, 1, `booking ${id} reminded once`);
    for (const id of ids) assert.ok((await db.collection('bookings').findOne({ _id: id })).reminder_24h_sent_at, 'marked as sent');
  });

  it('BF-07 a failed send gives the claim back so the next sweep retries', async () => {
    const id = await dueBooking(24 * 60 - 4, '+15550710010');
    await runReminderSweepOnce({ businessIds: [t.businessId], send: async (b, booking) => { if (booking._id === id) throw new Error('provider down'); } });
    assert.equal((await db.collection('bookings').findOne({ _id: id })).reminder_24h_sent_at, null, 'claim released');
    const sent = [];
    await runReminderSweepOnce({ businessIds: [t.businessId], send: async (b, booking) => { sent.push(booking._id); } });
    assert.ok(sent.includes(id));
  });
});
