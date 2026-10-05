import { blocked, fail, forgive, loginBlocked, loginFailed, loginSucceeded } from './rateLimit.js';
import { notifyLockout } from './lockoutNotice.js';
import { checkPassword } from './passwordPolicy.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { getDb } from './db.js';
import { verifyCompanyAdmin, LoginError } from './loginHelpers.js';
import { areasFor } from './permissions.js';
import { generateSecret, verifyTotp, otpauthUrl } from './mfa.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set');

export const authRouter = Router();

// Second factor (ROADMAP.md §12, plan.md §11 item 9) — issued in place of a real token
// when verifyCompanyAdmin reports mfaEnabled, redeemed at POST /mfa/verify-login below.
// Short-lived: it's only good for completing the login that just started.
function signMfaToken(adminId, businessId) {
  return jwt.sign({ role: 'mfa_pending', adminId, businessId }, JWT_SECRET, { expiresIn: '5m' });
}
function signSessionToken(adminId, businessId) {
  return jwt.sign({ role: 'business', adminId, businessId }, JWT_SECRET, { expiresIn: '12h' });
}

// Company admin login, kept as its own endpoint for direct API use (and by the unified
// /api/login in src/routes/unifiedLogin.js, which the dashboard actually calls now so
// the admin doesn't have to know or care which URL their role belongs to). There is no
// public self-signup — a platform admin registers companies via src/routes/platform.js.
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return res.status(400).json({ error: 'email and password are required' });
    const id = email.toLowerCase();
    if (await loginBlocked(req.ip, id)) return res.status(429).json({ error: 'too many failed attempts, try again in 15 minutes' });

    const result = await verifyCompanyAdmin(id, password, req.ip);
    if (!result) { if (await loginFailed(req.ip, id)) notifyLockout(id); return res.status(401).json({ error: 'invalid credentials' }); }
    await loginSucceeded(id);

    if (result.mfaEnabled) return res.json({ mfaRequired: true, mfaToken: signMfaToken(result.adminId, result.businessId) });
    res.json({ token: signSessionToken(result.adminId, result.businessId) });
  } catch (err) {
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Second step of an MFA-gated login — exchanges the short-lived mfaToken from /login
// plus a live TOTP code for a real session token.
authRouter.post('/mfa/verify-login', async (req, res, next) => {
  try {
    const { mfaToken, code } = req.body ?? {};
    if (!mfaToken || !code) return res.status(400).json({ error: 'mfaToken and code are required' });

    let payload;
    try {
      payload = jwt.verify(mfaToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'invalid or expired login — please log in again' });
    }
    if (payload.role !== 'mfa_pending') return res.status(401).json({ error: 'invalid token for this endpoint' });

    // 6-digit codes can be guessed, so wrong ones are counted per admin: 6 in 15 minutes locks the second step.
    const mfaKey = `mfa:${payload.adminId}`;
    if (await blocked(mfaKey, 6)) return res.status(429).json({ error: 'too many wrong codes, log in again in 15 minutes' });
    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: payload.adminId });
    if (!admin?.mfa_enabled || !verifyTotp(admin.mfa_secret, String(code))) { await fail(mfaKey, 15 * 60_000); return res.status(401).json({ error: 'invalid code' }); }
    await forgive(mfaKey);

    res.json({ token: signSessionToken(payload.adminId, payload.businessId) });
  } catch (err) {
    next(err);
  }
});

// Thrown by resolveSessionFromToken below so callers can map each case to the right
// HTTP status without string-matching a generic Error's message.
export class SessionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The actual verify-token-to-session logic, as a plain function instead of middleware —
// reused by requireAuth below (the normal Authorization-header flow) and by any route a
// browser element hits without custom headers (e.g. an <audio>/<img> src, which can't
// carry a Bearer header — src/routes/callLogs.js's recording proxy is the first of these).
export async function resolveSessionFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    throw new SessionError(401, 'invalid or expired token');
  }
  if (payload.role !== 'business' || !payload.businessId) throw new SessionError(401, 'invalid token for this endpoint');

  // Checked on every request, not just at login — otherwise a platform admin suspending
  // a company (or an owner suspending a teammate) would only stop *new* logins, and any
  // token issued before the suspension (valid up to 12h) would keep working right through it.
  const db = await getDb();
  const [business, admin] = await Promise.all([
    db.collection('businesses').findOne({ _id: payload.businessId }, { projection: { status: 1 } }),
    db.collection('admins').findOne({ _id: payload.adminId }, { projection: { role: 1, permissions: 1, status: 1 } }),
  ]);
  if (business?.status === 'suspended') throw new SessionError(403, 'this account has been suspended — contact the platform');
  if (!admin) throw new SessionError(401, 'admin not found');
  if (admin.status === 'suspended') throw new SessionError(403, 'your access has been suspended — contact your business owner');

  return { businessId: payload.businessId, adminId: payload.adminId, admin: { role: admin.role ?? 'owner', areas: areasFor(admin) } };
}

// Everything past this middleware gets req.businessId from the verified token —
// never from a request body/query param (that's the multi-tenant leak flagged in plan.md §7).
// Rejects a platform-admin token too (wrong role) — those are a different login entirely
// (src/platformAuth.js) and must not be usable against company-scoped routes.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  try {
    const session = await resolveSessionFromToken(token);
    req.businessId = session.businessId;
    req.adminId = session.adminId;
    req.admin = session.admin;
    next();
  } catch (err) {
    if (err instanceof SessionError) return res.status(err.status).json({ error: err.message });
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
    const admin = await db.collection('admins').findOne({ _id: req.adminId }, { projection: { name: 1, email: 1, mfa_enabled: 1 } });
    if (!admin) return res.status(404).json({ error: 'admin not found' });
    res.json({ name: admin.name ?? null, email: admin.email, role: req.admin.role, areas: req.admin.areas, mfaEnabled: !!admin.mfa_enabled });
  } catch (err) {
    next(err);
  }
});

authRouter.patch('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    const weak = checkPassword(newPassword);
    if (weak) return res.status(400).json({ error: weak });

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

// MFA enrollment: generates a secret and stores it *pending* (mfa_enabled stays false)
// until /mfa/enroll/confirm proves the admin actually captured it in an authenticator app
// — otherwise a dropped response here would lock the admin out with a secret they never saw.
authRouter.post('/mfa/enroll', requireAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: req.adminId }, { projection: { email: 1 } });
    const secret = generateSecret();
    await db.collection('admins').updateOne({ _id: req.adminId }, { $set: { mfa_secret_pending: secret } });
    res.json({ secret, otpauthUrl: otpauthUrl(admin.email, 'Booking', secret) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/mfa/enroll/confirm', requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body ?? {};
    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: req.adminId }, { projection: { mfa_secret_pending: 1 } });
    if (!admin?.mfa_secret_pending) return res.status(400).json({ error: 'no MFA enrollment in progress — call /mfa/enroll first' });
    if (!verifyTotp(admin.mfa_secret_pending, code)) return res.status(401).json({ error: 'invalid code' });

    await db.collection('admins').updateOne(
      { _id: req.adminId },
      { $set: { mfa_enabled: true, mfa_secret: admin.mfa_secret_pending }, $unset: { mfa_secret_pending: '' } }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/mfa/disable', requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body ?? {};
    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: req.adminId });
    if (!password || !(await bcrypt.compare(password, admin.password_hash))) return res.status(401).json({ error: 'incorrect password' });

    await db.collection('admins').updateOne({ _id: req.adminId }, { $unset: { mfa_enabled: '', mfa_secret: '', mfa_secret_pending: '' } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
