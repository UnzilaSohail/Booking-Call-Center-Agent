'use client';
import { Fragment, useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { DateTime } from '../../lib/datetime';

function OutcomeBadge({ log }) {
  if (log.booking) return <span className="badge success">Booked</span>;
  if (log.outcome?.startsWith('emergency')) return <span className="badge danger">Emergency</span>;
  if (log.outcome?.startsWith('transferred')) return <span className="badge warning">Transferred</span>;
  if (log.outcome === 'voicemail') return <span className="badge info">Voicemail</span>;
  if (log.outcome === 'callback_requested') return <span className="badge info">Callback requested</span>;
  if (log.outcome === 'completed') return <span className="badge neutral">No booking</span>;
  if (log.outcome === 'in_progress') return <span className="badge info">In progress</span>;
  return <span className="badge neutral">{log.outcome || 'Unknown'}</span>;
}

function CallsInner() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    api.listCallLogs()
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Calls</h1>
        <p className="muted" style={{ marginTop: 4 }}>Every call the voice agent handled — what was said, and whether it resulted in a booking.</p>
      </div>

      <div className="card">
        {loading && <p className="muted">Loading...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <div className="empty-state">
            <Phone size={28} color="var(--text-faint)" />
            <p>No calls yet. Once your phone number is connected, calls will show up here automatically.</p>
          </div>
        )}

        {!loading && logs.length > 0 && (
          <table>
            <thead>
              <tr><th>When</th><th>Phone</th><th>Outcome</th><th>Booking</th><th></th></tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const expandable = log.transcript || log.voicemail || log.callbackRequest;
                return (
                  <Fragment key={log.id}>
                    <tr style={{ cursor: expandable ? 'pointer' : 'default' }} onClick={() => expandable && setExpandedId(expandedId === log.id ? null : log.id)}>
                      <td>{DateTime.formatDateTime(log.created_at)}</td>
                      <td>{log.phone || '—'}</td>
                      <td><OutcomeBadge log={log} /></td>
                      <td>{log.booking ? `${log.booking.customerName} — ${DateTime.formatDateTime(log.booking.startTime)}` : '—'}</td>
                      <td className="muted">{expandable ? (expandedId === log.id ? '▲ hide' : '▼ details') : ''}</td>
                    </tr>
                    {expandedId === log.id && expandable && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--surface-alt)' }}>
                          {log.voicemail && (
                            <div style={{ padding: '10px 12px', borderBottom: log.transcript ? '1px solid var(--border)' : 'none' }}>
                              <strong style={{ fontSize: 12.5 }}>Voicemail</strong>
                              <p style={{ fontSize: 13, margin: '4px 0 0' }}>{log.voicemail.message}</p>
                            </div>
                          )}
                          {log.callbackRequest && (
                            <div style={{ padding: '10px 12px', borderBottom: log.transcript ? '1px solid var(--border)' : 'none' }}>
                              <strong style={{ fontSize: 12.5 }}>Callback requested</strong>
                              <p style={{ fontSize: 13, margin: '4px 0 0' }}>
                                {log.callbackRequest.preferredTime ? `Preferred time: ${log.callbackRequest.preferredTime}. ` : ''}
                                {log.callbackRequest.reason}
                              </p>
                            </div>
                          )}
                          {log.transcript && (
                            <div style={{ padding: '10px 12px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                              {log.transcript}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function CallsPage() {
  return (
    <RequireAuth>
      <CallsInner />
    </RequireAuth>
  );
}
