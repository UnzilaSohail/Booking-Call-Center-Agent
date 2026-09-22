// Tool definitions + handlers the Gemini Live session calls mid-conversation (plan.md
// §5). Handlers reuse the exact same booking service the REST API uses (see
// src/services/bookingService.js) so a call and a dashboard edit can never diverge.
import {
  BookingError, getAvailability, createBooking, rescheduleBooking, cancelBooking,
  findUpcomingBookingsByPhone, assertWithinChangeCutoff,
} from '../services/bookingService.js';
import { withTenant, newId } from '../db.js';
import { sendSms } from '../notifications/sms.js';
import { createHash } from 'node:crypto';

export const toolDeclarations = [
  {
    name: 'check_availability',
    description: "Look up open appointment slots for a service on a given date. Always call this before offering times to the caller — never guess or invent a time.",
    parameters: {
      type: 'OBJECT',
      properties: {
        serviceName: { type: 'STRING', description: 'Name of the service the caller wants, matched case-insensitively against this business\'s service list.' },
        date: { type: 'STRING', description: 'Date to check, as YYYY-MM-DD in the business\'s own timezone.' },
        staffName: { type: 'STRING', description: 'Optional: a specific staff member the caller asked for, by name.' },
      },
      required: ['serviceName', 'date'],
    },
  },
  {
    name: 'create_booking',
    description: "Book the appointment. Only call this AFTER reading the exact date/time back to the caller and getting explicit confirmation — misheard dates/names are the most common booking error.",
    parameters: {
      type: 'OBJECT',
      properties: {
        serviceName: { type: 'STRING' },
        staffName: { type: 'STRING', description: 'Optional staff member name if the business has multiple staff.' },
        locationName: { type: 'STRING', description: 'Optional: which location, if this business has more than one and the caller named one.' },
        startTime: { type: 'STRING', description: 'Exact start time as an ISO 8601 datetime in UTC, taken from a slot previously returned by check_availability.' },
        customerName: { type: 'STRING' },
        phone: { type: 'STRING', description: "Caller's callback phone number, digits only with country code if given." },
      },
      required: ['serviceName', 'startTime', 'customerName', 'phone'],
    },
  },
  {
    name: 'find_upcoming_bookings',
    description: "Look up a caller's existing upcoming bookings by phone number. Use this before reschedule_booking or cancel_booking so you know which booking to act on.",
    parameters: {
      type: 'OBJECT',
      properties: { phone: { type: 'STRING' } },
      required: ['phone'],
    },
  },
  {
    name: 'reschedule_booking',
    description: 'Move an existing booking to a new time. Confirm the new time out loud before calling this, same as create_booking.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bookingId: { type: 'STRING', description: 'The booking id from find_upcoming_bookings.' },
        newStartTime: { type: 'STRING', description: 'New start time as ISO 8601 UTC, from a slot check_availability returned.' },
      },
      required: ['bookingId', 'newStartTime'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking. Confirm with the caller before calling this.',
    parameters: {
      type: 'OBJECT',
      properties: { bookingId: { type: 'STRING', description: 'The booking id from find_upcoming_bookings.' } },
      required: ['bookingId'],
    },
  },
  {
    name: 'transfer_to_human',
    description: "Escalate the call to a human because the request is out of scope (not something this system supports — a booking/reschedule/cancel/FAQ/message/callback), the caller explicitly asks for a person, they are upset and a human would handle it better, or you are not confident you understood the request correctly even after asking once to clarify. Tell the caller you're transferring them before calling this.",
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: "Brief summary of why and what the caller needs — this is read aloud to the human as a heads-up before they're connected, so make it useful context, not just a category label." },
        department: { type: 'STRING', description: 'Optional: a named department the caller asked for, if this business has any configured (e.g. "billing", "support").' },
        staffName: { type: 'STRING', description: 'Optional: a specific staff member the caller asked for, by name.' },
        locationName: { type: 'STRING', description: 'Optional: which location, if this business has more than one and the caller named one.' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'leave_voicemail',
    description: "Capture a message from the caller to pass on to staff — use when the business is currently closed and the caller wants to leave a message, or they ask to leave one directly. Say the message back to confirm you got it right before calling this.",
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'The message content, in the caller\'s own words.' },
        phone: { type: 'STRING', description: "Caller's phone number, so staff can call back." },
      },
      required: ['message', 'phone'],
    },
  },
  {
    name: 'request_callback',
    description: 'Queue a request for staff to call the caller back at a preferred time — this does not place an automatic call, it just notes the request for a human to act on.',
    parameters: {
      type: 'OBJECT',
      properties: {
        phone: { type: 'STRING' },
        preferredTime: { type: 'STRING', description: 'When the caller would like to be called back, in their own words (e.g. "tomorrow morning").' },
        reason: { type: 'STRING' },
      },
      required: ['phone', 'reason'],
    },
  },
  {
    name: 'flag_emergency',
    description: "Call this immediately if the caller describes something matching this business's emergency rules (see the Emergency section of your instructions), after telling them what those rules say to say. This flags the call for urgent staff attention in addition to whatever else you do (e.g. transfer_to_human).",
    parameters: {
      type: 'OBJECT',
      properties: { reason: { type: 'STRING', description: 'Brief description of the emergency, for the staff alert.' } },
      required: ['reason'],
    },
  },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveServiceId(businessId, serviceName) {
  return withTenant(businessId, async (c) => {
    const exact = await c('services').findOne({ name: { $regex: `^${escapeRegex(serviceName)}$`, $options: 'i' } });
    if (exact) return exact._id;
    const fuzzy = await c('services').findOne({ name: { $regex: escapeRegex(serviceName), $options: 'i' } });
    return fuzzy?._id ?? null;
  });
}

