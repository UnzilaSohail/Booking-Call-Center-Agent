// Single login entry point so an admin never has to know or remember which role they
// are before they log in — no more "I tried the company login with my platform email."
// Tries platform admin first (the smaller, higher-privilege set), then falls back to
// company admin. Both role-specific endpoints (src/auth.js, src/platformAuth.js) still
// exist for direct API use; this just spares the dashboard from needing two forms/URLs.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { verifyCompanyAdmin, verifyPlatformAdmin, LoginError } from '../loginHelpers.js';
import { loginAttempt, loginSucceeded } from '../rateLimit.js';
import { notifyLockout } from '../lockoutNotice.js';
import { signPlatformSession, signPlatformMfaToken } from '../platformAuth.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const unifiedLoginRouter = Router();

unifiedLoginRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return res.status(400).json({ error: 'email and password are required' });
    const normalizedEmail = email.toLowerCase();
    const attempt = await loginAttempt(req.ip, normalizedEmail);
    if (attempt.blocked) return res.status(429).json({ error: 'too many failed attempts, try again in 15 minutes' });

    const platformResult = await verifyPlatformAdmin(normalizedEmail, password);
    if (platformResult) {
      await loginSucceeded(req.ip, normalizedEmail);
      if (platformResult.mfaEnabled) return res.json({ mfaRequired: true, mfaToken: signPlatformMfaToken(platformResult.platformAdminId), role: 'platform' });
      return res.json({ token: signPlatformSession(platformResult.platformAdminId), role: 'platform' });
    }

    const companyResult = await verifyCompanyAdmin(normalizedEmail, password, req.ip);
    if (companyResult) {
      await loginSucceeded(req.ip, normalizedEmail);
      if (companyResult.mfaEnabled) {
        const mfaToken = jwt.sign({ role: 'mfa_pending', adminId: companyResult.adminId, businessId: companyResult.businessId }, JWT_SECRET, { expiresIn: '5m' });
        return res.json({ mfaRequired: true, mfaToken, role: 'business' });
      }
      const token = jwt.sign({ role: 'business', adminId: companyResult.adminId, businessId: companyResult.businessId }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ token, role: 'business' });
    }

    if (attempt.lockedNow) notifyLockout(normalizedEmail);
    res.status(401).json({ error: 'invalid credentials' });
  } catch (err) {
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});
