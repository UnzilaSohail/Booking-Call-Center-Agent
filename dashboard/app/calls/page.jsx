'use client';
import Transcript from '../../components/Transcript';
import { Fragment, useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { DateTime } from '../../lib/datetime';
import Loading from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';

// What the AI was trying to do when something went wrong, in everyday words.
const TOOL_NAMES = {
  create_booking: 'Making a booking', check_availability: 'Checking free times', cancel_booking: 'Cancelling a booking',
  reschedule_booking: 'Moving a booking', find_upcoming_bookings: "Looking up the caller's bookings", request_callback: 'Arranging a call back',
  flag_emergency: 'Flagging an emergency', transfer_call: 'Transferring the call',
};

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

const OUTCOME_FILTERS = [
  { value: '', label: 'All outcomes' },
  { value: 'booked', label: 'Booked' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'callback_requested', label: 'Callback requested' },
  { value: 'completed', label: 'No booking' },
];

// Fetches a short-lived link for this one recording when the row is opened.
function Recording({ id }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.callRecordingUrl(id).then(setSrc).catch(() => setFailed(true)); }, [id]);
  if (failed) return <span className="error-text" style={{ fontSize: 12.5 }}>Recording unavailable.</span>;
  if (!src) return <Loading lines={1} height={28} style={{ width: 260 }} />;
  return <audio controls src={src} style={{ height: 32, width: '100%', maxWidth: 360 }} />;
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function CallsInner() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [phone, setPhone] = useState('');
  const [outcome, setOutcome] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  function load() {
    setLoading(true);
    api.listCallLogs({ phone, outcome, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined })
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div>
        <h1>Calls</h1>
        <p className="muted" style={{ marginTop: 4 }}>Every call the voice agent handled — what was said, and whether it resulted in a booking.</p>
      </div>

      <div className="card" style={{ paddingBottom: 14 }}>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Search by phone" style={{ width: 160 }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Outcome</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ width: 170 }}>
              {OUTCOME_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="submit" className="primary">Filter</button>
        </form>
      </div>

      <div className="card">
        {loading && <Loading />}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <EmptyState icon={Phone} action={{ label: 'Set up your phone number', href: '/settings#calls' }}>
            No calls yet. Once your phone number is connected, every call shows up here with a summary.
          </EmptyState>
        )}

        {!loading && logs.length > 0 && (
          <table>
            <thead>
              <tr><th>When</th><th>Phone</th><th>Outcome</th><th>Intent</th><th>Duration</th><th>Booking</th><th></th></tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const expandable = log.transcript || log.summary || log.recording_url || log.voicemail || log.callbackRequest || log.transfer || log.failed_actions?.length;
                return (
                  <Fragment key={log.id}>
                    <tr style={{ cursor: expandable ? 'pointer' : 'default' }} onClick={() => expandable && setExpandedId(expandedId === log.id ? null : log.id)}>
                      <td>
                        {DateTime.formatDateTime(log.created_at)}
                        {log.is_after_hours && <span className="badge neutral" style={{ marginLeft: 6 }}>After hours</span>}
                      </td>
                      <td>{log.phone || '—'}</td>
                      <td><OutcomeBadge log={log} /></td>
                      <td className="muted" style={{ fontSize: 12.5 }}>{log.intent || '—'}</td>
                      <td>{formatDuration(log.duration_seconds)}</td>
                      <td>{log.booking ? `${log.booking.customerName} — ${DateTime.formatDateTime(log.booking.startTime)}` : '—'}</td>
                      <td className="muted">{expandable ? (expandedId === log.id ? '▲ hide' : '▼ details') : ''}</td>
                    </tr>
                    {expandedId === log.id && expandable && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--surface-alt)' }}>
                          {log.summary && (
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                              <strong style={{ fontSize: 12.5 }}>AI summary</strong>
                              <p style={{ fontSize: 13, margin: '4px 0 0' }}>{log.summary}</p>
                            </div>
                          )}
                          {log.recording_url && (
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                              <strong style={{ fontSize: 12.5 }}>Recording</strong>
                              <div style={{ marginTop: 4 }}><Recording id={log.id} /></div>
                            </div>
                          )}
                          {log.voicemail && (
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                              <strong style={{ fontSize: 12.5 }}>Voicemail</strong>
                              <p style={{ fontSize: 13, margin: '4px 0 0' }}>{log.voicemail.message}</p>
                            </div>
                          )}
                          {log.callbackRequest && (
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                              <strong style={{ fontSize: 12.5 }}>Callback requested</strong>
                              <p style={{ fontSize: 13, margin: '4px 0 0' }}>
                                {log.callbackRequest.preferredTime ? `Preferred time: ${log.callbackRequest.preferredTime}. ` : ''}
                                {log.callbackRequest.reason}
                              </p>
                            </div>
                          )}
                          {log.transfer && (
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                              <strong style={{ fontSize: 12.5 }}>Transfer</strong>
                              <p style={{ fontSize: 13, margin: '4px 0 0' }}>
                                To {log.transfer.targetPhone ?? 'no number configured'} — {log.transfer.reason}.{' '}
                                {log.transfer.status === 'answered' && `Answered${log.transfer.durationSeconds != null ? ` (${formatDuration(log.transfer.durationSeconds)})` : ''}.`}
                                {log.transfer.status === 'failed' && 'Not answered — callback created.'}
                                {log.transfer.status === 'redirected' && 'Redirect sent, awaiting result.'}
                              </p>
                            </div>
                          )}
                          {log.failed_actions?.length > 0 && (
                            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                              <strong style={{ fontSize: 12.5 }}>Things the AI could not do</strong>
                              <ul style={{ fontSize: 13, margin: '4px 0 0', paddingLeft: 18 }}>
                                {log.failed_actions.map((f, i) => (
                                  <li key={i}>{TOOL_NAMES[f.tool] ?? String(f.tool).replace(/_/g, ' ')}: {f.error}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {log.transcript && (
                            <Transcript text={log.transcript} />
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
    <RequireAuth area="calls">
      <CallsInner />
    </RequireAuth>
  );
}
