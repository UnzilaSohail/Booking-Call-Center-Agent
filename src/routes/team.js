import { Router } from 'express';
import { newId, withTenant, serialize, serializeAll, getDb } from '../db.js';
import { requireOwner, requireArea } from '../auth.js';
import { signInviteToken } from '../teamInvite.js';
import { sendEmail } from '../notifications/email.js';
import { AREAS } from '../permissions.js';

export const teamRouter = Router();

const ROLES = ['manager', 'receptionist', 'staff', 'billing', 'custom'];

// Applied per-route (see the comment in src/routes/services.js for why) — every route in
// this file needs the `team` area; the two admin-management ones additionally require
// requireOwner.
const gate = requireArea('team');

// --- Staff profiles / availability / services assigned (ROADMAP.md §10) ---

teamRouter.get('/staff', gate, (req, res, next) =>
  withTenant(req.businessId, (c) => c('staff').find({}).sort({ name: 1 }).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

teamRouter.post('/staff', gate, (req, res, next) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const doc = { _id: newId(), business_id: req.businessId, name, google_calendar_id: null };
  withTenant(req.businessId, (c) => c('staff').insertOne(doc))
    .then(() => res.status(201).json(serialize(doc)))
    .catch(next);
});

// hours/dailyBreak/locationId/serviceIds are all optional overrides — omitted or null
// means "follow the business default" / "offers every service" (src/services/
// bookingService.js's getAvailability only narrows business hours with these when
// staff.hours is actually set; serviceIds is a dashboard/voice-tool UI filter only, not
// a booking-time hard constraint — see ROADMAP plan's scope note).
teamRouter.patch('/staff/:id', gate, async (req, res, next) => {
  try {
    const { name, phone, hours, dailyBreak, locationId, serviceIds } = req.body ?? {};
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
    if (serviceIds !== undefined) updates.service_ids = serviceIds === null ? null : serviceIds;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const updated = await withTenant(req.businessId, (c) => c('staff').findOneAndUpdate({ _id: req.params.id }, { $set: updates }, { returnDocument: 'after' }));
    if (!updated) return res.status(404).json({ error: 'staff not found' });
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

teamRouter.get('/staff/:id/time-off', gate, (req, res, next) =>
  withTenant(req.businessId, (c) => c('staff_time_off').find({ staff_id: req.params.id }).sort({ start_time: 1 }).toArray())
    .then((rows) => res.json(serializeAll(rows)))
    .catch(next)
);

teamRouter.post('/staff/:id/time-off', gate, async (req, res, next) => {
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

teamRouter.delete('/time-off/:id', gate, async (req, res, next) => {
  try {
    const result = await withTenant(req.businessId, (c) => c('staff_time_off').deleteOne({ _id: req.params.id }));
    if (result.deletedCount === 0) return res.status(404).json({ error: 'time off entry not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

teamRouter.delete('/staff/:id', gate, async (req, res, next) => {
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

// --- Team members / roles / invitations (ROADMAP.md §10) ---

teamRouter.get('/team-members', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.collection('admins').find({ business_id: req.businessId })
      .project({ name: 1, email: 1, role: 1, status: 1, permissions: 1, created_at: 1 })
      .sort({ created_at: 1 })
      .toArray();
    res.json(rows.map((a) => serialize({ ...a, role: a.role ?? 'owner', status: a.status ?? 'active' })));
  } catch (err) {
    next(err);
  }
});

teamRouter.post('/team-members/invite', gate, requireOwner, async (req, res, next) => {
  try {
    const { name, email, role, permissions } = req.body ?? {};
    if (!name || !email || !role) return res.status(400).json({ error: 'name, email and role are required' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
    if (role === 'custom' && (!Array.isArray(permissions) || !permissions.every((p) => AREAS.includes(p)))) {
      return res.status(400).json({ error: `permissions must be an array drawn from: ${AREAS.join(', ')}` });
    }

    const db = await getDb();
    const adminId = newId();
    try {
      await db.collection('admins').insertOne({
        _id: adminId,
        business_id: req.businessId,
        name,
        email: email.toLowerCase(),
        password_hash: null,
        role,
        permissions: role === 'custom' ? permissions : undefined,
        status: 'invited',
        invited_by: req.adminId,
        invited_at: new Date(),
        invite_accepted_at: null,
        created_at: new Date(),
      });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'an account with this email already exists' });
      throw err;
    }

    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { name: 1 } });
    const link = `${process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002'}/accept-invite/${signInviteToken(adminId)}`;
    await sendEmail(email.toLowerCase(), `You're invited to join ${business.name}`, `You've been invited to join ${business.name} as a ${role}. Set your password: ${link}`);

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

teamRouter.patch('/team-members/:id', gate, requireOwner, async (req, res, next) => {
  try {
    const { role, permissions, status } = req.body ?? {};
    const db = await getDb();
    const target = await db.collection('admins').findOne({ _id: req.params.id, business_id: req.businessId });
    if (!target) return res.status(404).json({ error: 'team member not found' });
    if ((target.role ?? 'owner') === 'owner') return res.status(403).json({ error: "the owner's role can't be changed" });
    if (req.params.id === req.adminId && status === 'suspended') return res.status(400).json({ error: "you can't suspend yourself" });

    const updates = {};
    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
      if (role === 'custom' && (!Array.isArray(permissions) || !permissions.every((p) => AREAS.includes(p)))) {
        return res.status(400).json({ error: `permissions must be an array drawn from: ${AREAS.join(', ')}` });
      }
      updates.role = role;
      updates.permissions = role === 'custom' ? permissions : null;
    }
    if (status !== undefined) {
      if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
      updates.status = status;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing to update' });

    await db.collection('admins').updateOne({ _id: req.params.id }, { $set: updates });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
