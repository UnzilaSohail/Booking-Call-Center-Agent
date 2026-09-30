import { Router } from 'express';
import { getDb, withTenant, serializeAll } from '../db.js';
import { requireArea, requireOwner } from '../auth.js';
import { isListingEligible, LISTING_CATEGORIES } from '../services/listingService.js';
import { validateSlug } from '../services/slug.js';

export const settingsRouter = Router();

// Applied per-route (see the comment in src/routes/services.js for why).
const gate = requireArea('settings');

settingsRouter.get('/business-hours', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { hours: 1 } });
    res.json(business?.hours ?? []);
  } catch (err) {
    next(err);
  }
});

// Full-week upsert — dashboard sends all 7 rows (or fewer, for closed days) at once.
// Embedded on the business document, so this is a single replace, not a delete+reinsert.
settingsRouter.put('/business-hours', gate, async (req, res, next) => {
  try {
    const { hours } = req.body ?? {};
    if (!Array.isArray(hours)) return res.status(400).json({ error: 'hours must be an array' });

    const normalized = hours.map((h) => ({ day_of_week: h.dayOfWeek, open_time: h.openTime, close_time: h.closeTime }));
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { hours: normalized } });
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});

// Business profile — was set once at platform-registration time (src/routes/platform.js)
// with no way to change it since. name/timezone/reschedule cutoff are the fields a
// company admin should reasonably be able to edit themselves.
settingsRouter.get('/business', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne(
      { _id: req.businessId },
      { projection: { name: 1, industry: 1, timezone: 1, phone_number: 1, reschedule_cutoff_minutes: 1, contact_email: 1, contact_phone: 1, address: 1, faqs: 1, voice_name: 1, min_booking_notice_minutes: 1, max_booking_window_days: 1, transfer_phone_number: 1, status: 1, deleted_at: 1, recording_enabled: 1, recording_retention_days: 1 } }
    );
    res.json({
      name: business.name,
      industry: business.industry ?? null,
      timezone: business.timezone,
      phoneNumber: business.phone_number ?? null,
      rescheduleCutoffMinutes: business.reschedule_cutoff_minutes,
      contactEmail: business.contact_email ?? '',
      contactPhone: business.contact_phone ?? '',
      address: business.address ?? '',
      faqs: business.faqs ?? [],
      voiceName: business.voice_name ?? null,
      minBookingNoticeMinutes: business.min_booking_notice_minutes ?? 0,
      maxBookingWindowDays: business.max_booking_window_days ?? null,
      transferPhoneNumber: business.transfer_phone_number ?? '',
      status: business.status ?? 'active',
      deletedAt: business.deleted_at ?? null,
      // ROADMAP.md §7 "Call recording" / "Recording retention settings" — recordingEnabled
      // defaults true (matches the always-on disclosure line in webhooks/twilio.js);
      // recordingRetentionDays null means "keep forever" (src/services/retentionWorker.js
      // skips a business with no value set).
      recordingEnabled: business.recording_enabled !== false,
      recordingRetentionDays: business.recording_retention_days ?? null,
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.patch('/business', gate, async (req, res, next) => {
  try {
    const { name, industry, timezone, rescheduleCutoffMinutes, contactEmail, contactPhone, address, minBookingNoticeMinutes, maxBookingWindowDays, transferPhoneNumber, recordingEnabled, recordingRetentionDays } = req.body ?? {};
    const updates = {};
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      updates.name = name;
    }
    if (industry !== undefined) updates.industry = industry || null;
    if (timezone !== undefined) {
      if (!timezone) return res.status(400).json({ error: 'timezone cannot be empty' });
      updates.timezone = timezone;
    }
    if (rescheduleCutoffMinutes !== undefined) {
      if (!Number.isFinite(rescheduleCutoffMinutes) || rescheduleCutoffMinutes < 0) {
        return res.status(400).json({ error: 'rescheduleCutoffMinutes must be zero or a positive number' });
      }
      updates.reschedule_cutoff_minutes = rescheduleCutoffMinutes;
    }
    if (contactEmail !== undefined) updates.contact_email = contactEmail || null;
    if (contactPhone !== undefined) updates.contact_phone = contactPhone || null;
    if (address !== undefined) updates.address = address || null;
    if (minBookingNoticeMinutes !== undefined) {
      if (!Number.isFinite(minBookingNoticeMinutes) || minBookingNoticeMinutes < 0) {
        return res.status(400).json({ error: 'minBookingNoticeMinutes must be zero or a positive number' });
      }
      updates.min_booking_notice_minutes = minBookingNoticeMinutes;
    }
    if (maxBookingWindowDays !== undefined) {
      if (maxBookingWindowDays !== null && (!Number.isFinite(maxBookingWindowDays) || maxBookingWindowDays <= 0)) {
        return res.status(400).json({ error: 'maxBookingWindowDays must be null (unlimited) or a positive number' });
      }
      updates.max_booking_window_days = maxBookingWindowDays;
    }
    if (transferPhoneNumber !== undefined) updates.transfer_phone_number = transferPhoneNumber || null;
    if (recordingEnabled !== undefined) updates.recording_enabled = !!recordingEnabled;
    if (recordingRetentionDays !== undefined) {
      if (recordingRetentionDays !== null && (!Number.isFinite(recordingRetentionDays) || recordingRetentionDays <= 0)) {
        return res.status(400).json({ error: 'recordingRetentionDays must be null (keep forever) or a positive number' });
      }
      updates.recording_retention_days = recordingRetentionDays;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: updates });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Self-service data export (ROADMAP.md §12 "Data export") — every tenant-scoped
// collection this business owns, as one JSON file, so a business can get its own data
// out without asking the platform. Owner-only: this is a full export of customer PII
// (names, phones, transcripts), not something any team member should be able to pull.
const EXPORT_COLLECTIONS = ['services', 'staff', 'bookings', 'customers', 'call_logs', 'failed_bookings', 'voicemails', 'callback_requests', 'staff_time_off'];

settingsRouter.get('/business/export', gate, requireOwner, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { password_hash: 0, google_refresh_token: 0 } });
    const data = await withTenant(req.businessId, async (c) => {
      const entries = await Promise.all(EXPORT_COLLECTIONS.map((name) => c(name).find({}).toArray().then((rows) => [name, serializeAll(rows)])));
      return Object.fromEntries(entries);
    });

    res.setHeader('Content-Disposition', `attachment; filename="${req.businessId}-export.json"`);
    res.json({ exportedAt: new Date().toISOString(), business, ...data });
  } catch (err) {
    next(err);
  }
});

