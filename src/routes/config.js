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

configRouter.patch('/staff/:id', async (req, res, next) => {
  try {
    const { name } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const updated = await withTenant(req.businessId, (c) => c('staff').findOneAndUpdate({ _id: req.params.id }, { $set: { name } }, { returnDocument: 'after' }));
    if (!updated) return res.status(404).json({ error: 'staff not found' });
    res.json(serialize(updated));
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
      { projection: { name: 1, industry: 1, timezone: 1, phone_number: 1, reschedule_cutoff_minutes: 1, contact_email: 1, contact_phone: 1, address: 1, faqs: 1, voice_name: 1 } }
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
    });
  } catch (err) {
    next(err);
  }
});

configRouter.patch('/business', async (req, res, next) => {
  try {
    const { name, industry, timezone, rescheduleCutoffMinutes, contactEmail, contactPhone, address } = req.body ?? {};
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
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: updates });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
