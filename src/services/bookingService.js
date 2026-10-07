// Shared booking logic used by both the REST API (src/routes/bookings.js) and the voice
// agent's tool calls (src/voice/tools.js), so the two entry points plan.md describes as
// needing "same source of truth" can never drift apart.
import { randomInt } from 'node:crypto';
import { DateTime } from 'luxon';
import { client, getDb, withTenant, newId, serialize, serializeAll } from '../db.js';
import { busyIntervals } from '../calendar/google.js';
import { sendBookingConfirmation } from '../notifications/notify.js';
import { upsertCustomer } from './customerService.js';
import { markWaitlistBooked, notifyWaitlistForCancellation } from './waitlistService.js';

// Short code a customer can read out or quote ("my booking is K7P2QX"). No 0/O/1/I/L so it
// survives being read over the phone. Not unique-enforced: 31^6 is ~887M per business.
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const makeReference = () => Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('');

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

// hours: [{day_of_week, open_time, close_time}] — same lookup used for both business
// hours and a staff member's own override hours.
function hoursForDay(hours, dow) {
  return (hours ?? []).find((h) => h.day_of_week === dow) ?? null;
}
function timeOnDay(day, timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return day.set({ hour: h, minute: m });
}

const SLOT_STEP_MINUTES = 30;

