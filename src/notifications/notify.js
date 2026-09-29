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
async function sendGated(business, booking, smsText, emailSubject, emailText) {
  const consent = await getConsent(business.id, booking.phone).catch(() => null);
  const updates = {};

  if (consent?.smsOptIn === false) {
    console.log(`SMS skipped for ${booking.phone} — opted out`);
  } else {
    try {
      const sid = await sendSms(business.id, booking.phone, smsText);
      updates.confirmation_sms_sid = sid;
      updates.confirmation_sms_error = null;
    } catch (err) {
      updates.confirmation_sms_error = err.message.slice(0, 300);
    }
  }

  if (consent?.emailOptIn === false) {
    console.log(`Email skipped for ${booking.customer_email} — opted out`);
  } else {
    try {
      await sendEmail(booking.customer_email, emailSubject, emailText);
      updates.confirmation_email_error = null;
    } catch (err) {
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
