// Customer portal "My appointments" (docs/customer/PORTAL_SPEC.md). Sign-in is per business:
// phone (SMS code) or email (code by email) -> short session token -> /api/customer/*.
// Everything here is scoped to ONE business and ONE customer taken from the token, never
// from the request. The code endpoint answers identically whether or not the person is a
// customer, and does its work after replying, so neither the answer nor the timing tells a
// stranger who is on file.
import { Router } from 'express';
import { DateTime } from 'luxon';
import { getDb, withTenant, newId } from '../db.js';
import { tooMany } from '../rateLimit.js';
import { generateCode, hashCode, verifyCode, fakeVerify, CODE_TTL_MS, MAX_ATTEMPTS } from '../verification.js';
import { sendSms, smsConfigured } from '../notifications/sms.js';
import { sendEmail, emailConfigured } from '../notifications/email.js';
import { signCustomerToken, requireCustomer } from '../customerAuth.js';
import { loadBusiness } from './publicBooking.js';
import { normalizePhone, LANGUAGES } from '../services/customerService.js';
import {
  BookingError, getBusiness, getAvailability, isSlotOffered, rescheduleBooking, cancelBooking, assertWithinChangeCutoff,
} from '../services/bookingService.js';

export const customerPortalRouter = Router();

const RESEND_COOLDOWN_MS = 60_000;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const badCode = (res) => res.status(401).json({ error: 'that code is not right or has expired' });

function handleError(err, res, next) {
  if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
  next(err);
}

// { kind:'sms'|'email', value } from what the customer typed, or null.
function identify(body) {
  const email = String(body.email ?? '').trim();
  const phone = normalizePhone(String(body.phone ?? ''));
  if (email) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: 'email', value: email } : null;
  return /^\+\d{10,15}$/.test(phone) ? { kind: 'sms', value: phone } : null;
}

const findCustomer = (businessId, who) => withTenant(businessId, (c) => c('customers').findOne(
  who.kind === 'sms' ? { phone: who.value } : { email: { $regex: `^${escapeRegex(who.value)}$`, $options: 'i' } }
));

customerPortalRouter.post('/public/:slug/portal/code', loadBusiness, async (req, res, next) => {
  try {
    const who = identify(req.body ?? {});
    if (!who) return res.status(400).json({ error: 'enter a valid mobile number or email' });
    const b = req.business;
    const available = who.kind === 'sms' ? smsConfigured() : emailConfigured();
    if (!available) {
      return res.status(503).json({ error: `Sign-in codes by ${who.kind === 'sms' ? 'text message' : 'email'} are not available right now, please call ${b.name}` });
    }
    if (tooMany(`portal-ip:${req.ip}`, 10, 15 * 60_000) || tooMany(`portal-id:${b._id}:${who.value.toLowerCase()}`, 5, 60 * 60_000)) {
      return res.status(429).json({ error: 'too many attempts, try again later' });
    }

    res.json({ ok: true, message: `If that ${who.kind === 'sms' ? 'number' : 'email'} is on file, we have sent a code.` });

    // After replying (same latency for everyone). Failures are logged, never shown.
    try {
      const customer = await findCustomer(b._id, who);
      if (!customer) return;
      const db = await getDb();
      const _id = `${b._id}:${customer._id}`;
      const existing = await db.collection('customer_login_codes').findOne({ _id });
      if (existing && Date.now() - new Date(existing.created_at).getTime() < RESEND_COOLDOWN_MS) return;

      const code = generateCode();
      await db.collection('customer_login_codes').replaceOne(
        { _id },
        { _id, business_id: b._id, customer_id: customer._id, code_hash: await hashCode(code), attempts: 0, created_at: new Date(), expires_at: new Date(Date.now() + CODE_TTL_MS) },
        { upsert: true }
      );
      const text = `${b.name}: your sign-in code is ${code}. It expires in 10 minutes.`;
      if (who.kind === 'sms') await sendSms(b._id, customer.phone, text);
      else await sendEmail(customer.email, `Your sign-in code for ${b.name}`, text);
    } catch (err) {
      console.error('customer sign-in code failed:', err.message);
    }
  } catch (err) {
    next(err);
  }
});