export async function getAvailability(businessId, { serviceId, date, staffId, excludeBookingId, excludeExistingBookings = false }) {
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
  const empty = { slots: [], durationMinutes: service.duration_minutes, bufferMinutes: service.buffer_minutes };

  // Date-specific full closures (holidays) take priority over the recurring weekly hours.
  if ((business.holidays ?? []).some((h) => h.date === date)) return empty;

  // Maximum booking window: a date past this is never offered, regardless of hours.
  if (business.max_booking_window_days != null) {
    const daysOut = dayStart.diff(DateTime.now().setZone(zone).startOf('day'), 'days').days;
    if (daysOut > business.max_booking_window_days) return empty;
  }

  const hours = hoursForDay(business.hours, dow);
  if (!hours) return empty; // closed that day

  let open = timeOnDay(dayStart, hours.open_time);
  let close = timeOnDay(dayStart, hours.close_time);

  let staff = null;
  if (staffId) {
    staff = await withTenant(businessId, (col) => col('staff').findOne({ _id: staffId }));
    // A staff member's own hours (if set) narrow the business hours for that day — e.g.
    // a business open 9-5 but a part-time staffer who only works 9-1.
    const staffHours = staff ? hoursForDay(staff.hours, dow) : undefined;
    if (staff?.hours) {
      if (!staffHours) return empty; // staff doesn't work this day even if the business is open
      const staffOpen = timeOnDay(dayStart, staffHours.open_time);
      const staffClose = timeOnDay(dayStart, staffHours.close_time);
      if (staffOpen > open) open = staffOpen;
      if (staffClose < close) close = staffClose;
      if (open >= close) return empty;
    }
  }

  // excludeBookingId: when checking availability for rescheduling a booking, that
  // booking's own current slot must not count as "busy" against itself — otherwise
  // its own time would wrongly look unavailable (worst case, a fully-booked day would
  // show zero options even though the booking's own slot is trivially free for it).
  // excludeExistingBookings: used by isSlotOffered below, which only needs to know
  // whether a time falls inside open hours/staff hours/breaks/time off — an existing
  // booking on that exact slot is already caught by the atomic slot-lock in
  // createBooking itself, with its own specific error and failed_bookings log entry.
  const existing = excludeExistingBookings ? [] : await withTenant(businessId, (col) =>
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
    if (staff?.google_calendar_id) calendarId = staff.google_calendar_id;
    calendarBusy = await busyIntervals(business, calendarId, open.toUTC().toISO(), close.toUTC().toISO());
  } catch (err) {
    console.error('freebusy check failed, falling back to DB-only availability:', err.message);
  }

  // A staff member's daily break and any approved time off are busy the same way an
  // existing booking is — no separate "unavailable" concept, just more busy ranges.
  let timeOff = [];
  if (staffId) {
    timeOff = await withTenant(businessId, (col) =>
      col('staff_time_off').find({ staff_id: staffId, start_time: { $lt: close.toUTC().toJSDate() }, end_time: { $gt: open.toUTC().toJSDate() } }).toArray()
    );
  }
  const breakRange = staff?.daily_break
    ? [{ start: timeOnDay(dayStart, staff.daily_break.start_time), end: timeOnDay(dayStart, staff.daily_break.end_time) }]
    : [];

  const busyRanges = [
    ...existing.map((b) => ({ start: DateTime.fromJSDate(b.start_time), end: DateTime.fromJSDate(b.end_time) })),
    ...calendarBusy.map((b) => ({ start: DateTime.fromISO(b.start), end: DateTime.fromISO(b.end) })),
    ...timeOff.map((t) => ({ start: DateTime.fromJSDate(t.start_time), end: DateTime.fromJSDate(t.end_time) })),
    ...breakRange,
  ];

  const slots = [];
  // Offered start times sit on a fixed half-hour grid; a longer service still blocks its full
  // duration+buffer window via the overlap check, so a 60-min job at 9:00 hides 9:30 too.
  for (let start = open; start.plus({ minutes: slotMinutes }) <= close; start = start.plus({ minutes: SLOT_STEP_MINUTES })) {
    const end = start.plus({ minutes: slotMinutes });
    const overlaps = busyRanges.some((b) => start.toUTC() < b.end && end.toUTC() > b.start);
    if (!overlaps) slots.push(start.toUTC().toISO());
  }

  return { slots, durationMinutes: service.duration_minutes, bufferMinutes: service.buffer_minutes };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// q: free-text search over customer name/phone/email — the "customer calls asking about their
// appointment" lookup, separate from the calendar's date-range view.
export async function listBookings(businessId, { from, to, q, status } = {}) {
  // Onboarding test-call bookings carry is_test:true and must never show up on the real
  // calendar/bookings list — this is a dashboard-facing read with no caller that
  // legitimately wants test data mixed in.
  const filter = {
    is_test: { $ne: true },
    start_time: { $gte: from ? new Date(from) : new Date(0), $lte: to ? new Date(to) : new Date('2100-01-01') },
  };
  if (status) filter.status = status;
  if (q) {
    const pattern = escapeRegex(q);
    filter.$or = [{ customer_name: { $regex: pattern, $options: 'i' } }, { phone: { $regex: pattern, $options: 'i' } }, { customer_email: { $regex: pattern, $options: 'i' } }, { reference: { $regex: `^${pattern}$`, $options: 'i' } }];
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
const SLOT_GRANULARITY_MS = SLOT_GRANULARITY_MINUTES * 60_000;

// KG-01: floor to the 5-minute grid before locking, so an off-grid start (14:02) locks
// the same slot as the grid-aligned booking it actually collides with (14:00) instead of
// its own unaligned slot that nothing else ever lands on.
function floorToGrid(date) {
  return new Date(Math.floor(date.getTime() / SLOT_GRANULARITY_MS) * SLOT_GRANULARITY_MS);
}

// The actual "no two overlapping bookings" guarantee (plan.md §4/§6), replacing
// Postgres's EXCLUDE USING gist (see db/schema.js for the full rationale). A booking's
// [start, end) range is decomposed into fixed 5-minute slot documents whose _id is
// deterministic — two concurrent bookings that touch the same slot collide on that _id,
// and Mongo's default unique _id index lets exactly one insert win.
// Locks only matter until the booking's time has passed. expires_at (end + 1 day) lets a TTL
// index (db/schema.js) delete them by itself, so booking_slot_locks stops growing (KG-14).
const LOCK_GRACE_MS = 24 * 60 * 60_000;
export function lockDocs(businessId, bookingId, staffId, startDate, endDate) {
  const expires_at = new Date(endDate.getTime() + LOCK_GRACE_MS);
  return slotLockIds(businessId, staffId, startDate, endDate).map((id) => ({ _id: id, business_id: businessId, booking_id: bookingId, expires_at }));
}

function slotLockIds(businessId, staffId, startDate, endDate) {
  const ids = [];
  const staffKey = staffId || 'none';
  for (let t = floorToGrid(startDate).getTime(); t < endDate.getTime(); t += SLOT_GRANULARITY_MS) {
    ids.push(`${businessId}:${staffKey}:${new Date(t).toISOString()}`);
  }
  return ids;
}

// KG-02/28c: the hard backstop behind check_availability — re-derives the same slot list
// and checks the requested start is actually in it, so a caller can't book a time
// check_availability never offered (closed hours, holiday, staff time off, etc.).
// Voice-only by design (28b): the dashboard stays permissive so staff can override.
export async function isSlotOffered(businessId, { serviceId, staffId, startTime }) {
  const start = DateTime.fromISO(startTime, { zone: 'utc' });
  if (!start.isValid) return false;
  const business = await getBusiness(businessId);
  const date = start.setZone(business.timezone).toISODate();
  const { slots } = await getAvailability(businessId, { serviceId, date, staffId, excludeExistingBookings: true });
  return slots.some((s) => DateTime.fromISO(s).toMillis() === start.toMillis());
}

export async function createBooking(businessId, { customerName, phone, customerEmail, serviceId, staffId, locationId, startTime, idempotencyKey, createdVia }) {
  if (!customerName || !phone || !serviceId || !startTime) {
    throw new BookingError(400, 'customerName, phone, serviceId and startTime are required');
  }
  // Bookings made from an onboarding test call carry createdVia:'test'. They still take a
  // real slot lock (so testing a double-booking scenario is meaningful) but must never
  // reach Google Calendar or trigger a real SMS/email — sync_status:'skipped' keeps them
  // out of the sync worker's pending queue entirely (src/calendar/sync-worker.js only
  // polls pending/failed), and is_test excludes them from every dashboard-facing read below.
  const isTest = createdVia === 'test';

  const service = await withTenant(businessId, (col) => col('services').findOne({ _id: serviceId }));
  if (!service) throw new BookingError(404, 'service not found');

  const start = DateTime.fromISO(startTime, { zone: 'utc' });
  if (!start.isValid) throw new BookingError(400, 'invalid startTime');
  const end = start.plus({ minutes: service.duration_minutes + service.buffer_minutes });
  if (end <= start) throw new BookingError(400, 'service has a non-positive duration — fix its durationMinutes/bufferMinutes');
  const startDate = start.toJSDate();
  const endDate = end.toJSDate();

  // The hard backstop behind what check_availability/the dashboard already offer as
  // slots — never trust a start time handed back by a caller without re-checking it,
  // same principle as assertWithinChangeCutoff below for reschedule/cancel.
  const business = await getBusiness(businessId);
  const minutesUntilStart = start.diffNow('minutes').minutes;
  if (business.min_booking_notice_minutes && minutesUntilStart < business.min_booking_notice_minutes) {
    throw new BookingError(422, `bookings need at least ${business.min_booking_notice_minutes} minutes' notice`);
  }
  if (business.max_booking_window_days != null) {
    const daysOut = start.setZone(business.timezone).diff(DateTime.now().setZone(business.timezone).startOf('day'), 'days').days;
    if (daysOut > business.max_booking_window_days) {
      throw new BookingError(422, `bookings can only be made up to ${business.max_booking_window_days} days in advance`);
    }
  }

  // Idempotent replay (plan.md §5): a retried tool-call with the same key returns the
  // booking it already made instead of re-attempting to lock a slot.
  if (idempotencyKey) {
    const existing = await withTenant(businessId, (col) => col('bookings').findOne({ idempotency_key: idempotencyKey }));
    if (existing?.status === 'confirmed') return { booking: serialize(existing), service, replayed: true };
    // KG-05/28g: the key belongs to a booking that was cancelled since. Replaying it would hand
    // back a cancelled booking as if it were confirmed, so release the key and book afresh.
    if (existing) await withTenant(businessId, (col) => col('bookings').updateOne({ _id: existing._id, status: { $ne: 'confirmed' } }, { $unset: { idempotency_key: '' } }));
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
    location_id: locationId || null,
    start_time: startDate,
    end_time: endDate,
    status: 'confirmed',
    reference: makeReference(),
    google_event_id: null,
    created_via: createdVia || 'dashboard',
    is_test: isTest,
    created_at: new Date(),
    sync_status: isTest ? 'skipped' : 'pending',
    sync_attempts: 0,
    sync_error: null,
    confirmation_sent_at: null,
    reminder_24h_sent_at: null,
    reminder_2h_sent_at: null,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}), // omitted entirely when absent, matching the partial unique index (db/schema.js)
  };

  const db = await getDb();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      // Locks inserted first: if any slot in the range is already taken, this throws
      // (duplicate key on _id) before the booking document itself is ever written.
      await db.collection('booking_slot_locks').insertMany(
        lockDocs(businessId, bookingId, staffId, startDate, endDate),
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
        if (existing?.status === 'confirmed') return { booking: serialize(existing), service, replayed: true };
      }
      throw new BookingError(409, 'slot no longer available');
    }
    throw err;
  } finally {
    await session.endSession();
  }

  // Fire-and-forget: confirmation SMS/email must never delay or fail the booking result
  // (plan.md §5 step 8) — lives here, not in each caller, so every entry point (the REST
  // route AND the voice agent's create_booking tool in src/voice/tools.js) gets it for
  // free instead of only whichever caller remembered to send it. Same reasoning for the
  // customer-record upsert (src/services/customerService.js) — every booking, from any
  // entry point, keeps the customer directory current.
  sendBookingConfirmation(business, bookingDoc, service)
    .catch((err) => console.error(`confirmation notification failed for booking ${bookingId}:`, err.message));
  upsertCustomer(businessId, { phone, name: customerName, email: customerEmail })
    .catch((err) => console.error(`customer upsert failed for booking ${bookingId}:`, err.message));
  // Someone on the waiting list for this service and day who has now booked is counted as a refilled slot.
  markWaitlistBooked(businessId, { phone, serviceId, date: start.setZone(business.timezone).toISODate() })
    .catch((err) => console.error(`waiting list update failed for booking ${bookingId}:`, err.message));

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
  // KG-06/28e: a cancelled (or otherwise non-confirmed) booking has already freed its
  // locks — rescheduling it would re-lock a slot for a booking nobody sees as active.
  if (current.status !== 'confirmed') {
    throw new BookingError(422, `cannot reschedule a ${current.status} booking`);
  }

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
        lockDocs(businessId, bookingId, current.staff_id, startDate, endDate),
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
            reminder_2h_sent_at: null,
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

