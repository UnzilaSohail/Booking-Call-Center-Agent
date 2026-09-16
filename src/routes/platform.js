// Company registration, gated behind a platform admin (src/platformAuth.js). This is
// what used to be the public POST /api/auth/signup — moved here and locked down per
// the product decision that companies don't register themselves.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, newId } from '../db.js';

export const platformRouter = Router();

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mounted at /api/platform (behind requirePlatformAuth) in app.js.
platformRouter.get('/businesses', async (req, res, next) => {
  try {
    const db = await getDb();
    const filter = req.query.q ? { name: { $regex: escapeRegex(req.query.q), $options: 'i' } } : {};
    const businesses = await db.collection('businesses')
      .find(filter, { projection: { name: 1, timezone: 1, phone_number: 1, created_at: 1, status: 1 } })
      .sort({ created_at: -1 })
      .toArray();

    // One aggregation instead of an N+1 count-per-business query.
    const counts = await db.collection('bookings').aggregate([
      { $match: { status: 'confirmed', start_time: { $gt: new Date() } } },
      { $group: { _id: '$business_id', count: { $sum: 1 } } },
    ]).toArray();
    const upcomingByBusiness = Object.fromEntries(counts.map((c) => [c._id, c.count]));

    res.json(businesses.map((b) => ({
      id: b._id, name: b.name, timezone: b.timezone, phoneNumber: b.phone_number ?? null,
      createdAt: b.created_at, upcomingBookings: upcomingByBusiness[b._id] ?? 0,
      status: b.status || 'active',
    })));
  } catch (err) {
    next(err);
  }
});

// Full detail for one company — profile, admins (so a locked-out admin's password can
// be reset), and quick counts. Everything the platform admin needs without having to
// impersonate the company's own login.
platformRouter.get('/businesses/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.params.id });
    if (!business) return res.status(404).json({ error: 'company not found' });

    const [admins, serviceCount, staffCount, upcomingBookings] = await Promise.all([
      db.collection('admins').find({ business_id: business._id }, { projection: { name: 1, email: 1, created_at: 1 } }).toArray(),
      db.collection('services').countDocuments({ business_id: business._id }),
      db.collection('staff').countDocuments({ business_id: business._id }),
      db.collection('bookings').countDocuments({ business_id: business._id, status: 'confirmed', start_time: { $gt: new Date() } }),
    ]);

    res.json({
      id: business._id,
      name: business.name,
      timezone: business.timezone,
      phoneNumber: business.phone_number ?? null,
      contactEmail: business.contact_email ?? null,
      contactPhone: business.contact_phone ?? null,
      address: business.address ?? null,
      status: business.status || 'active',
      calendarConnected: business.google_refresh_token != null,
      createdAt: business.created_at,
      admins: admins.map((a) => ({ id: a._id, name: a.name, email: a.email, createdAt: a.created_at })),
      serviceCount, staffCount, upcomingBookings,
    });
  } catch (err) {
    next(err);
  }
});

