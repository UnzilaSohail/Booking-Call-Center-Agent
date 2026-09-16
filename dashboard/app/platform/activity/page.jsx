'use client';
import { Fragment, useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import RequirePlatformAuth from '../../../components/RequirePlatformAuth';
import { platformApi } from '../../../lib/api';
import { DateTime } from '../../../lib/datetime';

function OutcomeBadge({ log }) {
  if (log.booking) return <span className="badge success">Booked</span>;
  if (log.outcome?.startsWith('transferred')) return <span className="badge warning">Transferred</span>;
  if (log.outcome === 'completed') return <span className="badge neutral">No booking</span>;
  if (log.outcome === 'in_progress') return <span className="badge info">In progress</span>;
  return <span className="badge neutral">{log.outcome || 'Unknown'}</span>;
}

function ActivityInner() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    platformApi.listCallLogs()
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Agent activity</h1>
        <p className="muted" style={{ marginTop: 4 }}>Every call the voice agent has handled, across every company.</p>
      </div>

      <div className="card">
        {loading && <p className="muted">Loading...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <div className="empty-state">
            <Phone size={28} color="var(--text-faint)" />
            <p>No calls yet, anywhere.</p>
          </div>
        )}

        {!loading && logs.length > 0 && (
          <table>
            <thead>
              <tr><th>When</th><th>Company</th><th>Phone</th><th>Outcome</th><th>Booking</th><th></th></tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <tr style={{ cursor: log.transcript ? 'pointer' : 'default' }} onClick={() => log.transcript && setExpandedId(expandedId === log.id ? null : log.id)}>
                    <td>{DateTime.formatDateTime(log.createdAt)}</td>
                    <td>{log.companyName}</td>
                    <td>{log.phone || '—'}</td>
                    <td><OutcomeBadge log={log} /></td>
                    <td>{log.booking ? `${log.booking.customerName} — ${DateTime.formatDateTime(log.booking.startTime)}` : '—'}</td>
                    <td className="muted">{log.transcript ? (expandedId === log.id ? '▲ hide' : '▼ transcript') : ''}</td>
                  </tr>
                  {expandedId === log.id && log.transcript && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--surface-alt)', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                        {log.transcript}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function PlatformActivityPage() {
  return (
    <RequirePlatformAuth>
      <ActivityInner />
    </RequirePlatformAuth>
  );
}
