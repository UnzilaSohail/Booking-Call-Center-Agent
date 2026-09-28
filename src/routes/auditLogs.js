// Read side for src/auditLog.js's write-side middleware — gated the same as the rest of
// admin-configuration (requireArea('settings'), same as business hours/knowledge/etc.),
// no new dashboard area invented just for this.
import { Router } from 'express';
import { withTenant } from '../db.js';
import { requireArea } from '../auth.js';

export const auditLogsRouter = Router();
const gate = requireArea('settings');

auditLogsRouter.get('/audit-logs', gate, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const logs = await withTenant(req.businessId, (c) => c('audit_logs').find({}).sort({ created_at: -1 }).limit(limit).toArray());

    const adminIds = [...new Set(logs.map((l) => l.admin_id))];
    const admins = adminIds.length ? await withTenant(req.businessId, (c) => c('admins').find({ _id: { $in: adminIds } }).toArray()) : [];
    const adminById = Object.fromEntries(admins.map((a) => [a._id, a]));

    res.json(logs.map((l) => ({
      id: l._id,
      method: l.method,
      path: l.path,
      status: l.status,
      ip: l.ip ?? null,
      createdAt: l.created_at,
      admin: adminById[l.admin_id] ? { name: adminById[l.admin_id].name ?? null, email: adminById[l.admin_id].email } : null,
    })));
  } catch (err) {
    next(err);
  }
});
