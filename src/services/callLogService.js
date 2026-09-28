// Read-side for call_logs, written by src/webhooks/twilio.js (call start) and
// src/voice/twilioBridge.js (transcript/outcome/booking_id as the call progresses).
import { withTenant, serializeAll } from '../db.js';

export async function listCallLogs(businessId, { from, to, phone, outcome, limit = 200 } = {}) {
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);

  const filter = { is_test: { $ne: true } };
  if (Object.keys(dateFilter).length) filter.created_at = dateFilter;
  // Partial, case-insensitive match — a caller doesn't dial with punctuation in mind.
  if (phone) filter.phone = { $regex: phone.replace(/[^\d+]/g, ''), $options: 'i' };
  if (outcome === 'booked') filter.booking_id = { $ne: null };
  else if (outcome) filter.outcome = { $regex: `^${outcome}`, $options: 'i' };

  // is_test excluded so onboarding test calls never show up mixed in with real customer
  // call history.
  const logs = await withTenant(businessId, (col) =>
    col('call_logs')
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()
  );

  const bookingIds = [...new Set(logs.map((l) => l.booking_id).filter(Boolean))];
  const bookings = bookingIds.length
    ? await withTenant(businessId, (col) => col('bookings').find({ _id: { $in: bookingIds } }).toArray())
    : [];
  const bookingById = Object.fromEntries(bookings.map((b) => [b._id, b]));

  // Voicemails/callback requests are keyed by call_sid, not booking_id (src/voice/tools.js
  // writes them there) — same join shape as the booking one above, just a different key.
  const callSids = logs.map((l) => l.call_sid).filter(Boolean);
  const [voicemails, callbackRequests] = callSids.length
    ? await withTenant(businessId, (col) => Promise.all([
        col('voicemails').find({ call_sid: { $in: callSids } }).toArray(),
        col('callback_requests').find({ call_sid: { $in: callSids } }).toArray(),
      ]))
    : [[], []];
  const voicemailBySid = Object.fromEntries(voicemails.map((v) => [v.call_sid, v]));
  const callbackBySid = Object.fromEntries(callbackRequests.map((c) => [c.call_sid, c]));

  return serializeAll(logs).map((l) => {
    const booking = l.booking_id ? bookingById[l.booking_id] : null;
    const voicemail = voicemailBySid[l.call_sid];
    const callbackRequest = callbackBySid[l.call_sid];
    return {
      ...l,
      // recording_url/summary/intent/is_after_hours already sit directly on `l` via the
      // spread above (src/webhooks/twilio.js, src/voice/twilioBridge.js) — nothing to
      // join here, just documenting that the Calls page reads them straight off the log.
      booking: booking ? { id: booking._id, customerName: booking.customer_name, startTime: booking.start_time, status: booking.status } : null,
      voicemail: voicemail ? { message: voicemail.message, phone: voicemail.phone } : null,
      callbackRequest: callbackRequest ? { phone: callbackRequest.phone, preferredTime: callbackRequest.preferred_time, reason: callbackRequest.reason } : null,
    };
  });
}
