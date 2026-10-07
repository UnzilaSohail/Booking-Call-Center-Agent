// Unauthenticated customer-facing API (docs/customer/PUBLIC_BOOKING_API.md): the directory
// (/find) and a business's own booking page (/book/<slug>). Every lookup is by slug and
// every tenant read goes through withTenant, so a customer only ever sees the one business
// they picked. Unknown / suspended / deleted / page-off all answer the same 404.
import { Router } from 'express';
import { DateTime } from 'luxon';
import { getDb, withTenant, newId } from '../db.js';
import { tooMany, tooManyLocal } from '../rateLimit.js';
import { cached } from '../services/directoryCache.js';
import { signManageToken } from '../customerLink.js';
import { isListingEligible } from '../services/listingService.js';
import { distanceKm } from '../services/geocoding.js';
import { BookingError, getAvailability, isSlotOffered, createBooking } from '../services/bookingService.js';
import { normalizePhone, recordWebConsent } from '../services/customerService.js';
import { joinWaitlist } from '../services/waitlistService.js';
import { requireHuman } from '../turnstile.js';
import { phoneCodeRequired, sendPhoneCode, checkPhoneCode, consumePhoneCode } from '../services/phoneCode.js';

export const publicBookingRouter = Router();

const PAGE_SIZE = 20;
const DAILY_CAP = Number(process.env.PUBLIC_BOOKING_DAILY_CAP) || 200;
const CONSENT_TEXT = 'I agree to receive booking confirmations and reminders by SMS and email.';
const notFound = (res) => res.status(404).json({ error: 'not found' });
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scoped to /public — this router is mounted at the shared /api prefix, so an unscoped
// use() would throttle every dashboard request too.
publicBookingRouter.use('/public', (req, res, next) => {
  if (tooManyLocal(`read:${req.ip}`, 120, 60_000)) return res.status(429).json({ error: 'too many requests, slow down' });
  next();
});

// ---- directory -------------------------------------------------------------------------

// Listed, visible, eligible businesses with their services. Two queries (businesses, then
// services for those ids) and the eligibility check in JS. ponytail: scans up to 500
// candidates per request, fine at this scale; move to a denormalised search field / Atlas
// Search when the directory outgrows that.
const liveBusinesses = (filter = {}) => cached(JSON.stringify(filter), () => loadLiveBusinesses(filter));

async function loadLiveBusinesses(filter) {
  const db = await getDb();
  const businesses = await db.collection('businesses').find({
    status: 'active', onboarding_completed_at: { $ne: null },
    'listing.listed': true, 'listing.hidden_by_platform': { $ne: true },
    slug: { $type: 'string' }, booking_page_enabled: { $ne: false },
    ...filter,
  }).sort({ name: 1 }).limit(500).toArray();
  const services = await db.collection('services').find({ business_id: { $in: businesses.map((b) => b._id) } }).sort({ name: 1 }).toArray();
  const byBusiness = new Map();
  for (const s of services) byBusiness.set(s.business_id, [...(byBusiness.get(s.business_id) ?? []), s]);
  return businesses
    .map((b) => ({ business: b, services: byBusiness.get(b._id) ?? [] }))
    .filter(({ business, services: svc }) => isListingEligible(business, { serviceCount: svc.length }));
}

const card = ({ business: b, services }, near) => ({
  slug: b.slug,
  name: b.name,
  categories: b.listing?.categories ?? [],
  city: b.listing?.city ?? null,
  region: b.listing?.region ?? null,
  address: b.address ?? null,
  phone: b.contact_phone ?? null,
  description: b.listing?.description ?? null,
  services: services.slice(0, 3).map((s) => ({ name: s.name, price: s.price ?? null })),
  // Jira 16x "near me" — null when either side has no coordinates (the visitor declined
  // geolocation, or this business was never geocoded), not 0, so the UI can tell
  // "unknown distance" apart from "you're standing on top of it."
  distanceKm: near && b.listing?.lat != null ? distanceKm(near, { lat: b.listing.lat, lng: b.listing.lng }) : null,
});

publicBookingRouter.get('/public/directory', async (req, res, next) => {
  try {
    const { q, category, city } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const near = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    const filter = {};
    if (category) filter['listing.categories'] = String(category);
    if (city) filter['listing.city'] = { $regex: `^${escapeRegex(String(city).trim())}$`, $options: 'i' };

    let rows = await liveBusinesses(filter);
    if (q && String(q).trim()) {
      const re = new RegExp(escapeRegex(String(q).trim()), 'i');
      rows = rows.filter(({ business, services }) => re.test(business.name) || services.some((s) => re.test(s.name)));
    }
    if (near) {
      // Businesses with no coordinates yet sort to the end (Infinity), not dropped — a
      // "near me" search still shouldn't hide a business that just hasn't been geocoded.
      rows = [...rows].sort((a, b) => {
        const da = a.business.listing?.lat != null ? distanceKm(near, { lat: a.business.listing.lat, lng: a.business.listing.lng }) : Infinity;
        const db_ = b.business.listing?.lat != null ? distanceKm(near, { lat: b.business.listing.lat, lng: b.business.listing.lng }) : Infinity;
        return da - db_;
      });
    }
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    res.json({ results: slice.map((r) => card(r, near)), total: rows.length, page, pageSize: PAGE_SIZE });
  } catch (err) {
    next(err);
  }
});

