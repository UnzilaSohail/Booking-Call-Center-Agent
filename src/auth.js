import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { getDb } from './db.js';
import { verifyCompanyAdmin, LoginError } from './loginHelpers.js';
import { areasFor } from './permissions.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

export const authRouter = Router();

// Company admin login, kept as its own endpoint for direct API use (and by the unified
// /api/login in src/routes/unifiedLogin.js, which the dashboard actually calls now so
// the admin doesn't have to know or care which URL their role belongs to). There is no
// public self-signup — a platform admin registers companies via src/routes/platform.js.
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const result = await verifyCompanyAdmin(email.toLowerCase(), password);
    if (!result) return res.status(401).json({ error: 'invalid credentials' });

    const token = jwt.sign({ role: 'business', ...result }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (err) {
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Everything past this middleware gets req.businessId from the verified token —
// never from a request body/query param (that's the multi-tenant leak flagged in plan.md §7).
// Rejects a platform-admin token too (wrong role) — those are a different login entirely
// (src/platformAuth.js) and must not be usable against company-scoped routes.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
  if (payload.role !== 'business' || !payload.businessId) return res.status(401).json({ error: 'invalid token for this endpoint' });

  try {
    // Checked on every request, not just at login — otherwise a platform admin
    // suspending a company (or an owner suspending a teammate) would only stop *new*
    // logins, and any token issued before the suspension (valid up to 12h) would keep
    // working right through it.
    const db = await getDb();
    const [business, admin] = await Promise.all([
      db.collection('businesses').findOne({ _id: payload.businessId }, { projection: { status: 1 } }),
      db.collection('admins').findOne({ _id: payload.adminId }, { projection: { role: 1, permissions: 1, status: 1 } }),
    ]);
    if (business?.status === 'suspended') return res.status(403).json({ error: 'this account has been suspended — contact the platform' });
    if (!admin) return res.status(401).json({ error: 'admin not found' });
    if (admin.status === 'suspended') return res.status(403).json({ error: 'your access has been suspended — contact your business owner' });

    req.businessId = payload.businessId;
    req.adminId = payload.adminId;
    req.admin = { role: admin.role ?? 'owner', areas: areasFor(admin) };
    next();
  } catch (err) {
    next(err);
  }
}

// Gates a route to admins whose role grants the given dashboard area (src/permissions.js)
// — mount after requireAuth, which populates req.admin.
export function requireArea(area) {
  return (req, res, next) => {
    if (!req.admin?.areas.includes(area)) return res.status(403).json({ error: `you don't have access to ${area}` });
    next();
  };
}

// Admin-management (inviting/role-changing/suspending other admins) is reserved for the
// Owner specifically, not folded into the area/permission system — otherwise a `custom`
// role could grant itself the ability to create more admins by including `team` in its
// permission list.
export function requireOwner(req, res, next) {
  if (req.admin?.role !== 'owner') return res.status(403).json({ error: 'only the account owner can do this' });
  next();
}

// Who's logged in — the dashboard's greeting/sidebar footer (dashboard/app/page.jsx,
// components/Sidebar.jsx) needs this instead of decoding the JWT client-side.
authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: req.adminId }, { projection: { name: 1, email: 1 } });
    if (!admin) return res.status(404).json({ error: 'admin not found' });
    res.json({ name: admin.name ?? null, email: admin.email, role: req.admin.role, areas: req.admin.areas });
  } catch (err) {
    next(err);
  }
});

authRouter.patch('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'newPassword must be at least 8 characters' });

    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: req.adminId });
    if (!admin || !(await bcrypt.compare(currentPassword, admin.password_hash))) {
      return res.status(401).json({ error: 'current password is incorrect' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await db.collection('admins').updateOne({ _id: req.adminId }, { $set: { password_hash } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