async function resolveStaffId(businessId, staffName) {
  if (!staffName) return null;
  return withTenant(businessId, async (c) => {
    const staff = await c('staff').findOne({ name: { $regex: escapeRegex(staffName), $options: 'i' } });
    return staff?._id ?? null;
  });
}

async function resolveLocationId(businessId, locationName) {
  if (!locationName) return null;
  return withTenant(businessId, async (c) => {
    const location = await c('locations').findOne({ name: { $regex: escapeRegex(locationName), $options: 'i' } });
    return location?._id ?? null;
  });
}

// Transfer routing needs the actual staff/location documents (for .phone/.contact_phone),
// not just their ids — separate from resolveStaffId/resolveLocationId above, which only
// ever feed a booking's staff_id/location_id field.
async function resolveStaffDoc(businessId, staffName) {
  if (!staffName) return null;
  return withTenant(businessId, (c) => c('staff').findOne({ name: { $regex: escapeRegex(staffName), $options: 'i' } }));
}
async function resolveLocationDoc(businessId, locationName) {
  if (!locationName) return null;
  return withTenant(businessId, (c) => c('locations').findOne({ name: { $regex: escapeRegex(locationName), $options: 'i' } }));
}

// Pure — priority: named department match > staff's own phone > location's contact
// phone > business-wide default. staff/location are already-resolved documents (or
// null/undefined), not names, so this has no DB access of its own and is directly
// unit-testable (test/transferRouting.test.js).
export function resolveTransferTarget(business, { department, staff, location } = {}) {
  if (department) {
    const match = (business.transfer_departments ?? []).find((d) => d.name.toLowerCase() === department.toLowerCase());
    if (match) return { phoneNumber: match.phoneNumber, matchedBy: 'department' };
  }
  if (staff?.phone) return { phoneNumber: staff.phone, matchedBy: 'staff' };
  if (location?.contact_phone) return { phoneNumber: location.contact_phone, matchedBy: 'location' };
  if (business.transfer_phone_number) return { phoneNumber: business.transfer_phone_number, matchedBy: 'business' };
  return null;
}

// Keyed on the call plus the exact booking content, not a per-invocation counter: a
// genuine retry of the same tool-call (Gemini re-sending after a timeout, plan.md §5)
// carries identical arguments and so lands on the same key; a deliberately new booking
// (different time/service) gets a different one. A counter would defeat the point —
// it'd give every retry a fresh key too.
function idempotencyKeyFor(callSid, { serviceId, staffId, startTime, phone }) {
  return createHash('sha256').update([callSid, serviceId, staffId ?? '', startTime, phone].join('|')).digest('hex');
}

