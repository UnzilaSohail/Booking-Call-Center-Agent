'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { myBookingApi, ApiError } from '../../../lib/api';
import { DateTime } from '../../../lib/datetime';

// Public, token-authenticated self-service page (ROADMAP.md §6 "Reschedule link"/
// "Cancellation link") — reached from the link in a confirmation/reminder SMS or email
// (src/notifications/notify.js), no dashboard login at all. Same slot-picking shape
// BookingModal.jsx uses for the admin side, talking to the public src/routes/myBooking.js
// endpoints instead of the authenticated ones.
function ManageInner() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' | 'reschedule' | 'cancel-confirm' | 'done'
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState(null);

  function load() {
    myBookingApi.get(token).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : 'something went wrong'));
  }
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'reschedule') return;
    setLoadingSlots(true);
    setActionError(null);
    myBookingApi.getAvailability(token, date)
      .then((res) => setSlots(res.slots))
      .catch((e) => setActionError(e.message))
      .finally(() => setLoadingSlots(false));
  }, [mode, date, token]);

  async function confirmReschedule() {
    setSaving(true);
    setActionError(null);
    try {
      await myBookingApi.reschedule(token, selectedSlot);
      setMode('done');
      load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmCancel() {
    setSaving(true);
    setActionError(null);
    try {
      await myBookingApi.cancel(token);
      setMode('done');
      load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 0' }}>
      <div className="card" style={{ width: 440 }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600 }}>Manage your appointment</div>
        </div>

        {error && <p className="error-text">This link has expired or is invalid. Please contact the business directly to make changes.</p>}

        {!error && !data && <p className="muted">Loading...</p>}

        {!error && data && (
          <>
            <div className="stack" style={{ gap: 4, marginBottom: 18, fontSize: 14 }}>
              <div><strong>{data.businessName}</strong></div>
              <div>{data.serviceName} — {DateTime.formatDateTime(data.booking.startTime)}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                <span className={`badge ${data.booking.status === 'confirmed' ? 'success' : 'neutral'}`}>{data.booking.status}</span>
              </div>
              {data.preparationInstructions && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{data.preparationInstructions}</div>}
              {data.cancellationPolicy && <div className="muted" style={{ fontSize: 12.5 }}>{data.cancellationPolicy}</div>}
            </div>

            {mode === 'done' && <p className="success-text">Done — {data.booking.status === 'cancelled' ? 'your appointment has been cancelled.' : 'your appointment has been updated.'}</p>}

            {mode === 'view' && data.booking.status === 'confirmed' && (
              <div className="row">
                <button className="primary" onClick={() => setMode('reschedule')}>Reschedule</button>
                <button className="danger" onClick={() => setMode('cancel-confirm')}>Cancel</button>
              </div>
            )}

            {mode === 'reschedule' && (
              <>
                <div className="field">
                  <label>New date</label>
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
                {actionError && <p className="error-text">{actionError}</p>}
                <div className="row">
                  <button onClick={() => { setMode('view'); setSelectedSlot(null); }} disabled={saving}>Back</button>
                  <button className="primary" onClick={confirmReschedule} disabled={saving || !selectedSlot}>{saving ? 'Saving...' : 'Confirm new time'}</button>
                </div>
              </>
            )}

            {mode === 'cancel-confirm' && (
              <>
                <p>Cancel this appointment? This can't be undone.</p>
                {actionError && <p className="error-text">{actionError}</p>}
                <div className="row">
                  <button onClick={() => setMode('view')} disabled={saving}>Keep it</button>
                  <button className="danger" onClick={confirmCancel} disabled={saving}>{saving ? 'Cancelling...' : 'Yes, cancel it'}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ManagePage() {
  return <ManageInner />;
}
