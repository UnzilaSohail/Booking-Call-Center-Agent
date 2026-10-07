'use client';
import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import BookingModal from '../../components/BookingModal';
import { api } from '../../lib/api';
import { DateTime } from '../../lib/datetime';
import { useToast } from '../../lib/Toast';
import EmptyState from '../../components/EmptyState';

function StatusBadge({ status }) {
  return <span className={`badge ${status === 'confirmed' ? 'success' : 'neutral'}`}>{status}</span>;
}

// "Failed-message alerts" (ROADMAP.md §6) — src/notifications/notify.js records a send
// failure on the booking instead of only logging it; this is where an admin actually
// sees it, right where they already look for a given customer's booking.
// Jira 29o: what happened to each confirmation message. Older bookings only have the error fields.
const DELIVERY = {
  sent: ['success', 'sent'], failed: ['danger', 'failed'], not_configured: ['warning', 'not sent'], opted_out: ['neutral', 'opted out'],
};
function DeliveryBadge({ booking }) {
  const channels = [['SMS', booking.confirmation_sms_status, booking.confirmation_sms_error], ['Email', booking.confirmation_email_status, booking.confirmation_email_error]]
    .map(([name, status, error]) => [name, status ?? (error ? 'failed' : null), error])
    .filter(([, status]) => DELIVERY[status]);
  if (!channels.length) return null;
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
      {channels.map(([name, status, error]) => (
        <span key={name} className={`badge ${DELIVERY[status][0]}`} title={error ?? undefined}>{name} {DELIVERY[status][1]}</span>
      ))}
    </span>
  );
}

// People who asked to be texted if a time opens up on a full day (Jira 38). Hidden when nobody is waiting.
function WaitlistCard() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const load = useCallback(() => api.listWaitlist().then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (rows.length === 0) return null;
  async function remove(id) {
    try { await api.removeWaitlistEntry(id); load(); } catch (err) { toast.error(err.message); }
  }
  return (
    <div className="card">
      <h2>Waiting list</h2>
      <p className="muted" style={{ fontSize: 13, margin: '2px 0 10px' }}>Customers who found a day full. When someone cancels, the first in line are texted automatically.</p>
      <table>
        <thead><tr><th>Day</th><th>Customer</th><th>Phone</th><th>Service</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{new Date(`${r.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</td>
              <td>{r.name}</td><td>{r.phone}</td><td>{r.service_name ?? '—'}</td>
              <td><span className={`badge ${r.status === 'notified' ? 'info' : 'warning'}`}>{r.status === 'notified' ? 'Texted' : 'Waiting'}</span></td>
              <td><button type="button" className="ghost" onClick={() => remove(r.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookingsInner() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('confirmed');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [services, setServices] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [modal, setModal] = useState(null);
  const [shown, setShown] = useState(25); // long histories are revealed 25 at a time

  useEffect(() => {
    api.listServices().then(setServices).catch(() => {});
    api.listStaff().then(setStaffList).catch(() => {});
  }, []);

  const search = useCallback(() => {
    setLoading(true);
    setError(null);
    api.listBookings(undefined, undefined, { q: q || undefined, status: status === 'all' ? undefined : status })
      .then((r) => {
        // upcoming first (soonest at the top), then history (most recent first)
        const now = Date.now();
        const up = r.filter((b) => new Date(b.start_time) >= now).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        setResults([...up, ...r.filter((b) => new Date(b.start_time) < now).sort((a, b) => new Date(b.start_time) - new Date(a.start_time))]);
        setShown(25);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, status]);

  useEffect(() => { search(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(search, 350); // debounce free-text typing
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // A visit that already happened: staff say whether the customer came. Feeds the no-show rate on Overview and in the monthly report.
  async function markNoShow(b, flag) {
    try {
      await api.markNoShow(b.id, flag);
      setResults((rows) => rows.map((r) => (r.id === b.id ? { ...r, no_show: flag } : r)));
      toast.success(flag ? 'Marked as a no-show' : 'No-show removed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  function onSaved() {
    toast.success(modal?.mode === 'edit' ? 'Booking updated' : 'Booking created');
    setModal(null);
    search();
  }

  return (
    <div className="stack">
      <div>
        <h1>Bookings</h1>
        <p className="muted" style={{ marginTop: 4 }}>Search by customer name, phone or email — for when someone calls asking about their appointment.</p>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 16 }}>
          <div style={{ flex: 1, position: 'relative', minWidth: 220 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-faint)' }} />
            <input placeholder="Search name, phone or email..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </div>

        {error && <p className="error-text">{error}</p>}
        {loading && <p className="muted">Searching...</p>}
        {!loading && results.length === 0 && (
          <EmptyState icon={Search} action={{ label: 'Create a booking', onClick: () => setModal({ mode: 'create' }) }}>
            No bookings match. Try another search, or add one by hand.
          </EmptyState>
        )}
        {!loading && results.length > 0 && (
          <table className="bookings-table">
            <thead><tr><th>When</th><th>Customer</th><th>Phone</th><th>Service</th><th>Booked via</th><th>Status</th><th>Confirmation</th><th>Visit</th></tr></thead>
            <tbody>
              {results.slice(0, shown).map((b) => (
                <tr key={b.id} style={{ cursor: b.status === 'confirmed' ? 'pointer' : 'default' }} onClick={() => b.status === 'confirmed' && setModal({ mode: 'edit', booking: b })}>
                  <td>{DateTime.formatDateTime(b.start_time)}</td>
                  <td>{b.customer_name}{b.customer_email && <div className="muted" style={{ fontSize: 12 }}>{b.customer_email}</div>}</td>
                  <td>{b.phone}</td>
                  <td>{b.service_name}</td>
                  <td><span className="badge neutral">{{ call: 'Phone', web: 'Web', dashboard: 'Dashboard' }[b.created_via] ?? 'Dashboard'}</span></td>
                  <td><StatusBadge status={b.status} /></td>
                  <td><DeliveryBadge booking={b} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {b.status === 'confirmed' && new Date(b.start_time) < new Date() && (b.no_show
                      ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}><span className="badge danger">No-show</span><button type="button" className="ghost" onClick={() => markNoShow(b, false)}>Undo</button></span>
                      : <button type="button" className="ghost" onClick={() => markNoShow(b, true)} title="The customer did not come">Mark no-show</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && results.length > shown && (
          <div className="row" style={{ justifyContent: 'center', alignItems: 'center', marginTop: 14 }}>
            <span className="muted" style={{ fontSize: 13 }}>Showing {shown} of {results.length}</span>
            <button type="button" onClick={() => setShown(shown + 50)}>Show more</button>
          </div>
        )}
      </div>

      <WaitlistCard />

      {modal && (
        <BookingModal
          mode={modal.mode}
          booking={modal.booking}
          services={services}
          staffList={staffList}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

export default function BookingsPage() {
  return (
    <RequireAuth area="bookings">
      <BookingsInner />
    </RequireAuth>
  );
}
