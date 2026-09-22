// Public, token-authenticated self-service for a customer's own booking (ROADMAP.md §6
// "Reschedule link"/"Cancellation link") — no dashboard login, just the signed link sent
// in the confirmation SMS/email (src/customerLink.js). Reuses the exact same booking
// rules a phone-in change already follows (src/services/bookingService.js), just reached
// by link instead of by voice.
import { Router } from 'express';
import { verifyManageToken } from '../customerLink.js';
import { withTenant, serialize } from '../db.js';
import {
  BookingError, getBusiness, getAvailability, rescheduleBooking, cancelBooking, assertWithinChangeCutoff,
} from '../services/bookingService.js';

export const myBookingRouter = Router();

function handleError(err, res, next) {
  if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
  next(err);
}

// Shared by every route below — resolves the token, then confirms the booking it points
// at still exists and still belongs to that business (a cancelled booking's token still
// verifies fine cryptographically, so this is a second, necessary check).
async function loadFromToken(token) {
  const claims = verifyManageToken(token);
  if (!claims) return { error: 'this link has expired or is invalid' };

  const booking = await withTenant(claims.businessId, (c) => c('bookings').findOne({ _id: claims.bookingId }));
  if (!booking) return { error: 'booking not found' };

  return { businessId: claims.businessId, booking };
}

myBookingRouter.get('/my-booking/:token', async (req, res, next) => {
  try {
    const { error, businessId, booking } = await loadFromToken(req.params.token);
    if (error) return res.status(404).json({ error });

    const [business, service] = await Promise.all([
      getBusiness(businessId),
      withTenant(businessId, (c) => c('services').findOne({ _id: booking.service_id })),
    ]);
    const knowledge = business.knowledge ?? {};

    res.json({
      booking: { id: booking._id, customerName: booking.customer_name, startTime: booking.start_time, status: booking.status, serviceId: booking.service_id, staffId: booking.staff_id },
      serviceName: service?.name ?? null,
      businessName: business.name,
      timezone: business.timezone,
      rescheduleCutoffMinutes: business.reschedule_cutoff_minutes,
      cancellationPolicy: knowledge.cancellation_policy ?? null,
      preparationInstructions: knowledge.preparation_instructions ?? null,
    });
  } catch (err) {
    handleError(err, res, next);
  }
});

myBookingRouter.get('/my-booking/:token/availability', async (req, res, next) => {
  try {
    const { error, businessId, booking } = await loadFromToken(req.params.token);
    if (error) return res.status(404).json({ error });
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required' });

    res.json(await getAvailability(businessId, { serviceId: booking.service_id, date, staffId: booking.staff_id, excludeBookingId: booking._id }));
  } catch (err) {
    handleError(err, res, next);
  }
});

myBookingRouter.post('/my-booking/:token/reschedule', async (req, res, next) => {
  try {
    const { error, businessId, booking } = await loadFromToken(req.params.token);
    if (error) return res.status(404).json({ error });
    const { startTime } = req.body ?? {};
    if (!startTime) return res.status(400).json({ error: 'startTime is required' });

    const business = await getBusiness(businessId);
    assertWithinChangeCutoff(business, booking);
    const updated = await rescheduleBooking(businessId, booking._id, startTime);
    res.json(serialize(updated));
  } catch (err) {
    handleError(err, res, next);
  }
});

myBookingRouter.post('/my-booking/:token/cancel', async (req, res, next) => {
  try {
    const { error, businessId, booking } = await loadFromToken(req.params.token);
    if (error) return res.status(404).json({ error });

    const business = await getBusiness(businessId);
    assertWithinChangeCutoff(business, booking);
    const updated = await cancelBooking(businessId, booking._id);
    res.json(serialize(updated));
  } catch (err) {
    handleError(err, res, next);
  }
});