// Self-service delete — soft, not the platform admin's hard delete
// (src/routes/platform.js DELETE /businesses/:id, which actually wipes everything). This
// just flags the business as deleted; requireAuth (src/auth.js) deliberately does NOT
// block on this status, so the admin can still log in and hit restore below. No data is
// touched, so undo is a one-field flip.
// ponytail: doesn't stop the voice agent from still answering calls while "deleted" —
// add a status check in src/webhooks/twilio.js findBusinessByPhoneNumber path if that
// matters before this ships to real users.
settingsRouter.delete('/business', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { name: 1 } });
    const { confirmName } = req.body ?? {};
    if (confirmName !== business.name) return res.status(400).json({ error: 'confirmName must exactly match the business name' });

    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { status: 'deleted', deleted_at: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

settingsRouter.post('/business/restore', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { status: 'active' }, $unset: { deleted_at: '' } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

settingsRouter.get('/business/holidays', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { holidays: 1 } });
    res.json(business?.holidays ?? []);
  } catch (err) {
    next(err);
  }
});

// Full-list upsert — same whole-array-replace pattern as PUT /business-hours.
settingsRouter.put('/business/holidays', gate, async (req, res, next) => {
  try {
    const { holidays } = req.body ?? {};
    if (!Array.isArray(holidays)) return res.status(400).json({ error: 'holidays must be an array' });
    const normalized = holidays.filter((h) => h?.date).map((h) => ({ date: h.date, name: h.name || null }));

    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { holidays: normalized } });
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});

