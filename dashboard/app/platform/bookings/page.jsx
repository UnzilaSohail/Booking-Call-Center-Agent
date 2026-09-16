'use client';
import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import RequirePlatformAuth from '../../../components/RequirePlatformAuth';
import { platformApi } from '../../../lib/api';
import { DateTime } from '../../../lib/datetime';

function StatusBadge({ status }) {
  return <span className={`badge ${status === 'confirmed' ? 'success' : 'neutral'}`}>{status}</span>;
}

function BookingsInner() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('confirmed');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const search = useCallback(() => {
    setLoading(true);
    setError(null);
    platformApi.listBookings(q || undefined, status === 'all' ? undefined : status)
      .then(setResults)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, status]);

  useEffect(() => { search(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(search, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div>
        <h1>Bookings</h1>
        <p className="muted" style={{ marginTop: 4 }}>Every booking across every company, searchable by customer name or phone.</p>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 16 }}>
          <div style={{ flex: 1, position: 'relative', minWidth: 220 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-faint)' }} />
            <input placeholder="Search name or phone..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }} />
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
          <div className="empty-state">
            <Search size={28} color="var(--text-faint)" />
            <p>No bookings match.</p>
          </div>
        )}
        {!loading && results.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Customer</th><th>Phone</th><th>Company</th><th>Service</th><th>Status</th></tr></thead>
            <tbody>
              {results.map((b) => (
                <tr key={b.id}>
                  <td>{DateTime.formatDateTime(b.startTime)}</td>
                  <td>{b.customerName}</td>
                  <td>{b.phone}</td>
                  <td>{b.companyName}</td>
                  <td>{b.serviceName ?? '—'}</td>
                  <td><StatusBadge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function PlatformBookingsPage() {
  return (
    <RequirePlatformAuth>
      <BookingsInner />
    </RequirePlatformAuth>
  );
}
