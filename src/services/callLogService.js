// Read-side for call_logs, written by src/webhooks/twilio.js (call start) and
// src/voice/twilioBridge.js (transcript/outcome/booking_id as the call progresses).
import { withTenant, serializeAll } from '../db.js';

export async function listCallLogs(businessId, { from, to, limit = 200 } = {}) {
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);

  const logs = await withTenant(businessId, (col) =>
    col('call_logs')
      .find(Object.keys(dateFilter).length ? { created_at: dateFilter } : {})
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()
  );

  const bookingIds = [...new Set(logs.map((l) => l.booking_id).filter(Boolean))];
  const bookings = bookingIds.length
    ? await withTenant(businessId, (col) => col('bookings').find({ _id: { $in: bookingIds } }).toArray())
    : [];
  const bookingById = Object.fromEntries(bookings.map((b) => [b._id, b]));

  return serializeAll(logs).map((l) => {
    const booking = l.booking_id ? bookingById[l.booking_id] : null;
    return {
      ...l,
      booking: booking ? { id: booking._id, customerName: booking.customer_name, startTime: booking.start_time, status: booking.status } : null,
    };
  });
}