// ---- leads ("tell us what you need") -----------------------------------------------------
// Jira 16z — a visitor who searched the directory and didn't find a match can leave their
// contact details instead of just bouncing. Platform-wide (no business_id — nobody's been
// matched to a business yet); reviewed by a platform admin (GET /api/platform/leads).
publicBookingRouter.post('/public/leads', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    // Honeypot, same pattern/field name as the booking form above.
    if (body.website) return res.status(201).json({ ok: true });
    if (await tooMany(`lead:${req.ip}`, 5, 10 * 60_000)) return res.status(429).json({ error: 'too many requests, try again later' });
    if (!(await requireHuman(req, res))) return;

    const name = String(body.name ?? '').trim();
    const contact = String(body.contact ?? '').trim();
    const need = String(body.need ?? '').trim();
    if (!name || name.length > 100) return res.status(400).json({ error: 'name is required' });
    if (!contact || contact.length > 150) return res.status(400).json({ error: 'a phone number or email is required' });
    if (!need || need.length > 1000) return res.status(400).json({ error: 'tell us briefly what you need' });

    const db = await getDb();
    await db.collection('leads').insertOne({
      _id: newId(), name, contact, need, city: String(body.city ?? '').trim() || null,
      status: 'open', created_at: new Date(),
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const countBy = (rows, pick) => {
  const counts = new Map();
  for (const r of rows) for (const v of [].concat(pick(r) ?? [])) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
};

publicBookingRouter.get('/public/directory/categories', async (req, res, next) => {
  try {
    res.json(countBy(await liveBusinesses(), ({ business }) => business.listing?.categories));
  } catch (err) {
    next(err);
  }
});

publicBookingRouter.get('/public/directory/cities', async (req, res, next) => {
  try {
    res.json(countBy(await liveBusinesses(), ({ business }) => business.listing?.city));
  } catch (err) {
    next(err);
  }
});

// ---- one business ----------------------------------------------------------------------

export async function loadBusiness(req, res, next) {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ slug: req.params.slug, status: 'active', booking_page_enabled: { $ne: false } });
    if (!business) return notFound(res);
    req.business = business;
    next();
  } catch (err) {
    next(err);
  }
}

// Staff who can do a service; staff with no service list do everything (same rule as the
// dashboard's booking modal).
const offers = (staff, serviceId) => !staff.service_ids || staff.service_ids.includes(serviceId);

