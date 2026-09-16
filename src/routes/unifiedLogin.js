// Single login entry point so an admin never has to know or remember which role they
// are before they log in — no more "I tried the company login with my platform email."
// Tries platform admin first (the smaller, higher-privilege set), then falls back to
// company admin. Both role-specific endpoints (src/auth.js, src/platformAuth.js) still
// exist for direct API use; this just spares the dashboard from needing two forms/URLs.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { verifyCompanyAdmin, verifyPlatformAdmin, LoginError } from '../loginHelpers.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const unifiedLoginRouter = Router();

unifiedLoginRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const normalizedEmail = email.toLowerCase();

    const platformResult = await verifyPlatformAdmin(normalizedEmail, password);
    if (platformResult) {
      const token = jwt.sign({ role: 'platform', ...platformResult }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ token, role: 'platform' });
    }

    const companyResult = await verifyCompanyAdmin(normalizedEmail, password);
    if (companyResult) {
      const token = jwt.sign({ role: 'business', ...companyResult }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ token, role: 'business' });
    }

    res.status(401).json({ error: 'invalid credentials' });
  } catch (err) {
    if (err instanceof LoginError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});