// Suspend a company to block its admin(s) from logging in (src/auth.js checks this at
// login) without deleting any of its data — for billing/abuse holds, not churn.
platformRouter.patch('/businesses/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body ?? {};
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: "status must be 'active' or 'suspended'" });

    const db = await getDb();
    const result = await db.collection('businesses').updateOne({ _id: req.params.id }, { $set: { status } });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'company not found' });
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// Reset a company admin's password without needing their old one — the actual point of
// this being a platform-admin action rather than the self-service change in src/auth.js.
platformRouter.patch('/admins/:adminId/password', async (req, res, next) => {
  try {
    const { newPassword } = req.body ?? {};
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'newPassword must be at least 8 characters' });

    const db = await getDb();
    const password_hash = await bcrypt.hash(newPassword, 10);
    const result = await db.collection('admins').updateOne({ _id: req.params.adminId }, { $set: { password_hash } });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'admin not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Platform-wide booking search — the same "someone calls asking about their
// appointment" lookup as the per-company Bookings page (src/services/bookingService.js
// listBookings), just across every company at once with a Company column added.
platformRouter.get('/bookings', async (req, res, next) => {
  try {
    const { q, status } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (q) {
      const pattern = escapeRegex(q);
      filter.$or = [{ customer_name: { $regex: pattern, $options: 'i' } }, { phone: { $regex: pattern, $options: 'i' } }];
    }

    const db = await getDb();
    const bookings = await db.collection('bookings')
      .find(filter)
      .sort({ start_time: -1 })
      .limit(300)
      .toArray();

    const businessIds = [...new Set(bookings.map((b) => b.business_id))];
    const serviceIds = [...new Set(bookings.map((b) => b.service_id))];
    const [businesses, services] = await Promise.all([
      db.collection('businesses').find({ _id: { $in: businessIds } }, { projection: { name: 1 } }).toArray(),
      db.collection('services').find({ _id: { $in: serviceIds } }, { projection: { name: 1 } }).toArray(),
    ]);
    const businessNameById = Object.fromEntries(businesses.map((b) => [b._id, b.name]));
    const serviceNameById = Object.fromEntries(services.map((s) => [s._id, s.name]));

    res.json(bookings.map((b) => ({
      id: b._id, customerName: b.customer_name, phone: b.phone, startTime: b.start_time,
      status: b.status, createdVia: b.created_via,
      companyName: businessNameById[b.business_id] ?? 'Unknown company',
      serviceName: serviceNameById[b.service_id] ?? null,
    })));
  } catch (err) {
    next(err);
  }
});

// Platform-wide call log feed — same shape as the per-company Calls page
// (src/services/callLogService.js) with a Company column added.
platformRouter.get('/call-logs', async (req, res, next) => {
  try {
    const db = await getDb();
    const logs = await db.collection('call_logs').find({}).sort({ created_at: -1 }).limit(300).toArray();

    const businessIds = [...new Set(logs.map((l) => l.business_id))];
    const bookingIds = [...new Set(logs.map((l) => l.booking_id).filter(Boolean))];
    const [businesses, bookings] = await Promise.all([
      db.collection('businesses').find({ _id: { $in: businessIds } }, { projection: { name: 1 } }).toArray(),
      bookingIds.length ? db.collection('bookings').find({ _id: { $in: bookingIds } }).toArray() : [],
    ]);
    const businessNameById = Object.fromEntries(businesses.map((b) => [b._id, b.name]));
    const bookingById = Object.fromEntries(bookings.map((b) => [b._id, b]));

    res.json(logs.map((l) => {
      const booking = l.booking_id ? bookingById[l.booking_id] : null;
      return {
        id: l._id, phone: l.phone, outcome: l.outcome, transcript: l.transcript, createdAt: l.created_at,
        companyName: businessNameById[l.business_id] ?? 'Unknown company',
        booking: booking ? { customerName: booking.customer_name, startTime: booking.start_time } : null,
      };
    }));
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/stats', async (req, res, next) => {
  try {
    const db = await getDb();
    const [totalCompanies, totalUpcomingBookings] = await Promise.all([
      db.collection('businesses').countDocuments({}),
      db.collection('bookings').countDocuments({ status: 'confirmed', start_time: { $gt: new Date() } }),
    ]);
    res.json({ totalCompanies, totalUpcomingBookings });
  } catch (err) {
    next(err);
  }
});

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// (current - previous) / previous, as a rounded percent. previous === 0 is treated as
// "no baseline" rather than a division by zero — a bare 100% would be misleading when
// the previous period was simply empty (e.g. a brand-new platform).
function trendPct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// Platform-wide analytics for the Overview dashboard: booking volume + trend vs the
// prior 30-day window, daily booking activity, voice-agent call performance, the
// upcoming-bookings feed, and a top-companies leaderboard — everything the Overview
// page (dashboard/app/platform/page.jsx) renders, all real aggregates, no invented
// metrics (no "avg response time" / "escalations" — this system doesn't track those).
platformRouter.get('/analytics', async (req, res, next) => {
  try {
    const db = await getDb();
    const now = new Date();
    const trendStart = daysAgo(29); // current window: last 30 days including today
    const prevWindowStart = daysAgo(59); // previous window: the 30 days before that

    const [
      statusCounts, signupRows, prevSignupCount, bookingWindowRows, dailyActivityRows,
      callWindowRows, upcomingBookings, topCompanies,
    ] = await Promise.all([
      db.collection('businesses').aggregate([
        { $group: { _id: { $ifNull: ['$status', 'active'] }, count: { $sum: 1 } } },
      ]).toArray(),

      db.collection('businesses').aggregate([
        { $match: { created_at: { $gte: trendStart } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      db.collection('businesses').countDocuments({ created_at: { $gte: prevWindowStart, $lt: trendStart } }),

      // Bookings placed in the current vs previous 30-day window, split by their
      // (current) status — powers the "Total/Confirmed/Cancelled" stat cards.
      db.collection('bookings').aggregate([
        { $match: { created_at: { $gte: prevWindowStart } } },
        { $group: {
          _id: { period: { $cond: [{ $gte: ['$created_at', trendStart] }, 'current', 'previous'] }, status: '$status' },
          count: { $sum: 1 },
        } },
      ]).toArray(),

      // Same 30-day window, broken out per day per status — the "Booking activity" chart.
      db.collection('bookings').aggregate([
        { $match: { created_at: { $gte: trendStart } } },
        { $group: {
          _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, status: '$status' },
          count: { $sum: 1 },
        } },
      ]).toArray(),

      // Voice-agent call performance, current vs previous 30-day window.
      db.collection('call_logs').aggregate([
        { $match: { created_at: { $gte: prevWindowStart } } },
        { $group: {
          _id: { $cond: [{ $gte: ['$created_at', trendStart] }, 'current', 'previous'] },
          total: { $sum: 1 },
          booked: { $sum: { $cond: [{ $ne: ['$booking_id', null] }, 1, 0] } },
          transferred: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$outcome', ''] }, regex: /^transferred/ } }, 1, 0] } },
        } },
      ]).toArray(),

      db.collection('bookings').aggregate([
        { $match: { status: 'confirmed', start_time: { $gt: now } } },
        { $sort: { start_time: 1 } },
        { $limit: 8 },
        { $lookup: { from: 'businesses', localField: 'business_id', foreignField: '_id', as: 'business' } },
        { $unwind: '$business' },
        { $lookup: { from: 'services', localField: 'service_id', foreignField: '_id', as: 'service' } },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $project: {
          _id: 1, customerName: '$customer_name', customerEmail: '$customer_email', phone: 1,
          startTime: '$start_time', createdVia: '$created_via',
          companyName: '$business.name', serviceName: '$service.name', durationMinutes: '$service.duration_minutes',
        } },
      ]).toArray(),

      // Leaderboard by actual activity (bookings placed in the last 30 days), not just
      // future bookings on the calendar — a quieter-but-real distinction from before.
      db.collection('bookings').aggregate([
        { $match: { created_at: { $gte: trendStart } } },
        { $group: { _id: '$business_id', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'businesses', localField: '_id', foreignField: '_id', as: 'business' } },
        { $unwind: '$business' },
        { $project: { _id: 0, id: '$business._id', name: '$business.name', count: 1 } },
      ]).toArray(),
    ]);

    const byStatus = Object.fromEntries(statusCounts.map((r) => [r._id, r.count]));
    const signupsByDate = Object.fromEntries(signupRows.map((r) => [r._id, r.count]));
    const currentSignups = signupRows.reduce((sum, r) => sum + r.count, 0);
    const signups = [];
    for (let i = 29; i >= 0; i--) {
      const d = daysAgo(i);
      const key = d.toISOString().slice(0, 10);
      signups.push({ date: key, count: signupsByDate[key] ?? 0 });
    }

    // bookingWindowRows -> { current: {confirmed, cancelled}, previous: {confirmed, cancelled} }
    const byPeriod = { current: {}, previous: {} };
    for (const r of bookingWindowRows) byPeriod[r._id.period][r._id.status] = r.count;
    const curConfirmed = byPeriod.current.confirmed ?? 0, curCancelled = byPeriod.current.cancelled ?? 0;
    const prevConfirmed = byPeriod.previous.confirmed ?? 0, prevCancelled = byPeriod.previous.cancelled ?? 0;
    const curTotal = curConfirmed + curCancelled, prevTotal = prevConfirmed + prevCancelled;

    // dailyActivityRows -> [{date, confirmed, cancelled}] for the last 30 days, zero-filled.
    const activityByDate = {};
    for (const r of dailyActivityRows) {
      const { date, status } = r._id;
      activityByDate[date] ??= { confirmed: 0, cancelled: 0 };
      if (status === 'confirmed' || status === 'cancelled') activityByDate[date][status] = r.count;
    }
    const dailyActivity = [];
    for (let i = 29; i >= 0; i--) {
      const key = daysAgo(i).toISOString().slice(0, 10);
      dailyActivity.push({ date: key, confirmed: activityByDate[key]?.confirmed ?? 0, cancelled: activityByDate[key]?.cancelled ?? 0 });
    }

    const callsByPeriod = Object.fromEntries(callWindowRows.map((r) => [r._id, r]));
    const curCalls = callsByPeriod.current ?? { total: 0, booked: 0, transferred: 0 };
    const prevCalls = callsByPeriod.previous ?? { total: 0, booked: 0, transferred: 0 };

    res.json({
      totalCompanies: (byStatus.active ?? 0) + (byStatus.suspended ?? 0),
      activeCompanies: byStatus.active ?? 0,
      suspendedCompanies: byStatus.suspended ?? 0,
      companiesTrendPct: trendPct(currentSignups, prevSignupCount),
      signups,
      bookings: {
        total: { current: curTotal, trendPct: trendPct(curTotal, prevTotal) },
        confirmed: { current: curConfirmed, trendPct: trendPct(curConfirmed, prevConfirmed) },
        cancelled: { current: curCancelled, trendPct: trendPct(curCancelled, prevCancelled) },
      },
      dailyActivity,
      calls: {
        handled: { current: curCalls.total, trendPct: trendPct(curCalls.total, prevCalls.total) },
        booked: { current: curCalls.booked, trendPct: trendPct(curCalls.booked, prevCalls.booked) },
        transferred: { current: curCalls.transferred, trendPct: trendPct(curCalls.transferred, prevCalls.transferred) },
        conversionRate: curCalls.total > 0 ? Math.round((curCalls.booked / curCalls.total) * 100) : null,
      },
      upcomingBookings,
      topCompanies,
    });
  } catch (err) {
    next(err);
  }
});

function normalizeHours(hours) {
  if (!Array.isArray(hours)) return [];
  return hours
    .filter((h) => h && h.dayOfWeek !== undefined && h.openTime && h.closeTime)
    .map((h) => ({ day_of_week: Number(h.dayOfWeek), open_time: h.openTime, close_time: h.closeTime }));
}

function validateServices(services) {
  if (!Array.isArray(services)) return { docs: [] };
  const docs = [];
  for (const s of services) {
    if (!s?.name) continue; // skip a fully-blank row the form left behind
    const durationMinutes = Number(s.durationMinutes);
    const bufferMinutes = Number.isFinite(Number(s.bufferMinutes)) ? Number(s.bufferMinutes) : 0;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return { error: `service "${s.name}" needs a positive duration` };
    }
    if (bufferMinutes < 0) return { error: `service "${s.name}" has a negative buffer` };
    docs.push({ name: s.name, duration_minutes: durationMinutes, buffer_minutes: bufferMinutes, price: s.price ? Number(s.price) : null });
  }
  return { docs };
}

function validateFaqs(faqs) {
  if (!Array.isArray(faqs)) return [];
  return faqs
    .filter((f) => f?.question && f?.answer)
    .map((f) => ({ question: String(f.question).trim(), answer: String(f.answer).trim() }));
}

// Registers a company with everything it needs to start taking calls immediately —
// not just a bare account. Platform admin does this on the company's behalf since the
// company has no logged-in session yet to call the (requireAuth-gated) company routes
// itself (src/routes/config.js) — so this single endpoint seeds businesses/admins/
// services directly, all scoped to the new business_id, no separate follow-up calls needed.
platformRouter.post('/businesses', async (req, res, next) => {
  const {
    businessName, timezone, adminName, adminEmail, adminPassword,
    contactEmail, contactPhone, address, hours, services, faqs,
  } = req.body ?? {};
  if (!businessName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'businessName, adminEmail and adminPassword are required' });
  }

  const { docs: serviceDocs, error: serviceError } = validateServices(services);
  if (serviceError) return res.status(400).json({ error: serviceError });

  try {
    const db = await getDb();
    const businessId = newId();
    await db.collection('businesses').insertOne({
      _id: businessId,
      name: businessName,
      timezone: timezone || 'UTC',
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      address: address || null,
      status: 'active',
      // phone_number intentionally omitted until provisioned (routes/phoneNumber.js) —
      // the unique index only constrains documents where it's an actual string
      // (db/schema.js), so this must stay absent, not null.
      google_refresh_token: null,
      google_calendar_id: 'primary',
      reschedule_cutoff_minutes: 120,
      hours: normalizeHours(hours),
      // FAQ entries the voice agent can answer from directly (src/voice/geminiSession.js)
      // — "do you take walk-ins," "where do you park," whatever a caller asks that isn't
      // a booking action.
      faqs: validateFaqs(faqs),
      created_at: new Date(),
      registered_by_platform_admin_id: req.platformAdminId,
    });

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    try {
      await db.collection('admins').insertOne({
        _id: newId(),
        business_id: businessId,
        name: adminName || null,
        email: adminEmail.toLowerCase(),
        password_hash: passwordHash,
        created_at: new Date(),
      });
    } catch (err) {
      // No cross-collection transaction for a multi-insert registration — clean up by
      // hand on the one failure mode that matters: the admin email is already taken.
      await db.collection('businesses').deleteOne({ _id: businessId });
      if (err.code === 11000) return res.status(409).json({ error: 'admin email already registered' });
      throw err;
    }

    if (serviceDocs.length > 0) {
      await db.collection('services').insertMany(
        serviceDocs.map((s) => ({ _id: newId(), business_id: businessId, ...s }))
      );
    }

    res.status(201).json({ businessId });
  } catch (err) {
    next(err);
  }
});
