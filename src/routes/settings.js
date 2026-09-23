import { Router } from 'express';
import { getDb } from '../db.js';
import { requireArea } from '../auth.js';

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
      { projection: { name: 1, industry: 1, timezone: 1, phone_number: 1, reschedule_cutoff_minutes: 1, contact_email: 1, contact_phone: 1, address: 1, faqs: 1, voice_name: 1, min_booking_notice_minutes: 1, max_booking_window_days: 1, transfer_phone_number: 1 } }
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
    });
  } catch (err) {
    next(err);
  }
});

settingsRouter.patch('/business', gate, async (req, res, next) => {
  try {
    const { name, industry, timezone, rescheduleCutoffMinutes, contactEmail, contactPhone, address, minBookingNoticeMinutes, maxBookingWindowDays, transferPhoneNumber } = req.body ?? {};
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
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: updates });
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