customerPortalRouter.post('/public/:slug/portal/verify', loadBusiness, async (req, res, next) => {
  try {
    const who = identify(req.body ?? {});
    const code = String(req.body?.code ?? '').trim();
    if (!who || !/^\d{6}$/.test(code)) return badCode(res);
    if (tooMany(`portal-verify:${req.ip}`, 20, 15 * 60_000)) return res.status(429).json({ error: 'too many attempts, try again later' });
    const b = req.business;

    const customer = await findCustomer(b._id, who);
    if (!customer) { await fakeVerify(code); return badCode(res); } // same time as a wrong code
    const db = await getDb();
    // Count the attempt first, atomically, so parallel guesses can't exceed the limit.
    const row = await db.collection('customer_login_codes').findOneAndUpdate({ _id: `${b._id}:${customer._id}` }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (!row) { await fakeVerify(code); return badCode(res); }
    if (row.attempts > MAX_ATTEMPTS || !(await verifyCode(code, row.code_hash, row.expires_at))) return badCode(res);

    await db.collection('customer_login_codes').deleteOne({ _id: row._id });
    res.json({ token: signCustomerToken(b._id, customer._id) });
  } catch (err) {
    next(err);
  }
});

// ---- signed-in customer ------------------------------------------------------------------

const me = Router();
customerPortalRouter.use('/customer', requireCustomer, me);

const profile = (c) => ({
  name: c.name ?? null, phone: c.phone, email: c.email ?? null,
  smsOptIn: c.consent?.smsOptIn !== false, emailOptIn: c.consent?.emailOptIn !== false,
  language: c.preferences?.language ?? null,
});

me.get('/me', async (req, res, next) => {
  try {
    const b = await getBusiness(req.businessId);
    const db = await getDb();
    const { slug } = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { slug: 1 } });
    res.json({ ...profile(req.customer), business: { name: b.name, slug, address: b.address ?? null, phone: b.contact_phone ?? null, timezone: b.timezone } });
  } catch (err) {
    next(err);
  }
});

me.patch('/me', async (req, res, next) => {
  try {
    const { name, email, smsOptIn, emailOptIn, language } = req.body ?? {};
    const set = { updated_at: new Date() };
    if (name !== undefined) {
      if (!String(name).trim() || String(name).length > 100) return res.status(400).json({ error: 'name is required' });
      set.name = String(name).trim();
    }
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: 'email is not valid' });
      set.email = email ? String(email) : null;
    }
    if (language !== undefined) {
      if (language && !LANGUAGES.includes(language)) return res.status(400).json({ error: `language must be one of: ${LANGUAGES.join(', ')}` });
      set['preferences.language'] = language || null;
    }
    if (smsOptIn !== undefined) set['consent.smsOptIn'] = !!smsOptIn;
    if (emailOptIn !== undefined) set['consent.emailOptIn'] = !!emailOptIn;
    const updated = await withTenant(req.businessId, (c) => c('customers').findOneAndUpdate({ _id: req.customer._id }, { $set: set }, { returnDocument: 'after' }));
    res.json(profile(updated));
  } catch (err) {
    next(err);
  }
});

async function myBookings(req) {
  const rows = await withTenant(req.businessId, (c) => c('bookings').find({ phone: req.customer.phone, is_test: { $ne: true } }).sort({ start_time: -1 }).limit(200).toArray());
  const [services, staff, business] = await Promise.all([
    withTenant(req.businessId, (c) => c('services').find({ _id: { $in: [...new Set(rows.map((r) => r.service_id))] } }).toArray()),
    withTenant(req.businessId, (c) => c('staff').find({ _id: { $in: [...new Set(rows.map((r) => r.staff_id).filter(Boolean))] } }).toArray()),
    getBusiness(req.businessId),
  ]);
  const svc = Object.fromEntries(services.map((s) => [s._id, s.name]));
  const stf = Object.fromEntries(staff.map((s) => [s._id, s.name]));
  const now = Date.now();
  return rows.map((r) => ({
    id: r._id, reference: r.reference ?? null, startTime: r.start_time, endTime: r.end_time, status: r.status,
    serviceName: svc[r.service_id] ?? null, staffName: stf[r.staff_id] ?? null, timezone: business.timezone,
    canChange: r.status === 'confirmed' && new Date(r.start_time).getTime() - now >= (business.reschedule_cutoff_minutes ?? 0) * 60_000,
    upcoming: r.status === 'confirmed' && new Date(r.start_time).getTime() >= now,
  }));
}

