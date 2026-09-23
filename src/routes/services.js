import { Router } from 'express';
import { newId, withTenant, serialize, serializeAll } from '../db.js';
import { requireArea } from '../auth.js';

export const servicesRouter = Router();

// Applied per-route, not as a router-wide router.use() — every one of these route
// modules is mounted at the shared '/api' prefix in app.js (not its own sub-prefix), so
// Express dispatches into EVERY such router for EVERY /api/* request regardless of
// which one actually owns the path; a router-level .use() middleware fires unconditionally
// the moment the router is entered, before its own routes get a chance to (not) match.
// Gating per-route is what actually scopes the check to requests this router will serve.
const gate = requireArea('services');

servicesRouter.get('/services', gate, (req, res, next) =>
  withTenant(req.businessId, (c) => c('services').find({}).sort({ name: 1 }).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

servicesRouter.post('/services', gate, (req, res, next) => {
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

servicesRouter.patch('/services/:id', gate, async (req, res, next) => {
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

servicesRouter.delete('/services/:id', gate, async (req, res, next) => {
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