publicBookingRouter.get('/public/:slug', loadBusiness, async (req, res, next) => {
  try {
    const b = req.business;
    const locations = await withTenant(b._id, (c) => c('locations').find({}).sort({ is_primary: -1, name: 1 }).toArray());
    res.json({
      slug: b.slug,
      name: b.name,
      address: b.address ?? null,
      phone: b.contact_phone ?? null,
      city: b.listing?.city ?? null,
      region: b.listing?.region ?? null,
      description: b.listing?.description ?? null,
      categories: b.listing?.categories ?? [],
      timezone: b.timezone,
      phoneVerification: phoneCodeRequired(b),
      hours: b.hours ?? [],
      locations: locations.map((l) => ({ id: l._id, name: l.name, address: l.address ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

publicBookingRouter.get('/public/:slug/services', loadBusiness, async (req, res, next) => {
  try {
    const rows = await withTenant(req.business._id, (c) => c('services').find({}).sort({ name: 1 }).toArray());
    res.json(rows.map((s) => ({ id: s._id, name: s.name, durationMinutes: s.duration_minutes, price: s.price ?? null })));
  } catch (err) {
    next(err);
  }
});

// Staff with no location work at every location (same rule as service_ids).
const atLocation = (staff, locationId) => !locationId || !staff.location_id || staff.location_id === locationId;

publicBookingRouter.get('/public/:slug/staff', loadBusiness, async (req, res, next) => {
  try {
    const { serviceId, locationId } = req.query;
    const rows = await withTenant(req.business._id, (c) => c('staff').find({}).sort({ name: 1 }).toArray());
    res.json(rows.filter((s) => (!serviceId || offers(s, serviceId)) && atLocation(s, locationId)).map((s) => ({ id: s._id, name: s.name })));
  } catch (err) {
    next(err);
  }
});

// The staff members a booking could go to: one named person (must do the service), or for
// "any" every person who does it. A business with no staff at all books without one.
// locationId (multi-location businesses, Jira 17z) must be one of the business's own locations and
// narrows the staff to those who work there.
async function candidatesFor(businessId, serviceId, staffId, locationId) {
  if (locationId && !(await withTenant(businessId, (c) => c('locations').findOne({ _id: String(locationId) })))) {
    throw new BookingError(400, 'unknown location');
  }
  const staff = await withTenant(businessId, (c) => c('staff').find({}).sort({ name: 1 }).toArray());
  if (staffId && staffId !== 'any') {
    const one = staff.find((s) => s._id === staffId);
    if (!one || !offers(one, serviceId)) throw new BookingError(400, 'that staff member does not offer this service');
    if (!atLocation(one, locationId)) throw new BookingError(400, 'that staff member does not work at that location');
    return [one];
  }
  return staff.length ? staff.filter((s) => offers(s, serviceId) && atLocation(s, locationId)) : [null];
}

publicBookingRouter.get('/public/:slug/availability', loadBusiness, async (req, res, next) => {
  try {
    const { serviceId, date, staffId, locationId } = req.query;
    if (!serviceId || !date) return res.status(400).json({ error: 'serviceId and date are required' });
    const id = req.business._id;
    const candidates = await candidatesFor(id, serviceId, staffId, locationId);
    const results = await Promise.all(candidates.map((s) => getAvailability(id, { serviceId, date, staffId: s?._id })));
    const now = Date.now();
    const slots = [...new Set(results.flatMap((r) => r.slots))].filter((s) => new Date(s).getTime() > now).sort();
    res.json({ slots, durationMinutes: results[0]?.durationMinutes ?? null, timezone: req.business.timezone });
  } catch (err) {
    handleError(err, res, next);
  }
});

function handleError(err, res, next) {
  if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
  next(err);
}

// ---- text code before booking -------------------------------------------------------------
publicBookingRouter.post('/public/:slug/booking-code', loadBusiness, async (req, res, next) => {
  try {
    const b = req.business;
    const phone = normalizePhone(String(req.body?.phone ?? ''));
    if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'a valid phone number is required' });
    if (!phoneCodeRequired(b)) return res.status(400).json({ error: 'a code is not needed for this business' });
    if (await tooMany(`bookcode:${req.ip}`, 10, 15 * 60_000) || await tooMany(`bookcode-phone:${phone}`, 5, 60 * 60_000)) return res.status(429).json({ error: 'too many codes requested, try again later' });
    if (!(await requireHuman(req, res))) return;
    const result = await sendPhoneCode(b, phone);
    if (result === 'failed') return res.status(503).json({ error: `We could not text that number. Check it, or call ${b.contact_phone || b.name} to book.` });
    res.json({ ok: true, wait: result === 'wait' });
  } catch (err) {
    next(err);
  }
});

// ---- waiting list ------------------------------------------------------------------------
// A day with no free time: the customer asks to be texted if one opens up (Jira 38).
publicBookingRouter.post('/public/:slug/waitlist', loadBusiness, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const b = req.business;
    if (body.website) return res.status(201).json({ ok: true }); // honeypot, same as booking
    if (await tooMany(`waitlist:${req.ip}`, 6, 60 * 60_000)) return res.status(429).json({ error: 'too many requests, try again later' });
    if (!(await requireHuman(req, res))) return;
    const name = String(body.name ?? '').trim();
    const phone = normalizePhone(String(body.phone ?? ''));
    const date = String(body.date ?? '');
    if (!name || name.length > 100) return res.status(400).json({ error: 'name is required' });
    if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'a valid phone number is required' });
    if (typeof body.serviceId !== 'string' || !body.serviceId) return res.status(400).json({ error: 'serviceId is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < DateTime.now().setZone(b.timezone).toISODate()) return res.status(400).json({ error: 'pick a day that has not passed' });
    if (body.consent?.sms !== true) return res.status(400).json({ error: 'we text you when a time opens up, so we need your OK to send texts' });
    if (await tooMany(`waitlist-phone:${phone}`, 6, 24 * 60 * 60_000)) return res.status(429).json({ error: 'too many waiting-list requests for this number today' });

    const service = await withTenant(b._id, (c) => c('services').findOne({ _id: body.serviceId }));
    if (!service) return res.status(404).json({ error: 'service not found' });
    const staffId = body.staffId && body.staffId !== 'any' ? String(body.staffId) : null;
    if (staffId && !(await withTenant(b._id, (c) => c('staff').findOne({ _id: staffId })))) return res.status(400).json({ error: 'unknown staff member' });
    await recordWebConsent(b._id, { phone, name, email: null, sms: true, emailOk: false, text: 'I agree to be texted if a time opens up on the waiting list.' });
    const { alreadyOnList } = await joinWaitlist({ id: b._id, timezone: b.timezone }, { serviceId: service._id, staffId, locationId: body.locationId ? String(body.locationId) : null, date, name, phone });
    res.status(201).json({ ok: true, alreadyOnList });
  } catch (err) {
    next(err);
  }
});

// ---- booking ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

publicBookingRouter.post('/public/:slug/bookings', loadBusiness, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const b = req.business;
    // Honeypot: a real visitor never sees the `website` field; a bot fills it. Answer like
    // success so the bot doesn't learn it was caught.
    if (body.website) return res.status(201).json({ booking: { id: 'ok' } });

    if (await tooMany(`book:${req.ip}`, 10, 10 * 60_000)) return res.status(429).json({ error: 'too many booking attempts, try again later' });
    // With a text code the visitor has already passed the bot check (it guards the code request) and proved the number is theirs.
    if (!phoneCodeRequired(b) && !(await requireHuman(req, res))) return;

    const name = String(body.name ?? '').trim();
    const phone = normalizePhone(String(body.phone ?? ''));
    const email = String(body.email ?? '').trim();
    if (!name || name.length > 100) return res.status(400).json({ error: 'name is required' });
    if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'a valid phone number is required' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email is not valid' });
    if (typeof body.serviceId !== 'string' || !body.serviceId || !DateTime.fromISO(String(body.startTime ?? ''), { zone: 'utc' }).isValid) {
      return res.status(400).json({ error: 'serviceId and a valid startTime are required' });
    }
    if (new Date(body.startTime).getTime() <= Date.now()) return res.status(409).json({ error: 'that time has already passed, please pick another' });
    // A stranger's number must not be texted over and over: 8 web bookings per phone per day across ALL businesses.
    if (await tooMany(`phone-all:${phone}`, 8, 24 * 60 * 60_000)) return res.status(429).json({ error: 'too many bookings for this phone number today, please call instead' });
    if (await tooMany(`phone:${b._id}:${phone}`, 5, 60 * 60_000)) return res.status(429).json({ error: 'too many bookings for this phone number, try again later' });
    if (await tooMany(`cap:${b._id}`, DAILY_CAP, 24 * 60 * 60_000)) return res.status(429).json({ error: 'online booking is full for today, please call instead' });

    if (phoneCodeRequired(b)) {
      const check = await checkPhoneCode(b, phone, body.phoneCode);
      if (check !== 'ok') return res.status(400).json({ error: check === 'missing' ? 'Enter the 6-digit code we texted you.' : 'That code is not right or has expired.', needsCode: true });
    }
    const locationId = body.locationId ? String(body.locationId) : undefined;
    const candidates = await candidatesFor(b._id, body.serviceId, body.staffId, locationId);
    const location = locationId ? await withTenant(b._id, (c) => c('locations').findOne({ _id: locationId })) : null;
    const idempotencyKey = body.idempotencyKey ? `web:${phone}:${String(body.idempotencyKey).slice(0, 100)}` : undefined;

    let consentDone = false;
    for (const staff of candidates) {
      if (!(await isSlotOffered(b._id, { serviceId: body.serviceId, staffId: staff?._id, startTime: body.startTime }))) continue;
      if (!consentDone) {
        // Before createBooking: its confirmation reads the customer's consent.
        await recordWebConsent(b._id, { phone, name, email: email || null, sms: body.consent?.sms, emailOk: body.consent?.email, text: CONSENT_TEXT });
        consentDone = true;
      }
      try {
        const { booking, service } = await createBooking(b._id, {
          customerName: name, phone, customerEmail: email || null, serviceId: body.serviceId,
          staffId: staff?._id, locationId, startTime: body.startTime, idempotencyKey, createdVia: 'web',
        });
        if (phoneCodeRequired(b)) await consumePhoneCode(b, phone);
        return res.status(201).json({
          booking: { id: booking.id, reference: booking.reference, startTime: booking.start_time, endTime: booking.end_time, serviceName: service.name, staffName: staff?.name ?? null },
          business: { name: b.name, address: location?.address ?? b.address ?? null, locationName: location?.name ?? null, city: b.listing?.city ?? null, timezone: b.timezone, phone: b.contact_phone ?? null },
          manageUrl: `${process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002'}/manage/${signManageToken(b._id, booking.id, booking.start_time)}`,
        });
      } catch (err) {
        if (!(err instanceof BookingError) || err.status !== 409) throw err; // 409: someone took it, try the next staff member
      }
    }
    res.status(409).json({ error: 'that time is no longer available, please pick another' });
  } catch (err) {
    handleError(err, res, next);
  }
});
