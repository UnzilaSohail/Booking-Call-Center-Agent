// Requires MONGODB_URI pointing at a migrated, replica-set-enabled deployment — skips
// cleanly if unset, same convention as test/booking.test.js.
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { client, getDb, newId } from '../src/db.js';
import { createBooking, getAvailability } from '../src/services/bookingService.js';

const skip = !process.env.MONGODB_URI && 'MONGODB_URI not set';

// Closed exactly once, after every test in this file has run — src/db.js's `client` is
// a module-level singleton shared by all four tests below; closing it inside any one
// test's own cleanup broke whichever tests ran after it, and never closing it at all
// leaves the process hanging on the driver's open connection.
after(async () => {
  if (!skip) await client.close();
});

test('minimum booking notice rejects a too-soon booking', { skip }, async () => {
  const db = await getDb();
  const businessId = newId();
  const serviceId = newId();
  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__', timezone: 'UTC', hours: [], min_booking_notice_minutes: 120 });
  await db.collection('services').insertOne({ _id: serviceId, business_id: businessId, name: 'haircut', duration_minutes: 30, buffer_minutes: 0 });

  try {
    const startTime = DateTime.utc().plus({ minutes: 30 }).toISO();
    await assert.rejects(
      createBooking(businessId, { customerName: 'a', phone: '123', serviceId, startTime, idempotencyKey: 'notice-test' }),
      (err) => err.status === 422
    );
  } finally {
    // Not closing the shared client here — src/db.js's `client` is a module-level
    // singleton other tests in this same process still need; closing it mid-run breaks
    // whatever runs after (this bit a first version of this file: two of these tests
    // closed it and broke the two after them). The process exiting cleans it up.
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('services').deleteOne({ _id: serviceId });
  }
});

test('maximum booking window rejects a too-far-out booking', { skip }, async () => {
  const db = await getDb();
  const businessId = newId();
  const serviceId = newId();
  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__', timezone: 'UTC', hours: [], max_booking_window_days: 7 });
  await db.collection('services').insertOne({ _id: serviceId, business_id: businessId, name: 'haircut', duration_minutes: 30, buffer_minutes: 0 });

  try {
    const startTime = DateTime.utc().plus({ days: 30 }).toISO();
    await assert.rejects(
      createBooking(businessId, { customerName: 'a', phone: '123', serviceId, startTime, idempotencyKey: 'window-test' }),
      (err) => err.status === 422
    );
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('services').deleteOne({ _id: serviceId });
  }
});

test('getAvailability returns no slots on a holiday', { skip }, async () => {
  const db = await getDb();
  const businessId = newId();
  const serviceId = newId();
  const holidayDate = '2030-01-01';
  const allDayHours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '00:00', close_time: '23:59' }));
  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__', timezone: 'UTC', hours: allDayHours, holidays: [{ date: holidayDate, name: 'New Year' }] });
  await db.collection('services').insertOne({ _id: serviceId, business_id: businessId, name: 'haircut', duration_minutes: 30, buffer_minutes: 0 });

  try {
    const { slots } = await getAvailability(businessId, { serviceId, date: holidayDate });
    assert.deepEqual(slots, []);
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('services').deleteOne({ _id: serviceId });
  }
});

test('getAvailability excludes a staff member\'s time off', { skip }, async () => {
  const db = await getDb();
  const businessId = newId();
  const serviceId = newId();
  const staffId = newId();
  const date = '2030-06-15'; // a Saturday, but hours cover every day of week here
  const allDayHours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '00:00', close_time: '23:59' }));
  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__', timezone: 'UTC', hours: allDayHours });
  await db.collection('services').insertOne({ _id: serviceId, business_id: businessId, name: 'haircut', duration_minutes: 30, buffer_minutes: 0 });
  await db.collection('staff').insertOne({ _id: staffId, business_id: businessId, name: 'Staffer', google_calendar_id: null });
  await db.collection('staff_time_off').insertOne({
    _id: newId(), business_id: businessId, staff_id: staffId,
    start_time: new Date(`${date}T00:00:00.000Z`), end_time: new Date(`${date}T23:59:00.000Z`),
    reason: 'vacation', created_at: new Date(),
  });

  try {
    const withoutStaff = await getAvailability(businessId, { serviceId, date });
    assert.ok(withoutStaff.slots.length > 0, 'the shared calendar should still show slots');

    const withStaff = await getAvailability(businessId, { serviceId, date, staffId });
    assert.deepEqual(withStaff.slots, []);
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('services').deleteOne({ _id: serviceId });
    await db.collection('staff').deleteOne({ _id: staffId });
    await db.collection('staff_time_off').deleteMany({ business_id: businessId });
  }
});
