// Admin action trail (ROADMAP.md §12, plan.md §11 item 10) — one generic middleware
// beats instrumenting every mutating route by hand. Mounted once in app.js, right after
// the company-admin auth boundary, so it only ever sees authenticated requests.
import { getDb, newId } from './db.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function auditLogger(req, res, next) {
  if (MUTATING_METHODS.has(req.method)) {
    res.on('finish', () => {
      // Only log actions that actually happened — a 4xx/5xx never changed anything.
      if (res.statusCode >= 400 || !req.businessId || !req.adminId) return;
      getDb()
        .then((db) => db.collection('audit_logs').insertOne({
          _id: newId(),
          business_id: req.businessId,
          admin_id: req.adminId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ip: req.ip,
          created_at: new Date(),
        }))
        .catch((err) => console.error('audit log write failed:', err.message));
    });
  }
  next();
}
