// Shared booking logic used by both the REST API (src/routes/bookings.js) and the voice
// agent's tool calls (src/voice/tools.js), so the two entry points plan.md describes as
// needing "same source of truth" can never drift apart.
import { DateTime } from 'luxon';
import { client, getDb, withTenant, newId, serialize, serializeAll } from '../db.js';
import { busyIntervals } from '../calendar/google.js';

export class BookingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// businesses isn't tenant-scoped data, it IS the tenant — looked up directly by id or
// phone number, same as before Mongo (it had no RLS policy in the Postgres version either).
async function businessesCollection() {
  return (await getDb()).collection('businesses');
}

export async function getBusiness(businessId) {
  const business = await (await businessesCollection()).findOne({ _id: businessId });
  if (!business) throw new BookingError(404, 'business not found');
  return serialize(business);
}

export async function findBusinessByPhoneNumber(phoneNumber) {
  const business = await (await businessesCollection()).findOne({ phone_number: phoneNumber });
  return business ? serialize(business) : null;
}

export async function getAvailability(businessId, { serviceId, date, staffId, excludeBookingId }) {
  const business = await getBusiness(businessId);
  const zone = business.timezone;

  const service = await withTenant(businessId, (col) => col('services').findOne({ _id: serviceId }));
  if (!service) throw new BookingError(404, 'service not found');

  // Slot length includes the buffer, so back-to-back slots always leave changeover
  // room and the slot-lock collision guard (see createBooking below) enforces it.
  const slotMinutes = service.duration_minutes + service.buffer_minutes;

  const dayStart = DateTime.fromISO(date, { zone }).startOf('day');
  if (!dayStart.isValid) throw new BookingError(400, 'invalid date');
  const dow = dayStart.weekday % 7; // luxon: 1=Mon..7=Sun -> 0=Sun..6=Sat

  const hours = (business.hours ?? []).find((h) => h.day_of_week === dow);
  if (!hours) return { slots: [], durationMinutes: service.duration_minutes, bufferMinutes: service.buffer_minutes }; // closed that day

  const [openH, openM] = hours.open_time.split(':').map(Number);
  const [closeH, closeM] = hours.close_time.split(':').map(Number);
  const open = dayStart.set({ hour: openH, minute: openM });
  const close = dayStart.set({ hour: closeH, minute: closeM });

  // excludeBookingId: when checking availability for rescheduling a booking, that
  // booking's own current slot must not count as "busy" against itself — otherwise
  // its own time would wrongly look unavailable (worst case, a fully-booked day would
  // show zero options even though the booking's own slot is trivially free for it).
  const existing = await withTenant(businessId, (col) =>
    col('bookings')
      .find({
        status: 'confirmed',
        start_time: { $lt: close.toUTC().toJSDate() },
        end_time: { $gt: open.toUTC().toJSDate() },
        ...(staffId ? { staff_id: staffId } : {}),
        ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
      })
      .toArray()
  );

  // Cross-check Google Calendar too, so a manually-added personal event the DB doesn't
  // know about isn't double-booked (plan.md §6). A Calendar API failure must never
  // block booking — this only ever widens what counts as "busy," never narrows it.
  let calendarBusy = [];
  try {
    let calendarId = business.google_calendar_id;
    if (staffId) {
      const staff = await withTenant(businessId, (col) => col('staff').findOne({ _id: staffId }));
      if (staff?.google_calendar_id) calendarId = staff.google_calendar_id;
    }
    calendarBusy = await busyIntervals(business, calendarId, open.toUTC().toISO(), close.toUTC().toISO());
  } catch (err) {
    console.error('freebusy check failed, falling back to DB-only availability:', err.message);
  }

  const busyRanges = [
    ...existing.map((b) => ({ start: DateTime.fromJSDate(b.start_time), end: DateTime.fromJSDate(b.end_time) })),
    ...calendarBusy.map((b) => ({ start: DateTime.fromISO(b.start), end: DateTime.fromISO(b.end) })),
  ];

  const slots = [];
  for (let start = open; start.plus({ minutes: slotMinutes }) <= close; start = start.plus({ minutes: slotMinutes })) {
    const end = start.plus({ minutes: slotMinutes });
    const overlaps = busyRanges.some((b) => start.toUTC() < b.end && end.toUTC() > b.start);
    if (!overlaps) slots.push(start.toUTC().toISO());
  }

  return { slots, durationMinutes: service.duration_minutes, bufferMinutes: service.buffer_minutes };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// q: free-text search over customer name/phone — the "customer calls asking about their
// appointment" lookup, separate from the calendar's date-range view.
export async function listBookings(businessId, { from, to, q, status } = {}) {
  const filter = { start_time: { $gte: from ? new Date(from) : new Date(0), $lte: to ? new Date(to) : new Date('2100-01-01') } };
  if (status) filter.status = status;
  if (q) {
    const pattern = escapeRegex(q);
    filter.$or = [{ customer_name: { $regex: pattern, $options: 'i' } }, { phone: { $regex: pattern, $options: 'i' } }];
  }

  const bookings = await withTenant(businessId, (col) =>
    col('bookings').find(filter).sort({ start_time: -1 }).limit(500).toArray()
  );

  const serviceIds = [...new Set(bookings.map((b) => b.service_id))];
  const services = await withTenant(businessId, (col) => col('services').find({ _id: { $in: serviceIds } }).toArray());
  const nameById = Object.fromEntries(services.map((s) => [s._id, s.name]));

  return serializeAll(bookings).map((b) => ({ ...b, service_name: nameById[b.service_id] ?? null }));
}

const SLOT_GRANULARITY_MINUTES = 5;

// The actual "no two overlapping bookings" guarantee (plan.md §4/§6), replacing
// Postgres's EXCLUDE USING gist (see db/schema.js for the full rationale). A booking's
// [start, end) range is decomposed into fixed 5-minute slot documents whose _id is
// deterministic — two concurrent bookings that touch the same slot collide on that _id,
// and Mongo's default unique _id index lets exactly one insert win.
function slotLockIds(businessId, staffId, startDate, endDate) {
  const ids = [];
  const staffKey = staffId || 'none';
  for (let t = startDate.getTime(); t < endDate.getTime(); t += SLOT_GRANULARITY_MINUTES * 60_000) {
    ids.push(`${businessId}:${staffKey}:${new Date(t).toISOString()}`);
  }
  return ids;
}

export async function createBooking(businessId, { customerName, phone, customerEmail, serviceId, staffId, startTime, idempotencyKey, createdVia }) {
  if (!customerName || !phone || !serviceId || !startTime) {
    throw new BookingError(400, 'customerName, phone, serviceId and startTime are required');
  }

  const service = await withTenant(businessId, (col) => col('services').findOne({ _id: serviceId }));
  if (!service) throw new BookingError(404, 'service not found');

  const start = DateTime.fromISO(startTime, { zone: 'utc' });
  if (!start.isValid) throw new BookingError(400, 'invalid startTime');
  const end = start.plus({ minutes: service.duration_minutes + service.buffer_minutes });
  if (end <= start) throw new BookingError(400, 'service has a non-positive duration — fix its durationMinutes/bufferMinutes');
  const startDate = start.toJSDate();
  const endDate = end.toJSDate();

  // Idempotent replay (plan.md §5): a retried tool-call with the same key returns the
  // booking it already made instead of re-attempting to lock a slot.
  if (idempotencyKey) {
    const existing = await withTenant(businessId, (col) => col('bookings').findOne({ idempotency_key: idempotencyKey }));
    if (existing) return { booking: serialize(existing), service, replayed: true };
  }

  const bookingId = newId();
  const bookingDoc = {
    _id: bookingId,
    business_id: businessId,
    customer_name: customerName,
    phone,
    customer_email: customerEmail || null,
    service_id: serviceId,
    staff_id: staffId || null,
    start_time: startDate,
    end_time: endDate,
    status: 'confirmed',
    google_event_id: null,
    created_via: createdVia || 'dashboard',
    created_at: new Date(),
    sync_status: 'pending',
    sync_attempts: 0,
    sync_error: null,
    confirmation_sent_at: null,
    reminder_24h_sent_at: null,
    reminder_1h_sent_at: null,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}), // omitted entirely when absent, matching the partial unique index (db/schema.js)
  };

  const db = await getDb();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      // Locks inserted first: if any slot in the range is already taken, this throws
      // (duplicate key on _id) before the booking document itself is ever written.
      await db.collection('booking_slot_locks').insertMany(
        slotLockIds(businessId, staffId, startDate, endDate).map((id) => ({ _id: id, business_id: businessId, booking_id: bookingId })),
        { session, ordered: true }
      );
      await db.collection('bookings').insertOne(bookingDoc, { session });
    });
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate key: either a genuine slot collision, or — in a rare race — two
      // requests carrying the same idempotency key both passed the replay check above.
      if (idempotencyKey) {
        const existing = await withTenant(businessId, (col) => col('bookings').findOne({ idempotency_key: idempotencyKey }));
        if (existing) return { booking: serialize(existing), service, replayed: true };
      }
      throw new BookingError(409, 'slot no longer available');
    }
    throw err;
  } finally {
    await session.endSession();
  }

  return { booking: serialize(bookingDoc), service, replayed: false };
}

