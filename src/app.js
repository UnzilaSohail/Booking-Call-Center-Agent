import express from 'express';
import cors from 'cors';
import { authRouter, requireAuth } from './auth.js';
import { platformAuthRouter, requirePlatformAuth } from './platformAuth.js';
import { unifiedLoginRouter } from './routes/unifiedLogin.js';
import { platformRouter } from './routes/platform.js';
import { signupRouter } from './routes/signup.js';
import { myBookingRouter } from './routes/myBooking.js';
import { publicBookingRouter } from './routes/publicBooking.js';
import { customerPortalRouter } from './routes/customerPortal.js';
import { acceptInviteRouter } from './routes/acceptInvite.js';
import { onboardingRouter } from './routes/onboarding.js';
import { requestLog } from './requestLog.js';
import { getDb } from './db.js';
import { locationsRouter } from './routes/locations.js';
import { customersRouter } from './routes/customers.js';
import { servicesRouter } from './routes/services.js';
import { teamRouter } from './routes/team.js';
import { settingsRouter } from './routes/settings.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { bookingsRouter } from './routes/bookings.js';
import { calendarRouter, calendarOAuthRouter } from './routes/calendar.js';
import { phoneNumberRouter } from './routes/phoneNumber.js';
import { callLogsRouter, callRecordingRouter } from './routes/callLogs.js';
import { exceptionsRouter } from './routes/exceptions.js';
import { auditLogsRouter } from './routes/auditLogs.js';
import { billingRouter } from './routes/billing.js';
import { waitlistRouter } from './routes/waitlist.js';
import { reportsRouter } from './routes/reports.js';
import { twilioWebhookRouter } from './webhooks/twilio.js';
import { stripeWebhookRouter } from './webhooks/stripe.js';
import { auditLogger, platformAuditLogger } from './auditLog.js';
import { clearDirectoryCache } from './services/directoryCache.js';

export const app = express();

// Behind nginx: take the client IP from X-Forwarded-For so the public endpoints' rate
// limits see visitors, not the proxy.
app.set('trust proxy', 1);
app.use(requestLog);

// The dashboard (its own Next.js app, its own origin/port) talks to this API entirely
// via fetch() with a Bearer token — no cookies involved, so a permissive CORS policy
// doesn't open a CSRF hole the way it would for cookie-authenticated requests. Restrict
// via ALLOWED_ORIGINS (comma-separated) if you want to lock this down for production.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim());
app.use(cors({ origin: allowedOrigins ?? true }));

// Basic browser-hardening headers on every API answer (the dashboard sets its own in next.config.mjs).
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Strict-Transport-Security': 'max-age=31536000' });
  res.removeHeader('X-Powered-By');
  next();
});
app.disable('x-powered-by');

// Public routes first: Twilio's inbound call webhook, Stripe's webhook, and Google's
// OAuth redirect all arrive with no bearer token, so they parse their own body and
// must not sit behind the app-wide express.json()/requireAuth chain below. Stripe's
// signature check specifically needs the raw body, which is why stripeWebhookRouter
// must be mounted before express.json() runs (it would otherwise consume the body).
// Everything this server returns is JSON, TwiML or a one-line text page: none of it ever needs scripts, styles or
// framing. If a route ever reflects attacker text as HTML, this CSP keeps it inert (the API shares an origin
// with the dashboard's localStorage tokens).
app.use((req, res, next) => {
  res.set({ 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  next();
});

app.use(twilioWebhookRouter);
app.use(stripeWebhookRouter);
app.use('/api', calendarOAuthRouter);

app.use(express.json());

// Anything changed through the dashboard or platform console may change who is listed: forget the cached directory.
app.use((req, res, next) => {
  if (req.method !== 'GET' && !req.path.startsWith('/api/public')) res.on('finish', () => { if (res.statusCode < 400) clearDirectoryCache(); });
  next();
});

// Answers ok only when the database does too, so an uptime monitor sees a dead database, not just a live process.
app.get('/health', async (req, res) => {
  try {
    await Promise.race([
      getDb().then((db) => db.command({ ping: 1 })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('database ping timed out')), 2000).unref()),
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error('health check failed:', err.message);
    res.status(503).json({ ok: false, error: 'database unavailable' });
  }
});
app.use('/api', unifiedLoginRouter);
app.use('/api', signupRouter);
app.use('/api', myBookingRouter);
app.use('/api', publicBookingRouter);
app.use('/api', customerPortalRouter);
app.use('/api', acceptInviteRouter);
// Unguarded like the routers above — it does its own token check (query param, since a
// browser <audio> element can't send an Authorization header) rather than the app-wide
// requireAuth below. See src/routes/callLogs.js for why.
app.use('/api', callRecordingRouter);
app.use('/api/auth', authRouter);
// Scoped to /api/platform specifically — requirePlatformAuth must not be mounted at the
// broader /api prefix, or it would intercept every other /api/* request (including
// legitimate company-admin ones) before they ever reach their own route/auth below.
app.use('/api/platform', platformAuthRouter);
app.use('/api/platform', requirePlatformAuth, platformAuditLogger, platformRouter);
// Authenticates every company-admin request exactly once; every router mounted below
// relies on this (a failure answers 401 here and never reaches them). auditLogger sits in
// the same one-shot step so it attaches a single 'finish' listener per request.
app.use('/api', requireAuth, auditLogger);
// Each router applies its own requireArea(...) gate per-route internally
// (src/permissions.js) rather than here — these routers all share the '/api' prefix, so
// a gate applied at this mount level would run for every /api/* request regardless of
// which router actually owns the path (Express dispatches into a router the moment its
// mount prefix matches, before that router's own routes get a chance to not-match).
app.use('/api', servicesRouter);
app.use('/api', teamRouter);
app.use('/api', knowledgeRouter);
app.use('/api', onboardingRouter);
app.use('/api', locationsRouter);
app.use('/api', customersRouter);
app.use('/api', bookingsRouter);
app.use('/api', settingsRouter);
app.use('/api', calendarRouter);
app.use('/api', phoneNumberRouter);
app.use('/api', callLogsRouter);
app.use('/api', exceptionsRouter);
app.use('/api', auditLogsRouter);
app.use('/api', billingRouter);
app.use('/api', waitlistRouter);
app.use('/api', reportsRouter);

// Centralized error handler — every route above forwards unexpected errors via next(err).
app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode;
  if (status >= 400 && status < 500) return res.status(status).json({ error: err.expose ? err.message : 'invalid request' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});