// Directory listing opt-in (Jira 16b/16c/16j, docs/plans/PLAN_1_CUSTOMER.md §1A) — the
// owner's toggle + profile fields. `eligible`/`live` are computed, not stored: `live`
// reflects the actual opt-in rule right now, so the Settings UI can show "on, but not
// visible yet — add a service" instead of a toggle that silently does nothing.
settingsRouter.get('/business/listing', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const [business, serviceCount] = await Promise.all([
      db.collection('businesses').findOne({ _id: req.businessId }, { projection: { listing: 1, onboarding_completed_at: 1, status: 1, hours: 1, slug: 1, booking_page_enabled: 1 } }),
      db.collection('services').countDocuments({ business_id: req.businessId }),
    ]);
    const listing = business?.listing ?? {};
    const eligible = isListingEligible(business, { serviceCount });
    res.json({
      slug: business?.slug ?? null,
      bookingPageEnabled: business?.booking_page_enabled !== false,
      listed: listing.listed === true,
      hiddenByPlatform: listing.hidden_by_platform === true,
      categories: listing.categories ?? [],
      city: listing.city ?? '',
      region: listing.region ?? '',
      country: listing.country ?? '',
      description: listing.description ?? '',
      eligible,
      live: listing.listed === true && listing.hidden_by_platform !== true && eligible,
    });
  } catch (err) {
    next(err);
  }
});

const MAX_CATEGORIES = 3;

settingsRouter.put('/business/listing', gate, async (req, res, next) => {
  try {
    const { listed, categories, city, region, country, description, slug, bookingPageEnabled } = req.body ?? {};
    const updates = {};
    if (bookingPageEnabled !== undefined) updates.booking_page_enabled = !!bookingPageEnabled;
    if (slug !== undefined) {
      const slugError = validateSlug(slug);
      if (slugError) return res.status(400).json({ error: slugError });
      updates.slug = slug;
    }
    if (listed !== undefined) updates['listing.listed'] = !!listed;
    if (categories !== undefined) {
      if (!Array.isArray(categories) || categories.length > MAX_CATEGORIES || !categories.every((c) => LISTING_CATEGORIES.includes(c))) {
        return res.status(400).json({ error: `categories must be at most ${MAX_CATEGORIES} of: ${LISTING_CATEGORIES.join(', ')}` });
      }
      updates['listing.categories'] = categories;
    }
    if (city !== undefined) updates['listing.city'] = city || null;
    if (region !== undefined) updates['listing.region'] = region || null;
    if (country !== undefined) updates['listing.country'] = country || null;
    if (description !== undefined) updates['listing.description'] = description || null;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const db = await getDb();
    try {
      await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: updates });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'that booking link is already taken' });
      throw err;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Department-based transfer routing (src/voice/tools.js resolveTransferTarget) — same
// whole-array-replace pattern as PUT /business-hours / PUT /business/holidays.
settingsRouter.get('/business/transfer-departments', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { transfer_departments: 1 } });
    res.json(business?.transfer_departments ?? []);
  } catch (err) {
    next(err);
  }
});

settingsRouter.put('/business/transfer-departments', gate, async (req, res, next) => {
  try {
    const { departments } = req.body ?? {};
    if (!Array.isArray(departments)) return res.status(400).json({ error: 'departments must be an array' });
    const normalized = departments.filter((d) => d?.name && d?.phoneNumber).map((d) => ({ name: String(d.name).trim(), phoneNumber: String(d.phoneNumber).trim() }));

    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { transfer_departments: normalized } });
    res.json(normalized);
  } catch (err) {
    next(err);
  }
});
