// Location records — address/contact display only for this MVP (see plan: call routing
// stays business-level, one Twilio number per business). Same CRUD shape as
// services/staff in routes/config.js.
import { Router } from 'express';
import { newId, withTenant, serialize, serializeAll } from '../db.js';
import { requireArea } from '../auth.js';

export const locationsRouter = Router();

// Applied per-route (see the comment in src/routes/services.js for why).
const gate = requireArea('settings');

locationsRouter.get('/locations', gate, (req, res, next) =>
  withTenant(req.businessId, (c) => c('locations').find({}).sort({ is_primary: -1, name: 1 }).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

locationsRouter.post('/locations', gate, (req, res, next) => {
  const { name, address, contactPhone } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const doc = { _id: newId(), business_id: req.businessId, name, address: address || null, contact_phone: contactPhone || null, is_primary: false, created_at: new Date() };
  withTenant(req.businessId, (c) => c('locations').insertOne(doc))
    .then(() => res.status(201).json(serialize(doc)))
    .catch(next);
});

locationsRouter.patch('/locations/:id', gate, async (req, res, next) => {
  try {
    const { name, address, contactPhone } = req.body ?? {};
    const updates = {};
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      updates.name = name;
    }
    if (address !== undefined) updates.address = address || null;
    if (contactPhone !== undefined) updates.contact_phone = contactPhone || null;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const updated = await withTenant(req.businessId, (c) => c('locations').findOneAndUpdate({ _id: req.params.id }, { $set: updates }, { returnDocument: 'after' }));
    if (!updated) return res.status(404).json({ error: 'location not found' });
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

locationsRouter.delete('/locations/:id', gate, async (req, res, next) => {
  try {
    const result = await withTenant(req.businessId, (c) => c('locations').deleteOne({ _id: req.params.id }));
    if (result.deletedCount === 0) return res.status(404).json({ error: 'location not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
