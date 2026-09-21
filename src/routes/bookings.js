import { Router } from 'express';
import {
  BookingError, getAvailability, listBookings,
  createBooking, rescheduleBooking, cancelBooking, getDashboardStats,
} from '../services/bookingService.js';
import { getAnalytics } from '../services/analyticsService.js';

export const bookingsRouter = Router();

function handleError(err, res, next) {
  if (err instanceof BookingError) return res.status(err.status).json({ error: err.message });
  next(err);
}

bookingsRouter.get('/stats', async (req, res, next) => {
  try {
    res.json(await getDashboardStats(req.businessId));
  } catch (err) {
    handleError(err, res, next);
  }
});

bookingsRouter.get('/analytics', async (req, res, next) => {
  try {
    res.json(await getAnalytics(req.businessId));
  } catch (err) {
    handleError(err, res, next);
  }
});

// GET /availability?serviceId=&date=YYYY-MM-DD&staffId=(optional)&excludeBookingId=(optional)
// Returns free start-time slots (ISO, UTC) for that calendar day in the business's own
// timezone. excludeBookingId lets the dashboard check availability while rescheduling a
// booking without that booking's own current slot counting as busy against itself.
bookingsRouter.get('/availability', async (req, res, next) => {
  try {
    const { serviceId, date, staffId, excludeBookingId } = req.query;
    if (!serviceId || !date) return res.status(400).json({ error: 'serviceId and date are required' });
    res.json(await getAvailability(req.businessId, { serviceId, date, staffId, excludeBookingId }));
  } catch (err) {
    handleError(err, res, next);
  }
});

// GET /bookings?from=&to=&q=&status=  — from/to for the calendar view, q (customer
// name/phone) and status for the searchable bookings list page.
bookingsRouter.get('/bookings', async (req, res, next) => {
  try {
    res.json(await listBookings(req.businessId, { from: req.query.from, to: req.query.to, q: req.query.q, status: req.query.status }));
  } catch (err) {
    handleError(err, res, next);
  }
});

bookingsRouter.post('/bookings', async (req, res, next) => {
  try {
    const { customerName, phone, customerEmail, serviceId, staffId, locationId, startTime, idempotencyKey, createdVia } = req.body ?? {};
    // Confirmation notification fires from inside createBooking() itself
    // (src/services/bookingService.js) — shared by this route and the voice agent's
    // create_booking tool, so both send it the same way instead of each remembering to.
    const { booking, replayed } = await createBooking(req.businessId, {
      customerName, phone, customerEmail, serviceId, staffId, locationId, startTime, idempotencyKey, createdVia,
    });
    res.status(replayed ? 200 : 201).json(booking);
  } catch (err) {
    handleError(err, res, next);
  }
});

// PATCH /bookings/:id — reschedule (startTime) and/or status change.
bookingsRouter.patch('/bookings/:id', async (req, res, next) => {
  try {
    const { startTime, status } = req.body ?? {};
    if (!startTime && !status) return res.status(400).json({ error: 'nothing to update' });

    let updated;
    if (startTime) updated = await rescheduleBooking(req.businessId, req.params.id, startTime);
    if (status === 'cancelled') updated = await cancelBooking(req.businessId, req.params.id);
    res.json(updated);
  } catch (err) {
    handleError(err, res, next);
  }
});

// DELETE = cancel (soft delete, keeps history for call_logs/reporting).
bookingsRouter.delete('/bookings/:id', async (req, res, next) => {
  try {
    res.json(await cancelBooking(req.businessId, req.params.id));
  } catch (err) {
    handleError(err, res, next);
  }
});
