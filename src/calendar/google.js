// Google Calendar integration (plan.md §3/§5/§8 phase 3). DB stays the lock/authority
// for conflict prevention; Calendar is a mirror for humans plus a freebusy cross-check
// for manually-added personal events the DB doesn't know about (plan.md §6).
import { google } from 'googleapis';
import { encrypt, decrypt } from '../crypto.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function requireOAuthConfig() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be set');
  }
}

export function oauthClient() {
  requireOAuthConfig();
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// state carries the business id through Google's redirect so the callback knows which
// tenant is connecting (plan.md §7: each business connects its own Google account).
export function getAuthUrl(state) {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces Google to (re-)issue a refresh_token even on a reconnect
    scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'],
    state,
  });
}

export async function exchangeCodeForRefreshToken(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token — reconnect with prompt=consent');
  }
  return encrypt(tokens.refresh_token);
}

// Returns an authenticated Calendar client for one business's connected Google account.
function calendarClientFor(encryptedRefreshToken) {
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(encryptedRefreshToken) });
  return google.calendar({ version: 'v3', auth: client });
}

export async function createEvent(business, calendarId, booking, service) {
  const calendar = calendarClientFor(business.google_refresh_token);
  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${service.name} — ${booking.customer_name}`,
      description: `Phone: ${booking.phone}\nBooked via ${booking.created_via}`,
      start: { dateTime: new Date(booking.start_time).toISOString(), timeZone: business.timezone },
      end: { dateTime: new Date(booking.end_time).toISOString(), timeZone: business.timezone },
    },
  });
  return data.id;
}

export async function updateEvent(business, calendarId, googleEventId, booking, service) {
  const calendar = calendarClientFor(business.google_refresh_token);
  await calendar.events.patch({
    calendarId,
    eventId: googleEventId,
    requestBody: {
      summary: `${service.name} — ${booking.customer_name}`,
      start: { dateTime: new Date(booking.start_time).toISOString(), timeZone: business.timezone },
      end: { dateTime: new Date(booking.end_time).toISOString(), timeZone: business.timezone },
    },
  });
}

export async function deleteEvent(business, calendarId, googleEventId) {
  const calendar = calendarClientFor(business.google_refresh_token);
  try {
    await calendar.events.delete({ calendarId, eventId: googleEventId });
  } catch (err) {
    if (err.code !== 404 && err.response?.status !== 404) throw err; // already gone is fine
  }
}

// Intersected with the DB query in check_availability so a manually-added personal
// appointment on the connected calendar isn't double-booked (plan.md §6).
export async function busyIntervals(business, calendarId, timeMinISO, timeMaxISO) {
  if (!business.google_refresh_token) return []; // calendar not connected yet — DB-only availability
  const calendar = calendarClientFor(business.google_refresh_token);
  const { data } = await calendar.freebusy.query({
    requestBody: { timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: calendarId }] },
  });
  return data.calendars?.[calendarId]?.busy ?? [];
}
