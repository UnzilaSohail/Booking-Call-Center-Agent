// Unauthenticated customer-facing API (docs/customer/PUBLIC_BOOKING_API.md): the directory
// (/find) and a business's own booking page (/book/<slug>). Every lookup is by slug and
// every tenant read goes through withTenant, so a customer only ever sees the one business
// they picked. Unknown / suspended / deleted / page-off all answer the same 404.
import { Router } from 'express';
import { DateTime } from 'luxon';
import { getDb, withTenant } from '../db.js';
import { tooMany } from '../rateLimit.js';
import { signManageToken } from '../customerLink.js';
import { isListingEligible } from '../services/listingService.js';
import { BookingError, getAvailability, isSlotOffered, createBooking } from '../services/bookingService.js';
import { normalizePhone, recordWebConsent } from '../services/customerService.js';

export const publicBookingRouter = Router();

const PAGE_SIZE = 20;
const DAILY_CAP = Number(process.env.PUBLIC_BOOKING_DAILY_CAP) || 200;
const CONSENT_TEXT = 'I agree to receive booking confirmations and reminders by SMS and email.';
const notFound = (res) => res.status(404).json({ error: 'not found' });
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scoped to /public — this router is mounted at the shared /api prefix, so an unscoped
// use() would throttle every dashboard request too.
publicBookingRouter.use('/public', (req, res, next) => {
  if (tooMany(`read:${req.ip}`, 120, 60_000)) return res.status(429).json({ error: 'too many requests, slow down' });
  next();
});

// ---- directory -------------------------------------------------------------------------

// Listed, visible, eligible businesses with their services. Two queries (businesses, then
// services for those ids) and the eligibility check in JS. ponytail: scans up to 500
// candidates per request, fine at this scale; move to a denormalised search field / Atlas
// Search when the directory outgrows that.
async function liveBusinesses(filter = {}) {
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

const card = ({ business: b, services }) => ({
  slug: b.slug,
  name: b.name,
  categories: b.listing?.categories ?? [],
  city: b.listing?.city ?? null,
  region: b.listing?.region ?? null,
  address: b.address ?? null,
  phone: b.contact_phone ?? null,
  description: b.listing?.description ?? null,
  services: services.slice(0, 3).map((s) => ({ name: s.name, price: s.price ?? null })),
});

publicBookingRouter.get('/public/directory', async (req, res, next) => {
  try {
    const { q, category, city } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = {};
    if (category) filter['listing.categories'] = String(category);
    if (city) filter['listing.city'] = { $regex: `^${escapeRegex(String(city).trim())}$`, $options: 'i' };

    let rows = await liveBusinesses(filter);
    if (q && String(q).trim()) {
      const re = new RegExp(escapeRegex(String(q).trim()), 'i');
      rows = rows.filter(({ business, services }) => re.test(business.name) || services.some((s) => re.test(s.name)));
    }
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    res.json({ results: slice.map(card), total: rows.length, page, pageSize: PAGE_SIZE });
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

publicBookingRouter.get('/public/:slug/staff', loadBusiness, async (req, res, next) => {
  try {
    const { serviceId } = req.query;
    const rows = await withTenant(req.business._id, (c) => c('staff').find({}).sort({ name: 1 }).toArray());
    res.json(rows.filter((s) => !serviceId || offers(s, serviceId)).map((s) => ({ id: s._id, name: s.name })));
  } catch (err) {
    next(err);
  }
});

// The staff members a booking could go to: one named person (must do the service), or for
// "any" every person who does it. A business with no staff at all books without one.
async function candidatesFor(businessId, serviceId, staffId) {
  const staff = await withTenant(businessId, (c) => c('staff').find({}).sort({ name: 1 }).toArray());
  if (staffId && staffId !== 'any') {
    const one = staff.find((s) => s._id === staffId);
    if (!one || !offers(one, serviceId)) throw new BookingError(400, 'that staff member does not offer this service');
    return [one];
  }
  return staff.length ? staff.filter((s) => offers(s, serviceId)) : [null];
}

publicBookingRouter.get('/public/:slug/availability', loadBusiness, async (req, res, next) => {
  try {
    const { serviceId, date, staffId } = req.query;
    if (!serviceId || !date) return res.status(400).json({ error: 'serviceId and date are required' });
    const id = req.business._id;
    const candidates = await candidatesFor(id, serviceId, staffId);
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

// ---- booking ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

publicBookingRouter.post('/public/:slug/bookings', loadBusiness, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const b = req.business;
    // Honeypot: a real visitor never sees the `website` field; a bot fills it. Answer like
    // success so the bot doesn't learn it was caught.
    if (body.website) return res.status(201).json({ booking: { id: 'ok' } });

    if (tooMany(`book:${req.ip}`, 10, 10 * 60_000)) return res.status(429).json({ error: 'too many booking attempts, try again later' });

    const name = String(body.name ?? '').trim();
    const phone = normalizePhone(String(body.phone ?? ''));
    const email = String(body.email ?? '').trim();
    if (!name || name.length > 100) return res.status(400).json({ error: 'name is required' });
    if (!/^\+\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'a valid phone number is required' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email is not valid' });
    if (!body.serviceId || !DateTime.fromISO(String(body.startTime ?? ''), { zone: 'utc' }).isValid) {
      return res.status(400).json({ error: 'serviceId and a valid startTime are required' });
    }
    if (new Date(body.startTime).getTime() <= Date.now()) return res.status(409).json({ error: 'that time has already passed, please pick another' });
    if (tooMany(`phone:${b._id}:${phone}`, 5, 60 * 60_000)) return res.status(429).json({ error: 'too many bookings for this phone number, try again later' });
    if (tooMany(`cap:${b._id}`, DAILY_CAP, 24 * 60 * 60_000)) return res.status(429).json({ error: 'online booking is full for today, please call instead' });

    const candidates = await candidatesFor(b._id, body.serviceId, body.staffId);
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
          staffId: staff?._id, startTime: body.startTime, idempotencyKey, createdVia: 'web',
        });
        return res.status(201).json({
          booking: { id: booking.id, reference: booking.reference, startTime: booking.start_time, endTime: booking.end_time, serviceName: service.name, staffName: staff?.name ?? null },
          business: { name: b.name, address: b.address ?? null, city: b.listing?.city ?? null, timezone: b.timezone, phone: b.contact_phone ?? null },
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
