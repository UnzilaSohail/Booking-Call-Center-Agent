// Unified "needs staff attention" queue (ROADMAP.md §9), built from five independent
// existing sources rather than a new event-log collection — each type's failure signal
// already lives where it was written (a booking's sync_status/confirmation_*_error, a
// callback_request/voicemail's status, a call_log's transfer_category). This file only
// adds the staff-facing workflow on top: list, assign, resolve, retry.
import { Router } from 'express';
import { getDb, withTenant } from '../db.js';
import { sendBookingConfirmation } from '../notifications/notify.js';
import { requireArea } from '../auth.js';

export const exceptionsRouter = Router();

// Applied per-route (see the comment in src/routes/services.js for why).
const gate = requireArea('exceptions');

// nested: true means the resolution state lives at bookings.exceptions.<type> (a single
// booking can have more than one of these failing independently) instead of flat fields
// on the source document itself.
const TYPES = {
  failed_booking: { collection: 'failed_bookings', nested: false },
  callback_request: { collection: 'callback_requests', nested: false, statusField: 'status', openValue: 'pending', resolvedValue: 'resolved' },
  voicemail: { collection: 'voicemails', nested: false, statusField: 'status', openValue: 'open', resolvedValue: 'resolved' },
  low_confidence_call: { collection: 'call_logs', nested: false },
  calendar_sync: { collection: 'bookings', nested: true, retryable: true },
  sms_delivery: { collection: 'bookings', nested: true, retryable: true },
  email_delivery: { collection: 'bookings', nested: true, retryable: true },
};

function normalizeFlat(type, doc, { summary, detail }) {
  return {
    id: doc._id,
    type,
    createdAt: doc.created_at,
    summary,
    detail: detail || null,
    status: doc.resolved_at ? 'resolved' : 'open',
    assignedTo: doc.assigned_to ?? null,
    resolvedAt: doc.resolved_at ?? null,
    resolvedBy: doc.resolved_by ?? null,
    resolutionNotes: doc.resolution_notes ?? null,
    retryable: false,
  };
}

function normalizeNested(type, booking, { summary, detail }) {
  const state = booking.exceptions?.[type] ?? {};
  return {
    id: booking._id,
    type,
    createdAt: booking.created_at ?? booking.start_time,
    summary,
    detail: detail || null,
    status: state.resolved_at ? 'resolved' : 'open',
    assignedTo: state.assigned_to ?? null,
    resolvedAt: state.resolved_at ?? null,
    resolvedBy: state.resolved_by ?? null,
    resolutionNotes: state.resolution_notes ?? null,
    retryable: true,
  };
}

export async function listExceptions(businessId, status) {
  const [failedBookings, callbacks, voicemails, lowConfidenceCalls, failingBookings] = await Promise.all([
    withTenant(businessId, (c) => c('failed_bookings').find(status === 'open' ? { resolved_at: null } : { resolved_at: { $ne: null } }).toArray()),
    withTenant(businessId, (c) => c('callback_requests').find({ status: status === 'open' ? 'pending' : 'resolved' }).toArray()),
    withTenant(businessId, (c) => c('voicemails').find({ status: status === 'open' ? 'open' : 'resolved' }).toArray()),
    withTenant(businessId, (c) => c('call_logs').find({
      transfer_category: { $in: ['low_confidence', 'angry_customer'] },
      ...(status === 'open' ? { resolved_at: null } : { resolved_at: { $ne: null } }),
    }).toArray()),
    withTenant(businessId, (c) => c('bookings').find({
      $or: [{ sync_status: 'failed' }, { confirmation_sms_error: { $ne: null } }, { confirmation_email_error: { $ne: null } }],
    }).toArray()),
  ]);

  const items = [
    ...failedBookings.map((d) => normalizeFlat('failed_booking', d, {
      summary: `Booking failed for ${d.customer_name} (${d.phone})`,
      detail: d.error_message,
    })),
    ...callbacks.map((d) => normalizeFlat('callback_request', d, {
      summary: `Callback requested by ${d.phone}`,
      detail: d.reason,
    })),
    ...voicemails.map((d) => normalizeFlat('voicemail', d, {
      summary: `Voicemail from ${d.phone}`,
      detail: d.message,
    })),
    ...lowConfidenceCalls.map((d) => normalizeFlat('low_confidence_call', d, {
      summary: d.transfer_category === 'angry_customer' ? `Angry-customer escalation on a call from ${d.phone}` : `Low-confidence transfer on a call from ${d.phone}`,
      detail: (d.outcome ?? '').replace(/^transferred:\s*/, ''),
    })),
  ];

  for (const booking of failingBookings) {
    if (booking.sync_status === 'failed') {
      const entry = normalizeNested('calendar_sync', booking, { summary: `Calendar sync failed for ${booking.customer_name}'s booking`, detail: booking.sync_error });
      if (entry.status === status) items.push(entry);
    }
    if (booking.confirmation_sms_error) {
      const entry = normalizeNested('sms_delivery', booking, { summary: `SMS confirmation failed for ${booking.customer_name}`, detail: booking.confirmation_sms_error });
      if (entry.status === status) items.push(entry);
    }
    if (booking.confirmation_email_error) {
      const entry = normalizeNested('email_delivery', booking, { summary: `Email confirmation failed for ${booking.customer_name}`, detail: booking.confirmation_email_error });
      if (entry.status === status) items.push(entry);
    }
  }

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items;
}

