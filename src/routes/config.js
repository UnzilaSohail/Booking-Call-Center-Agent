import { Router } from 'express';
import { getDb, newId, withTenant, serialize, serializeAll } from '../db.js';

export const configRouter = Router();

configRouter.get('/services', (req, res, next) =>
  withTenant(req.businessId, (c) => c('services').find({}).sort({ name: 1 }).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

configRouter.post('/services', (req, res, next) => {
  const { name, durationMinutes, bufferMinutes = 0, price } = req.body ?? {};
  // Postgres's old CHECK constraints (duration_minutes > 0, buffer_minutes >= 0) have
  // no Mongo equivalent, so this is now the only thing standing between a bad service
  // and a 0-length slotLockIds() range in src/services/bookingService.js.
  if (!name || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return res.status(400).json({ error: 'name is required and durationMinutes must be a positive number' });
  }
  if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0) {
    return res.status(400).json({ error: 'bufferMinutes must be zero or a positive number' });
  }

  const doc = {
    _id: newId(),
    business_id: req.businessId,
    name,
    duration_minutes: durationMinutes,
    buffer_minutes: bufferMinutes,
    price: price ?? null,
  };
  withTenant(req.businessId, (c) => c('services').insertOne(doc))
    .then(() => res.status(201).json(serialize(doc)))
    .catch(next);
});

configRouter.patch('/services/:id', async (req, res, next) => {
  try {
    const { name, durationMinutes, bufferMinutes, price } = req.body ?? {};
    const updates = {};
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      updates.name = name;
    }
    if (durationMinutes !== undefined) {
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return res.status(400).json({ error: 'durationMinutes must be a positive number' });
      updates.duration_minutes = durationMinutes;
    }
    if (bufferMinutes !== undefined) {
      if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0) return res.status(400).json({ error: 'bufferMinutes must be zero or a positive number' });
      updates.buffer_minutes = bufferMinutes;
    }
    if (price !== undefined) updates.price = price;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const updated = await withTenant(req.businessId, (c) => c('services').findOneAndUpdate({ _id: req.params.id }, { $set: updates }, { returnDocument: 'after' }));
    if (!updated) return res.status(404).json({ error: 'service not found' });
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

configRouter.delete('/services/:id', async (req, res, next) => {
  try {
    // Refuse to orphan a booking that's still relying on this service — the admin has
    // to cancel or reassign those first, rather than the system silently doing it for them.
    const futureBooking = await withTenant(req.businessId, (c) =>
      c('bookings').findOne({ service_id: req.params.id, status: 'confirmed', start_time: { $gt: new Date() } })
    );
    if (futureBooking) return res.status(409).json({ error: 'this service has upcoming bookings — cancel or reschedule them first' });

    const result = await withTenant(req.businessId, (c) => c('services').deleteOne({ _id: req.params.id }));
    if (result.deletedCount === 0) return res.status(404).json({ error: 'service not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

configRouter.get('/staff', (req, res, next) =>
  withTenant(req.businessId, (c) => c('staff').find({}).sort({ name: 1 }).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

configRouter.post('/staff', (req, res, next) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const doc = { _id: newId(), business_id: req.businessId, name, google_calendar_id: null };
  withTenant(req.businessId, (c) => c('staff').insertOne(doc))
    .then(() => res.status(201).json(serialize(doc)))
    .catch(next);
});

// hours/dailyBreak/locationId are all optional overrides — omitted or null means "follow
// the business default" (src/services/bookingService.js's getAvailability only narrows
// business hours with these when staff.hours is actually set).
configRouter.patch('/staff/:id', async (req, res, next) => {
  try {
    const { name, phone, hours, dailyBreak, locationId } = req.body ?? {};
    const updates = {};
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: 'name is required' });
      updates.name = name;
    }
    if (phone !== undefined) updates.phone = phone || null;
    if (hours !== undefined) {
      updates.hours = hours === null ? null : hours.map((h) => ({ day_of_week: h.dayOfWeek, open_time: h.openTime, close_time: h.closeTime }));
    }
    if (dailyBreak !== undefined) {
      updates.daily_break = dailyBreak === null ? null : { start_time: dailyBreak.startTime, end_time: dailyBreak.endTime };
    }
    if (locationId !== undefined) updates.location_id = locationId || null;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const updated = await withTenant(req.businessId, (c) => c('staff').findOneAndUpdate({ _id: req.params.id }, { $set: updates }, { returnDocument: 'after' }));
    if (!updated) return res.status(404).json({ error: 'staff not found' });
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

configRouter.get('/staff/:id/time-off', (req, res, next) =>
  withTenant(req.businessId, (c) => c('staff_time_off').find({ staff_id: req.params.id }).sort({ start_time: 1 }).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

configRouter.post('/staff/:id/time-off', async (req, res, next) => {
  try {
    const { startTime, endTime, reason } = req.body ?? {};
    if (!startTime || !endTime) return res.status(400).json({ error: 'startTime and endTime are required' });
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: 'startTime/endTime must be valid, with endTime after startTime' });
    }

    const doc = { _id: newId(), business_id: req.businessId, staff_id: req.params.id, start_time: start, end_time: end, reason: reason || null, created_at: new Date() };
    await withTenant(req.businessId, (c) => c('staff_time_off').insertOne(doc));
    res.status(201).json(serialize(doc));
  } catch (err) {
    next(err);
  }
});

configRouter.delete('/time-off/:id', async (req, res, next) => {
  try {
    const result = await withTenant(req.businessId, (c) => c('staff_time_off').deleteOne({ _id: req.params.id }));
    if (result.deletedCount === 0) return res.status(404).json({ error: 'time off entry not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

configRouter.delete('/staff/:id', async (req, res, next) => {
  try {
    const futureBooking = await withTenant(req.businessId, (c) =>
      c('bookings').findOne({ staff_id: req.params.id, status: 'confirmed', start_time: { $gt: new Date() } })
    );
    if (futureBooking) return res.status(409).json({ error: 'this staff member has upcoming bookings — cancel or reschedule them first' });

    const result = await withTenant(req.businessId, (c) => c('staff').deleteOne({ _id: req.params.id }));
    if (result.deletedCount === 0) return res.status(404).json({ error: 'staff not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

configRouter.get('/business-hours', async (req, res, next) => {
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
configRouter.put('/business-hours', async (req, res, next) => {
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
configRouter.get('/business', async (req, res, next) => {
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

configRouter.patch('/business', async (req, res, next) => {
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

configRouter.get('/business/holidays', async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { holidays: 1 } });
    res.json(business?.holidays ?? []);
  } catch (err) {
    next(err);
  }
});

// Full-list upsert — same whole-array-replace pattern as PUT /business-hours.
configRouter.put('/business/holidays', async (req, res, next) => {
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
configRouter.get('/business/transfer-departments', async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { transfer_departments: 1 } });
    res.json(business?.transfer_departments ?? []);
  } catch (err) {
    next(err);
  }
});

configRouter.put('/business/transfer-departments', async (req, res, next) => {
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
