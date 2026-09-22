// Signed, unauthenticated links a customer can use to manage their own booking
// (reschedule/cancel — ROADMAP.md §6) without a dashboard login. Same short-lived-signed-
// JWT pattern src/routes/calendar.js already uses for its OAuth state token.
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const MAX_LINK_LIFETIME_DAYS = 30;

// Expires at the booking's start_time (a link to manage a past appointment is moot) or
// MAX_LINK_LIFETIME_DAYS out, whichever is sooner — a booking made far in the future
// doesn't get a token that outlives this app's usual 12h admin session by months.
export function signManageToken(businessId, bookingId, startTime) {
  const maxExpiry = Date.now() + MAX_LINK_LIFETIME_DAYS * 24 * 60 * 60_000;
  const bookingExpiry = new Date(startTime).getTime();
  const expiresAt = Math.min(maxExpiry, Number.isFinite(bookingExpiry) ? bookingExpiry : maxExpiry);
  const expiresInSeconds = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  return jwt.sign({ businessId, bookingId, purpose: 'manage-booking' }, JWT_SECRET, { expiresIn: expiresInSeconds });
}

// Returns { businessId, bookingId } or null (invalid/expired/tampered) — never throws,
// so route handlers can treat every failure mode the same way (a plain "link expired or
// invalid" message, not a 500).
export function verifyManageToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.purpose !== 'manage-booking') return null;
    return { businessId: payload.businessId, bookingId: payload.bookingId };
  } catch {
    return null;
  }
}