// Business rule from plan.md §6: how close to start_time a call-in change is still
// allowed. Only enforced for call-originated changes — the dashboard admin can always
// override (they're a human looking at the calendar, not relying on a spoken confirm).
export function assertWithinChangeCutoff(business, booking) {
  const minutesUntilStart = DateTime.fromJSDate(new Date(booking.start_time)).diffNow('minutes').minutes;
  if (minutesUntilStart < business.reschedule_cutoff_minutes) {
    throw new BookingError(422, `too close to the appointment time to change by phone (cutoff: ${business.reschedule_cutoff_minutes} minutes before start)`);
  }
}

export async function rescheduleBooking(businessId, bookingId, startTime) {
  const current = await withTenant(businessId, (col) => col('bookings').findOne({ _id: bookingId }));
  if (!current) throw new BookingError(404, 'booking not found');

  const service = await withTenant(businessId, (col) => col('services').findOne({ _id: current.service_id }));
  const start = DateTime.fromISO(startTime, { zone: 'utc' });
  if (!start.isValid) throw new BookingError(400, 'invalid startTime');
  const end = start.plus({ minutes: service.duration_minutes + service.buffer_minutes });
  if (end <= start) throw new BookingError(400, 'service has a non-positive duration — fix its durationMinutes/bufferMinutes');
  const startDate = start.toJSDate();
  const endDate = end.toJSDate();

  const db = await getDb();
  const session = client.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      // Free the old slots and claim the new ones atomically — if the new range
      // collides with someone else's lock, this throws and the old locks (deleted in
      // this same transaction) are restored by the abort, not left dangling.
      await db.collection('booking_slot_locks').deleteMany({ booking_id: bookingId }, { session });
      await db.collection('booking_slot_locks').insertMany(
        slotLockIds(businessId, current.staff_id, startDate, endDate).map((id) => ({ _id: id, business_id: businessId, booking_id: bookingId })),
        { session, ordered: true }
      );
      updated = await db.collection('bookings').findOneAndUpdate(
        { _id: bookingId, business_id: businessId },
        {
          $set: {
            start_time: startDate,
            end_time: endDate,
            // New time invalidates any reminder already scheduled/sent against the old
            // one, and the Calendar mirror needs re-pushing (plan.md §5).
            reminder_24h_sent_at: null,
            reminder_1h_sent_at: null,
            sync_status: 'pending',
            sync_attempts: 0,
            sync_error: null,
          },
        },
        { session, returnDocument: 'after' }
      );
    });
  } catch (err) {
    if (err.code === 11000) throw new BookingError(409, 'new slot no longer available');
    throw err;
  } finally {
    await session.endSession();
  }
  return serialize(updated);
}

