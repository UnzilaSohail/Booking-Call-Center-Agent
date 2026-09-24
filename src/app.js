import express from 'express';
import cors from 'cors';
import { authRouter, requireAuth } from './auth.js';
import { platformAuthRouter, requirePlatformAuth } from './platformAuth.js';
import { unifiedLoginRouter } from './routes/unifiedLogin.js';
import { platformRouter } from './routes/platform.js';
import { signupRouter } from './routes/signup.js';
import { myBookingRouter } from './routes/myBooking.js';
import { acceptInviteRouter } from './routes/acceptInvite.js';
import { onboardingRouter } from './routes/onboarding.js';
import { locationsRouter } from './routes/locations.js';
import { customersRouter } from './routes/customers.js';
import { servicesRouter } from './routes/services.js';
import { teamRouter } from './routes/team.js';
import { settingsRouter } from './routes/settings.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { bookingsRouter } from './routes/bookings.js';
import { calendarRouter, calendarOAuthRouter } from './routes/calendar.js';
import { phoneNumberRouter } from './routes/phoneNumber.js';
import { callLogsRouter } from './routes/callLogs.js';
import { exceptionsRouter } from './routes/exceptions.js';
import { billingRouter } from './routes/billing.js';
import { twilioWebhookRouter } from './webhooks/twilio.js';
import { stripeWebhookRouter } from './webhooks/stripe.js';

export const app = express();

// The dashboard (its own Next.js app, its own origin/port) talks to this API entirely
// via fetch() with a Bearer token — no cookies involved, so a permissive CORS policy
// doesn't open a CSRF hole the way it would for cookie-authenticated requests. Restrict
// via ALLOWED_ORIGINS (comma-separated) if you want to lock this down for production.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim());
app.use(cors({ origin: allowedOrigins ?? true }));

// Public routes first: Twilio's inbound call webhook, Stripe's webhook, and Google's
// OAuth redirect all arrive with no bearer token, so they parse their own body and
// must not sit behind the app-wide express.json()/requireAuth chain below. Stripe's
// signature check specifically needs the raw body, which is why stripeWebhookRouter
// must be mounted before express.json() runs (it would otherwise consume the body).
app.use(twilioWebhookRouter);
app.use(stripeWebhookRouter);
app.use('/api', calendarOAuthRouter);

app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', unifiedLoginRouter);
app.use('/api', signupRouter);
app.use('/api', myBookingRouter);
app.use('/api', acceptInviteRouter);
app.use('/api/auth', authRouter);
// Scoped to /api/platform specifically — requirePlatformAuth must not be mounted at the
// broader /api prefix, or it would intercept every other /api/* request (including
// legitimate company-admin ones) before they ever reach their own route/auth below.
app.use('/api/platform', platformAuthRouter);
app.use('/api/platform', requirePlatformAuth, platformRouter);
// Each router applies its own requireArea(...) gate per-route internally
// (src/permissions.js) rather than here — these routers all share the '/api' prefix, so
// a gate applied at this mount level would run for every /api/* request regardless of
// which router actually owns the path (Express dispatches into a router the moment its
// mount prefix matches, before that router's own routes get a chance to not-match).
app.use('/api', requireAuth, servicesRouter);
app.use('/api', requireAuth, teamRouter);
app.use('/api', requireAuth, knowledgeRouter);
app.use('/api', requireAuth, onboardingRouter);
app.use('/api', requireAuth, locationsRouter);
app.use('/api', requireAuth, customersRouter);
app.use('/api', requireAuth, bookingsRouter);
app.use('/api', requireAuth, settingsRouter);
app.use('/api', requireAuth, calendarRouter);
app.use('/api', requireAuth, phoneNumberRouter);
app.use('/api', requireAuth, callLogsRouter);
app.use('/api', requireAuth, exceptionsRouter);
app.use('/api', requireAuth, billingRouter);

// Centralized error handler — every route above forwards unexpected errors via next(err).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});
