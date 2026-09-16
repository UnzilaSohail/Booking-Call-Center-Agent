// Platform-admin auth: a level above company admins (src/auth.js). Platform admins
// register companies (src/routes/platform.js) — there's no public signup for either
// role anymore, since companies are meant to be admin-registered, not self-service.
// There's also no public way to create a platform admin — see scripts/createPlatformAdmin.js.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { getDb } from './db.js';
import { verifyPlatformAdmin } from './loginHelpers.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

export const platformAuthRouter = Router();

// Mounted at /api/platform in app.js, so this is /api/platform/auth/login. Kept as its
// own endpoint for direct API use; the dashboard itself calls the unified /api/login
// (src/routes/unifiedLogin.js) so an admin never has to know their own role up front.
platformAuthRouter.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const result = await verifyPlatformAdmin(email.toLowerCase(), password);
    if (!result) return res.status(401).json({ error: 'invalid credentials' });

    const token = jwt.sign({ role: 'platform', ...result }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// Mounted at /api/platform, behind requirePlatformAuth — /api/platform/auth/me. Lets the
// dashboard show who's actually logged in (sidebar footer) without decoding the JWT
// client-side. platform_admins has no display name field, so the email is the identity.
platformAuthRouter.get('/auth/me', requirePlatformAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const admin = await db.collection('platform_admins').findOne({ _id: req.platformAdminId }, { projection: { email: 1 } });
    if (!admin) return res.status(404).json({ error: 'admin not found' });
    res.json({ email: admin.email });
  } catch (err) {
    next(err);
  }
});

export function requirePlatformAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'platform') return res.status(401).json({ error: 'invalid token for this endpoint' });
    req.platformAdminId = payload.platformAdminId;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

// Mounted at /api/platform, behind requirePlatformAuth in app.js — /api/platform/auth/password.
platformAuthRouter.patch('/auth/password', requirePlatformAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'newPassword must be at least 8 characters' });

    const db = await getDb();
    const admin = await db.collection('platform_admins').findOne({ _id: req.platformAdminId });
    if (!admin || !(await bcrypt.compare(currentPassword, admin.password_hash))) {
      return res.status(401).json({ error: 'current password is incorrect' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await db.collection('platform_admins').updateOne({ _id: req.platformAdminId }, { $set: { password_hash } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