// Staff mark a visit that already happened as a no-show (the customer did not come), or undo it. Only a past, confirmed
// booking qualifies. The no-show rate in reports is no-shows divided by past confirmed visits (Jira 46).
export async function setNoShow(businessId, bookingId, flag) {
  const updated = await withTenant(businessId, (col) => col('bookings').findOneAndUpdate(
    { _id: bookingId, status: 'confirmed', start_time: { $lt: new Date() } },
    { $set: { no_show: !!flag, no_show_marked_at: flag ? new Date() : null } },
    { returnDocument: 'after' }
  ));
  if (!updated) throw new BookingError(400, 'only a visit that has already happened (and was not cancelled) can be marked as a no-show');
  return serialize(updated);
}

// via: who cancelled ('dashboard' staff, 'call', 'portal', 'link', 'sms_reply'). Recorded so reports can show how many
// customers cancelled in time after a reminder. Freed time is offered to the waiting list.
export async function cancelBooking(businessId, bookingId, { via = 'dashboard' } = {}) {
  const db = await getDb();
  const session = client.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      // Free the slot locks so the time becomes bookable again.
      await db.collection('booking_slot_locks').deleteMany({ booking_id: bookingId }, { session });
      updated = await db.collection('bookings').findOneAndUpdate(
        { _id: bookingId, business_id: businessId },
        { $set: { status: 'cancelled', cancelled_at: new Date(), cancelled_via: via, sync_status: 'pending', sync_attempts: 0, sync_error: null } },
        { session, returnDocument: 'after' }
      );
    });
  } finally {
    await session.endSession();
  }
  if (!updated) throw new BookingError(404, 'booking not found');
  notifyWaitlistForCancellation(businessId, updated).catch((err) => console.error(`waiting list texts failed for booking ${bookingId}:`, err.message));
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
      col('bookings').countDocuments({ status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: todayStart, $lt: todayEnd } }),
      col('bookings').countDocuments({ status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: yesterdayStart, $lt: todayStart } }),
      col('bookings').countDocuments({ status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: todayStart, $lt: weekEnd } }),
      col('bookings').countDocuments({ status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: lastWeekStart, $lt: todayStart } }),
      col('bookings').countDocuments({ status: 'confirmed', is_test: { $ne: true }, start_time: { $gte: now } }),
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
// isTest scopes this to the onboarding test call's own test bookings when true, so a test
// call can exercise reschedule/cancel against the test booking it just made — real calls
// (isTest: false, the default) never see test bookings, and a test call never sees real
// customer bookings either.
export async function findUpcomingBookingsByPhone(businessId, phone, { isTest = false } = {}) {
  const bookings = await withTenant(businessId, (col) =>
    col('bookings')
      .find({ phone, status: 'confirmed', is_test: isTest, start_time: { $gt: new Date() } })
      .sort({ start_time: 1 })
      .limit(5)
      .toArray()
  );
  const serviceIds = [...new Set(bookings.map((b) => b.service_id))];
  const services = await withTenant(businessId, (col) => col('services').find({ _id: { $in: serviceIds } }).toArray());
  const nameById = Object.fromEntries(services.map((s) => [s._id, s.name]));
  return serializeAll(bookings).map((b) => ({ ...b, service_name: nameById[b.service_id] ?? null }));
}
