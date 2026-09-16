// Phase 5 (plan.md §8): booking confirmation + reminder copy, in one place so the
// message wording stays consistent between the immediate confirmation and the cron
// reminders (src/notifications/reminder-worker.js).
import { DateTime } from 'luxon';
import { withTenant } from '../db.js';
import { sendSms } from './sms.js';
import { sendEmail } from './email.js';

function describe(business, booking, service) {
  const when = DateTime.fromJSDate(new Date(booking.start_time)).setZone(business.timezone).toFormat('ccc, LLL d \'at\' h:mm a');
  return { when, serviceName: service.name };
}

// Callers pass either a serialized booking (routes/bookings.js — has .id) or a raw
// Mongo doc (reminder-worker.js — has ._id); this works either way.
function bookingId(booking) {
  return booking.id ?? booking._id;
}

export async function sendBookingConfirmation(business, booking, service) {
  const { when, serviceName } = describe(business, booking, service);
  const text = `${business.name}: your ${serviceName} is confirmed for ${when} (${business.timezone}). Reply to reschedule or cancel.`;

  await Promise.all([
    sendSms(booking.phone, text),
    sendEmail(booking.customer_email, `Booking confirmed — ${business.name}`, text),
  ]);

  await withTenant(business.id, (c) => c('bookings').updateOne({ _id: bookingId(booking) }, { $set: { confirmation_sent_at: new Date() } }));
}

export async function sendReminder(business, booking, service, label) {
  const { when, serviceName } = describe(business, booking, service);
  const text = `Reminder: your ${serviceName} at ${business.name} is ${label === '24h' ? 'tomorrow' : 'in about an hour'}, ${when} (${business.timezone}).`;

  await Promise.all([
    sendSms(booking.phone, text),
    sendEmail(booking.customer_email, `Reminder — ${business.name}`, text),
  ]);

  const field = label === '24h' ? 'reminder_24h_sent_at' : 'reminder_1h_sent_at';
  await withTenant(business.id, (c) => c('bookings').updateOne({ _id: bookingId(booking) }, { $set: { [field]: new Date() } }));
}
