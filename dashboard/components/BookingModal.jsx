'use client';
import { useEffect, useState } from 'react';
import { DateTime } from '../lib/datetime';
import { api } from '../lib/api';

// Handles both "new booking" and "existing booking" flows through the same slot-picking
// UX the plan requires for calls too (plan.md §5 step 6: read back/confirm before
// booking) — here that's just "pick a listed slot," never a freehand time.
export default function BookingModal({ mode, booking, initialDate, services, staffList, locations = [], onClose, onSaved }) {
  const [customerName, setCustomerName] = useState(booking?.customer_name ?? '');
  const [phone, setPhone] = useState(booking?.phone ?? '');
  const [customerEmail, setCustomerEmail] = useState(booking?.customer_email ?? '');
  const [serviceId, setServiceId] = useState(booking?.service_id ?? services[0]?.id ?? '');
  const [staffId, setStaffId] = useState(booking?.staff_id ?? '');
  const [locationId, setLocationId] = useState(booking?.location_id ?? '');
  const [date, setDate] = useState((initialDate ?? (booking ? new Date(booking.start_time) : new Date())).toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isReschedule = mode === 'edit';

  useEffect(() => {
    if (!serviceId || !date) return;
    setLoadingSlots(true);
    setError(null);
    api.getAvailability(serviceId, date, staffId || undefined, isReschedule ? booking.id : undefined)
      .then((res) => setSlots(res.slots))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingSlots(false));
  }, [serviceId, date, staffId, isReschedule, booking]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!selectedSlot) throw new Error('pick a time slot first');
      if (isReschedule) {
        await api.rescheduleBooking(booking.id, selectedSlot);
      } else {
        await api.createBooking({ customerName, phone, customerEmail: customerEmail || undefined, serviceId, staffId: staffId || undefined, locationId: locationId || undefined, startTime: selectedSlot });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    setSaving(true);
    setError(null);
    try {
      await api.cancelBooking(booking.id);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isReschedule ? 'Reschedule / cancel booking' : 'New booking'}</h2>

        {!isReschedule && (
          <>
            <div className="field">
              <label>Customer name</label>
              <input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label>Email (optional)</label>
              <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
            </div>
          </>
        )}

        {isReschedule && (
          <p className="muted">{booking.service_name} for {booking.customer_name} ({booking.phone})</p>
        )}

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Service</label>
            <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSelectedSlot(null); }} disabled={isReschedule}>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {staffList.length > 0 && (
            <div className="field" style={{ flex: 1 }}>
              <label>Staff (optional)</label>
              {/* Locked during reschedule: rescheduleBooking only ever changes the time,
                  never the staff assignment — picking a different one here would silently
                  do nothing, so don't offer it. */}
              <select value={staffId} onChange={(e) => { setStaffId(e.target.value); setSelectedSlot(null); }} disabled={isReschedule}>
                <option value="">Any</option>
                {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {locations.length > 1 && (
            <div className="field" style={{ flex: 1 }}>
              <label>Location (optional)</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={isReschedule}>
                <option value="">Not specified</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSelectedSlot(null); }} />
        </div>

        <div className="field">
          <label>Available times</label>
          {loadingSlots && <p className="muted">Loading...</p>}
          {!loadingSlots && slots.length === 0 && <p className="muted">No open slots this day.</p>}
          <div className="row">
            {slots.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setSelectedSlot(slot)}
                style={selectedSlot === slot ? { background: 'var(--ink)', color: 'var(--ink-text)', borderColor: 'var(--ink)' } : undefined}
              >
                {DateTime.formatTime(slot)}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
          {isReschedule && <button className="danger" onClick={cancel} disabled={saving}>Cancel booking</button>}
          <button onClick={onClose} disabled={saving}>Close</button>
          <button className="primary" onClick={save} disabled={saving || !selectedSlot}>
            {saving ? 'Saving...' : isReschedule ? 'Reschedule' : 'Book'}
          </button>
        </div>
      </div>
    </div>
  );
}