exceptionsRouter.get('/exceptions', gate, async (req, res, next) => {
  try {
    const status = req.query.status === 'resolved' ? 'resolved' : 'open';
    res.json(await listExceptions(req.businessId, status));
  } catch (err) {
    next(err);
  }
});

exceptionsRouter.patch('/exceptions/:type/:id', gate, async (req, res, next) => {
  try {
    const config = TYPES[req.params.type];
    if (!config) return res.status(400).json({ error: 'unknown exception type' });
    const { assignedTo, status, resolutionNotes } = req.body ?? {};
    if (status !== undefined && !['open', 'resolved'].includes(status)) return res.status(400).json({ error: "status must be 'open' or 'resolved'" });

    const set = {};
    const prefix = config.nested ? `exceptions.${req.params.type}.` : '';
    if (assignedTo !== undefined) set[`${prefix}assigned_to`] = assignedTo || null;
    if (resolutionNotes !== undefined) set[`${prefix}resolution_notes`] = resolutionNotes || null;
    if (status === 'resolved') {
      set[`${prefix}resolved_at`] = new Date();
      set[`${prefix}resolved_by`] = req.adminId;
      if (config.statusField) set[config.statusField] = config.resolvedValue;
    }
    if (status === 'open') {
      set[`${prefix}resolved_at`] = null;
      set[`${prefix}resolved_by`] = null;
      if (config.statusField) set[config.statusField] = config.openValue;
    }
    if (Object.keys(set).length === 0) return res.status(400).json({ error: 'nothing to update' });

    const updated = await withTenant(req.businessId, (c) => c(config.collection).findOneAndUpdate({ _id: req.params.id }, { $set: set }, { returnDocument: 'after' }));
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

exceptionsRouter.post('/exceptions/:type/:id/retry', gate, async (req, res, next) => {
  try {
    const config = TYPES[req.params.type];
    if (!config?.retryable) return res.status(400).json({ error: 'this exception type cannot be retried' });

    if (req.params.type === 'calendar_sync') {
      const updated = await withTenant(req.businessId, (c) => c('bookings').findOneAndUpdate(
        { _id: req.params.id }, { $set: { sync_status: 'pending', sync_attempts: 0, sync_error: null } }, { returnDocument: 'after' }
      ));
      if (!updated) return res.status(404).json({ error: 'booking not found' });
      return res.json({ ok: true });
    }

    // sms_delivery / email_delivery — re-send via the exact same path the original
    // confirmation used, so a successful retry clears confirmation_sms_error/
    // confirmation_email_error the same way a first-time success would.
    const booking = await withTenant(req.businessId, (c) => c('bookings').findOne({ _id: req.params.id }));
    if (!booking) return res.status(404).json({ error: 'booking not found' });

    const db = await getDb();
    const [business, service] = await Promise.all([
      db.collection('businesses').findOne({ _id: req.businessId }),
      withTenant(req.businessId, (c) => c('services').findOne({ _id: booking.service_id })),
    ]);
    await sendBookingConfirmation({ ...business, id: req.businessId }, booking, service);

    const refreshed = await withTenant(req.businessId, (c) => c('bookings').findOne({ _id: req.params.id }));
    const stillFailing = req.params.type === 'sms_delivery' ? !!refreshed.confirmation_sms_error : !!refreshed.confirmation_email_error;
    res.json({ ok: true, stillFailing });
  } catch (err) {
    next(err);
  }
});
