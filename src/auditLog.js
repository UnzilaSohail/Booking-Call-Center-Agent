// Admin action trail (ROADMAP.md §12, plan.md §11 item 10) — one generic middleware
// beats instrumenting every mutating route by hand. Mounted once in app.js, right after
// the company-admin auth boundary, so it only ever sees authenticated requests.
import { getDb, newId } from './db.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Same trail for platform admins (AIN-476): one platform login can reset passwords, suspend and delete companies, so
// every change it makes is recorded: who, what path, when, from where. Mounted after requirePlatformAuth.
export function platformAuditLogger(req, res, next) {
  if (MUTATING_METHODS.has(req.method)) {
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.platformAdminId) return;
      getDb()
        .then((db) => db.collection('platform_audit_logs').insertOne({
          _id: newId(), admin_id: req.platformAdminId, method: req.method, path: req.originalUrl, status: res.statusCode, ip: req.ip, created_at: new Date(),
        }))
        .catch((err) => console.error('platform audit log write failed:', err.message));
    });
  }
  next();
}

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