// Returns handlers bound to one call's business + call_sid, called by the Gemini session
// wrapper (src/voice/geminiSession.js) whenever the model emits a functionCall.
export function createToolHandlers(business, callSid) {
  return {
    async check_availability({ serviceName, date, staffName }) {
      const serviceId = await resolveServiceId(business.id, serviceName);
      if (!serviceId) return { error: `no service found matching "${serviceName}"` };
      const staffId = await resolveStaffId(business.id, staffName);
      try {
        const { slots, durationMinutes } = await getAvailability(business.id, { serviceId, date, staffId });
        return { slots, durationMinutes, timezone: business.timezone };
      } catch (err) {
        if (err instanceof BookingError) return { error: err.message };
        throw err;
      }
    },

    async create_booking({ serviceName, staffName, locationName, startTime, customerName, phone }) {
      const serviceId = await resolveServiceId(business.id, serviceName);
      if (!serviceId) return { error: `no service found matching "${serviceName}"` };
      const staffId = await resolveStaffId(business.id, staffName);
      const locationId = await resolveLocationId(business.id, locationName);
      try {
        const { booking } = await createBooking(business.id, {
          customerName, phone, serviceId, staffId, locationId, startTime,
          idempotencyKey: idempotencyKeyFor(callSid, { serviceId, staffId, startTime, phone }),
          createdVia: 'call',
        });
        return { bookingId: booking.id, startTime: booking.start_time, status: 'confirmed' };
      } catch (err) {
        if (err instanceof BookingError) return { error: err.message };
        throw err;
      }
    },

    async find_upcoming_bookings({ phone }) {
      const bookings = await findUpcomingBookingsByPhone(business.id, phone);
      return {
        bookings: bookings.map((b) => ({ bookingId: b.id, service: b.service_name, startTime: b.start_time })),
      };
    },

    async reschedule_booking({ bookingId, newStartTime }) {
      try {
        const current = await withTenant(business.id, (c) => c('bookings').findOne({ _id: bookingId }));
        if (!current) return { error: 'booking not found' };
        assertWithinChangeCutoff(business, current);
        const updated = await rescheduleBooking(business.id, bookingId, newStartTime);
        return { bookingId: updated.id, startTime: updated.start_time, status: 'rescheduled' };
      } catch (err) {
        if (err instanceof BookingError) return { error: err.message };
        throw err;
      }
    },

    async cancel_booking({ bookingId }) {
      try {
        const current = await withTenant(business.id, (c) => c('bookings').findOne({ _id: bookingId }));
        if (!current) return { error: 'booking not found' };
        assertWithinChangeCutoff(business, current);
        await cancelBooking(business.id, bookingId);
        return { bookingId, status: 'cancelled' };
      } catch (err) {
        if (err instanceof BookingError) return { error: err.message };
        throw err;
      }
    },

    async transfer_to_human({ reason, department, staffName, locationName }) {
      const staff = await resolveStaffDoc(business.id, staffName);
      const location = await resolveLocationDoc(business.id, locationName);
      const target = resolveTransferTarget(business, { department, staff, location });
      return { transferred: true, reason, transferPhoneNumber: target?.phoneNumber ?? null };
    },

    async leave_voicemail({ message, phone }) {
      await withTenant(business.id, (c) => c('voicemails').insertOne({
        _id: newId(), call_sid: callSid, phone, message, created_at: new Date(),
      }));
      await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: 'voicemail' } }));
      return { captured: true };
    },

    async request_callback({ phone, preferredTime, reason }) {
      await withTenant(business.id, (c) => c('callback_requests').insertOne({
        _id: newId(), call_sid: callSid, phone, preferred_time: preferredTime || null, reason, status: 'pending', created_at: new Date(),
      }));
      await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: 'callback_requested' } }));
      return { requested: true };
    },

    async flag_emergency({ reason }) {
      await withTenant(business.id, (c) => c('call_logs').updateOne({ call_sid: callSid }, { $set: { outcome: `emergency: ${reason}`.slice(0, 200) } }));
      // Fire-and-forget, same pattern as booking confirmations (bookingService.js) —
      // an emergency alert must never block or fail the call itself.
      if (business.contact_phone) {
        sendSms(business.contact_phone, `Emergency flagged on a call to ${business.name}: ${reason}`)
          .catch((err) => console.error(`emergency SMS alert failed for call ${callSid}:`, err.message));
      }
      return { flagged: true };
    },
  };
}