export async function cancelBooking(businessId, bookingId) {
  const db = await getDb();
  const session = client.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      // Free the slot locks so the time becomes bookable again.
      await db.collection('booking_slot_locks').deleteMany({ booking_id: bookingId }, { session });
      updated = await db.collection('bookings').findOneAndUpdate(
        { _id: bookingId, business_id: businessId },
        { $set: { status: 'cancelled', sync_status: 'pending', sync_attempts: 0, sync_error: null } },
        { session, returnDocument: 'after' }
      );
    });
  } finally {
    await session.endSession();
  }
  if (!updated) throw new BookingError(404, 'booking not found');
  return serialize(updated);
}

function trendPct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// Dashboard home page quick stats, with trend comparisons against the immediately
// preceding window of the same length (yesterday, the 7 days before this one) — same
// rolling-window approach as the platform Overview (src/routes/platform.js /analytics).
export async function getDashboardStats(businessId) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const lastWeekStart = new Date(todayStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  return withTenant(businessId, async (col) => {
    const [todayCount, yesterdayCount, weekCount, lastWeekCount, totalUpcoming, serviceCount, staffCount] = await Promise.all([
      col('bookings').countDocuments({ status: 'confirmed', start_time: { $gte: todayStart, $lt: todayEnd } }),
      col('bookings').countDocuments({ status: 'confirmed', start_time: { $gte: yesterdayStart, $lt: todayStart } }),
      col('bookings').countDocuments({ status: 'confirmed', start_time: { $gte: todayStart, $lt: weekEnd } }),
      col('bookings').countDocuments({ status: 'confirmed', start_time: { $gte: lastWeekStart, $lt: todayStart } }),
      col('bookings').countDocuments({ status: 'confirmed', start_time: { $gte: now } }),
      col('services').countDocuments({}),
      col('staff').countDocuments({}),
    ]);
    return {
      todayCount, todayTrendPct: trendPct(todayCount, yesterdayCount),
      weekCount, weekTrendPct: trendPct(weekCount, lastWeekCount),
      totalUpcoming, serviceCount, staffCount,
    };
  });
}

// Call-in lookup path (plan.md §6): caller gives a phone number instead of a booking id.
export async function findUpcomingBookingsByPhone(businessId, phone) {
  const bookings = await withTenant(businessId, (col) =>
    col('bookings')
      .find({ phone, status: 'confirmed', start_time: { $gt: new Date() } })
      .sort({ start_time: 1 })
      .limit(5)
      .toArray()
  );
  const serviceIds = [...new Set(bookings.map((b) => b.service_id))];
  const services = await withTenant(businessId, (col) => col('services').find({ _id: { $in: serviceIds } }).toArray());
  const nameById = Object.fromEntries(services.map((s) => [s._id, s.name]));
  return serializeAll(bookings).map((b) => ({ ...b, service_name: nameById[b.service_id] ?? null }));
}
