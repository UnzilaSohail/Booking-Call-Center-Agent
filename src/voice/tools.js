// Tool definitions + handlers the Gemini Live session calls mid-conversation (plan.md
// §5). Handlers reuse the exact same booking service the REST API uses (see
// src/services/bookingService.js) so a call and a dashboard edit can never diverge.
import {
  BookingError, getAvailability, createBooking, rescheduleBooking, cancelBooking,
  findUpcomingBookingsByPhone, assertWithinChangeCutoff,
} from '../services/bookingService.js';
import { withTenant } from '../db.js';
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
    description: 'Escalate the call to a human because the request is out of scope (not a booking/reschedule/cancel this system supports) or the caller explicitly asks for a person.',
    parameters: {
      type: 'OBJECT',
      properties: { reason: { type: 'STRING' } },
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

    async create_booking({ serviceName, staffName, startTime, customerName, phone }) {
      const serviceId = await resolveServiceId(business.id, serviceName);
      if (!serviceId) return { error: `no service found matching "${serviceName}"` };
      const staffId = await resolveStaffId(business.id, staffName);
      try {
        const { booking } = await createBooking(business.id, {
          customerName, phone, serviceId, staffId, startTime,
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

    async transfer_to_human({ reason }) {
      return { transferred: true, reason };
    },
  };
}
