// Waiting list (Jira 38): when a day is full a customer can ask to be told if a time opens up. When any booking for the
// same service on that day is cancelled, the first people in line get a text with the booking link.
//   waiting -> notified (texted) -> booked (they booked)        or expired / removed by staff
import { DateTime } from 'luxon';
import { getDb, withTenant, newId, serializeAll } from '../db.js';
import { sendSms } from '../notifications/sms.js';
import { getConsent, normalizePhone } from './customerService.js';

const MAX_TEXTS_PER_CANCELLATION = 3; // never blast the whole list; the first few in line get the first chance
const QUIET_FROM = 21; // no texts between 9pm and 8am business time
const QUIET_TO = 8;
const siteBase = () => process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002';

const isQuietHour = (zone, now = DateTime.now()) => { const h = now.setZone(zone).hour; return h >= QUIET_FROM || h < QUIET_TO; };

// date: YYYY-MM-DD in the business's own time zone. One live entry per person, service and day.
export async function joinWaitlist(business, { serviceId, staffId, locationId, date, name, phone, email }) {
  const normalized = normalizePhone(phone);
  const doc = {
    _id: newId(), service_id: serviceId, staff_id: staffId || null, location_id: locationId || null, date, name, phone: normalized, email: email || null,
    status: 'waiting', created_at: new Date(), notified_at: null, booked_at: null,
    // the database removes the row a day after the date has passed
    expire_at: new Date(DateTime.fromISO(date, { zone: business.timezone }).plus({ days: 2 }).toMillis()),
  };
  const row = await withTenant(business.id, (c) => c('waitlist').findOneAndUpdate(
    { phone: normalized, service_id: serviceId, date, status: 'waiting' }, { $setOnInsert: doc }, { upsert: true, returnDocument: 'after' }
  ));
  return { id: row._id, alreadyOnList: row._id !== doc._id };
}

export async function listWaitlist(businessId) {
  const [rows, services] = await Promise.all([
    withTenant(businessId, (c) => c('waitlist').find({ status: { $in: ['waiting', 'notified'] } }).sort({ date: 1, created_at: 1 }).limit(200).toArray()),
    withTenant(businessId, (c) => c('services').find({}).toArray()),
  ]);
  const name = Object.fromEntries(services.map((s) => [s._id, s.name]));
  return serializeAll(rows).map((r) => ({ ...r, service_name: name[r.service_id] ?? null }));
}

export const removeWaitlistEntry = (businessId, id) => withTenant(businessId, (c) => c('waitlist').deleteOne({ _id: id })).then((r) => r.deletedCount > 0);

// A person who was on the list (or was texted) and then booked that service that day is "refilled": counted in reports.
export async function markWaitlistBooked(businessId, { phone, serviceId, date }) {
  await withTenant(businessId, (c) => c('waitlist').updateMany(
    { phone: normalizePhone(phone), service_id: serviceId, date, status: { $in: ['waiting', 'notified'] } }, { $set: { status: 'booked', booked_at: new Date() } }
  ));
}

// Is there at least one bookable start left that day for this entry (a named person, or anyone who does the service)?
async function hasFreeSlot(businessId, entry) {
  const { getAvailability } = await import('./bookingService.js'); // loaded late: bookingService imports this file
  const staff = await withTenant(businessId, (c) => c('staff').find({}).toArray());
  const who = entry.staff_id ? [entry.staff_id]
    : staff.length ? staff.filter((s) => !s.service_ids || s.service_ids.includes(entry.service_id)).map((s) => s._id) : [undefined];
  for (const staffId of who) {
    const { slots } = await getAvailability(businessId, { serviceId: entry.service_id, date: entry.date, staffId }).catch(() => ({ slots: [] }));
    if (slots.some((s) => new Date(s).getTime() > Date.now())) return true;
  }
  return false;
}

// Called after any cancellation. Returns how many people were texted. `send` is injectable for tests.
export async function notifyWaitlistForCancellation(businessId, booking, { send = sendSms } = {}) {
  const business = await (await getDb()).collection('businesses').findOne({ _id: businessId });
  if (!business?.slug || business.status === 'suspended' || isQuietHour(business.timezone)) return 0;
  const date = DateTime.fromJSDate(new Date(booking.start_time)).setZone(business.timezone).toISODate();
  const entries = await withTenant(businessId, (c) => c('waitlist').find({ status: 'waiting', service_id: booking.service_id, date }).sort({ created_at: 1 }).limit(MAX_TEXTS_PER_CANCELLATION).toArray());
  if (!entries.length) return 0;
  const service = await withTenant(businessId, (c) => c('services').findOne({ _id: booking.service_id }));
  let sent = 0;
  for (const e of entries) {
    if (!(await hasFreeSlot(businessId, e))) break; // nothing is actually free for this day, so promise nothing
    // claim first so two cancellations at once never text the same person twice
    const claim = await withTenant(businessId, (c) => c('waitlist').updateOne({ _id: e._id, status: 'waiting' }, { $set: { status: 'notified', notified_at: new Date() } }));
    if (claim.modifiedCount === 0) continue;
    if ((await getConsent(businessId, e.phone).catch(() => null))?.smsOptIn === false) continue;
    const day = DateTime.fromISO(e.date).toFormat('cccc d LLLL');
    const link = `${siteBase()}/book/${business.slug}`;
    await send(businessId, e.phone, `${business.name}: good news ${e.name?.split(' ')[0] ?? ''}, a ${service?.name ?? 'time'} slot opened up on ${day}. Book it before it goes: ${link}`.replace('news ,', 'news,'));
    sent++;
  }
  return sent;
}