me.get('/appointments', async (req, res, next) => {
  try {
    const all = await myBookings(req);
    res.json({
      upcoming: all.filter((b) => b.upcoming).sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
      history: all.filter((b) => !b.upcoming),
    });
  } catch (err) {
    next(err);
  }
});

// Ownership check shared by reschedule/cancel/availability: the booking must be this
// customer's (same business, same phone) — an id from anyone else answers 404.
async function ownBooking(req, res) {
  const booking = await withTenant(req.businessId, (c) => c('bookings').findOne({ _id: req.params.id, phone: req.customer.phone, is_test: { $ne: true } }));
  if (!booking) { res.status(404).json({ error: 'appointment not found' }); return null; }
  if (booking.status !== 'confirmed') { res.status(400).json({ error: 'this appointment is already cancelled' }); return null; }
  return booking;
}

me.get('/appointments/:id/availability', async (req, res, next) => {
  try {
    const booking = await ownBooking(req, res);
    if (!booking) return;
    if (!req.query.date) return res.status(400).json({ error: 'date is required' });
    const a = await getAvailability(req.businessId, { serviceId: booking.service_id, date: req.query.date, staffId: booking.staff_id, excludeBookingId: booking._id });
    res.json({ slots: a.slots.filter((s) => new Date(s).getTime() > Date.now()) });
  } catch (err) {
    handleError(err, res, next);
  }
});

me.post('/appointments/:id/reschedule', async (req, res, next) => {
  try {
    const booking = await ownBooking(req, res);
    if (!booking) return;
    const { startTime } = req.body ?? {};
    if (!DateTime.fromISO(String(startTime ?? ''), { zone: 'utc' }).isValid || new Date(startTime).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'pick a valid time in the future' });
    }
    assertWithinChangeCutoff(await getBusiness(req.businessId), booking);
    if (!(await isSlotOffered(req.businessId, { serviceId: booking.service_id, staffId: booking.staff_id, startTime }))) {
      return res.status(409).json({ error: 'that time is not available, please pick another' });
    }
    await rescheduleBooking(req.businessId, booking._id, startTime);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res, next);
  }
});

me.post('/appointments/:id/cancel', async (req, res, next) => {
  try {
    const booking = await ownBooking(req, res);
    if (!booking) return;
    assertWithinChangeCutoff(await getBusiness(req.businessId), booking);
    await cancelBooking(req.businessId, booking._id);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res, next);
  }
});

// Everything stored about this customer at this business (their data-access right).
me.get('/export', async (req, res, next) => {
  try {
    const { _id, business_id, ...rest } = req.customer;
    res.json({ exportedAt: new Date().toISOString(), customer: { id: _id, ...rest }, appointments: await myBookings(req) });
  } catch (err) {
    next(err);
  }
});

// Deleting is a business decision (bookings may need to be kept), so this files a request
// into the owner's Exceptions queue (as a callback request) instead of deleting anything.
me.post('/delete-request', async (req, res, next) => {
  try {
    const existing = await withTenant(req.businessId, (c) => c('callback_requests').findOne({ phone: req.customer.phone, source: 'portal-delete', status: 'pending' }));
    if (!existing) {
      await withTenant(req.businessId, (c) => c('callback_requests').insertOne({
        _id: newId(), phone: req.customer.phone, reason: 'Customer asked to delete their data (from My appointments).',
        status: 'pending', source: 'portal-delete', created_at: new Date(),
      }));
    }
    res.status(202).json({ ok: true, message: 'Thanks. The business has been asked to delete your data and will follow up.' });
  } catch (err) {
    next(err);
  }
});
