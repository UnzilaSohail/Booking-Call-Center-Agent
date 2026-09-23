import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';
import { getAuthUrl, exchangeCodeForRefreshToken } from '../calendar/google.js';
import { requireArea } from '../auth.js';

const JWT_SECRET = process.env.JWT_SECRET;

// Protected: mounted behind requireAuth. Dashboard hits these with the admin's bearer token.
export const calendarRouter = Router();

// Applied per-route (see the comment in src/routes/services.js for why).
const gate = requireArea('settings');

calendarRouter.get('/calendar/status', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne(
      { _id: req.businessId },
      { projection: { google_refresh_token: 1, google_calendar_id: 1 } }
    );
    res.json({ connected: business?.google_refresh_token != null, google_calendar_id: business?.google_calendar_id });
  } catch (err) {
    next(err);
  }
});

// Returns the Google consent URL for the dashboard to redirect the admin to. The state
// token is short-lived and signed so /oauth/callback can trust which business is
// connecting without requiring a bearer token on a browser redirect (plan.md §7).
calendarRouter.get('/calendar/connect', gate, (req, res) => {
  const state = jwt.sign({ businessId: req.businessId, purpose: 'calendar-connect' }, JWT_SECRET, { expiresIn: '10m' });
  res.json({ url: getAuthUrl(state) });
});

// Public: Google redirects the admin's browser here directly, no bearer token available.
export const calendarOAuthRouter = Router();

calendarOAuthRouter.get('/calendar/oauth/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`Google denied access: ${error}`);
    if (!code || !state) return res.status(400).send('missing code or state');

    let payload;
    try {
      payload = jwt.verify(state, JWT_SECRET);
    } catch {
      return res.status(400).send('invalid or expired state — restart the connect flow from the dashboard');
    }
    if (payload.purpose !== 'calendar-connect') return res.status(400).send('invalid state');

    const encryptedRefreshToken = await exchangeCodeForRefreshToken(code);
    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: payload.businessId }, { $set: { google_refresh_token: encryptedRefreshToken } });

    res.send('<html><body>Google Calendar connected — you can close this tab.</body></html>');
  } catch (err) {
    next(err);
  }
});
