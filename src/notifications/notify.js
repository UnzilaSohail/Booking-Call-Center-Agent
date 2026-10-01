// Phase 5 (plan.md §8): booking confirmation + reminder copy, in one place so the
// message wording stays consistent between the immediate confirmation and the cron
// reminders (src/notifications/reminder-worker.js).
import { DateTime } from 'luxon';
import { withTenant } from '../db.js';
import { sendSms } from './sms.js';
import { sendEmail } from './email.js';
import { getConsent } from '../services/customerService.js';
import { signManageToken } from '../customerLink.js';

function describe(business, booking, service) {
  const when = DateTime.fromJSDate(new Date(booking.start_time)).setZone(business.timezone).toFormat('ccc, LLL d \'at\' h:mm a');
  return { when, serviceName: service.name };
}

// Callers pass either a serialized booking (routes/bookings.js — has .id) or a raw
// Mongo doc (reminder-worker.js — has ._id); this works either way.
function bookingId(booking) {
  return booking.id ?? booking._id;
}

function manageLink(business, booking) {
  const token = signManageToken(business.id, bookingId(booking), booking.start_time);
  const base = process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002';
  return `${base}/manage/${token}`;
}

async function directionsLine(business, booking) {
  if (booking.location_id) {
    const location = await withTenant(business.id, (c) => c('locations').findOne({ _id: booking.location_id }));
    if (location?.address) return `Location: ${location.name} — ${location.address}.`;
  }
  return business.address ? `Location: ${business.address}.` : null;
}

// Sends both channels, gated on that customer's actual consent (src/services/
// customerService.js — stored since the customer-management round, but never checked
// before this) rather than assuming everyone wants everything. Returns the fields the
// caller should persist: sms sid/status-slot + either side's send error, so a failure
// is recorded ("failed-message alerts," ROADMAP.md §6) instead of only console.error'd.
// What happened to one channel, as a status the dashboard can show (Jira 29o):
//   sent | failed | not_configured | opted_out | no_contact
// Pure so it can be unit-tested without a provider. sendEmail returns {sent, reason} and never
// throws, which is why a failed email used to leave no trace on the booking at all.
export function emailDelivery(result) {
  if (result?.sent) return { status: 'sent', error: null };
  const reason = String(result?.reason ?? 'email was not sent');
  return { status: /no email provider/.test(reason) ? 'not_configured' : 'failed', error: reason.slice(0, 300) };
}
export function smsDelivery(sid) {
  return sid ? { status: 'sent', error: null } : { status: 'not_configured', error: 'SMS was not sent: no SMS provider is configured on this server' };
}

async function sendGated(business, booking, smsText, emailSubject, emailText) {
  const consent = await getConsent(business.id, booking.phone).catch(() => null);
  const updates = {};

  if (consent?.smsOptIn === false) {
    console.log(`SMS skipped for ${booking.phone} — opted out`);
    updates.confirmation_sms_status = 'opted_out';
  } else {
    try {
      const sid = await sendSms(business.id, booking.phone, smsText);
      const { status, error } = smsDelivery(sid);
      updates.confirmation_sms_sid = sid;
      updates.confirmation_sms_status = status;
      updates.confirmation_sms_error = error;
    } catch (err) {
      updates.confirmation_sms_status = 'failed';
      updates.confirmation_sms_error = err.message.slice(0, 300);
    }
  }

  if (consent?.emailOptIn === false) {
    console.log(`Email skipped for ${booking.customer_email} — opted out`);
    updates.confirmation_email_status = 'opted_out';
  } else if (!booking.customer_email) {
    // The customer gave no email: nothing was supposed to go out, so this is not a failure.
    updates.confirmation_email_status = 'no_contact';
    updates.confirmation_email_error = null;
  } else {
    try {
      const { status, error } = emailDelivery(await sendEmail(booking.customer_email, emailSubject, emailText));
      updates.confirmation_email_status = status;
      updates.confirmation_email_error = error;
    } catch (err) {
      updates.confirmation_email_status = 'failed';
      updates.confirmation_email_error = err.message.slice(0, 300);
    }
  }

  return updates;
}

export async function sendBookingConfirmation(business, booking, service) {
  const { when, serviceName } = describe(business, booking, service);
  const knowledge = business.knowledge ?? {};
  const link = manageLink(business, booking);
  const directions = await directionsLine(business, booking);

  const lines = [`${business.name}: your ${serviceName} is confirmed for ${when} (${business.timezone}).`];
  if (knowledge.preparation_instructions) lines.push(knowledge.preparation_instructions);
  if (directions) lines.push(directions);
  lines.push(`Reschedule or cancel: ${link}`);
  // 19t: the customer's own "My appointments" page for this business (src/routes/customerPortal.js).
  if (business.slug) lines.push(`All your appointments: ${process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002'}/my/${business.slug}`);
  const text = lines.join(' ');

  const sendUpdates = await sendGated(business, booking, text, `Booking confirmed — ${business.name}`, text);

  await withTenant(business.id, (c) => c('bookings').updateOne({ _id: bookingId(booking) }, { $set: { confirmation_sent_at: new Date(), ...sendUpdates } }));
}

export async function sendReminder(business, booking, service, label) {
  const { when, serviceName } = describe(business, booking, service);
  const link = manageLink(business, booking);
  const text = `Reminder: your ${serviceName} at ${business.name} is ${label === '24h' ? 'tomorrow' : 'in about an hour'}, ${when} (${business.timezone}). Reschedule or cancel: ${link}`;

  await sendGated(business, booking, text, `Reminder — ${business.name}`, text);

  const field = label === '24h' ? 'reminder_24h_sent_at' : 'reminder_1h_sent_at';
  await withTenant(business.id, (c) => c('bookings').updateOne({ _id: bookingId(booking) }, { $set: { [field]: new Date() } }));
}
