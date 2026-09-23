'use client';
import { Fragment, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { DateTime } from '../../lib/datetime';

const TYPE_LABELS = {
  failed_booking: 'Failed booking',
  callback_request: 'Callback request',
  voicemail: 'Voicemail',
  low_confidence_call: 'Low-confidence call',
  calendar_sync: 'Calendar sync',
  sms_delivery: 'SMS delivery',
  email_delivery: 'Email delivery',
};

// Unified "needs staff attention" queue (ROADMAP.md §9) — src/routes/exceptions.js
// merges five otherwise-separate failure sources (failed bookings, calendar sync,
// message delivery, callback requests, voicemails, low-confidence transfers) into one
// list so staff have a single place to work through them instead of hunting across pages.
function ExceptionRow({ item, staffList, onChanged }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(item.resolutionNotes ?? '');
  const [saving, setSaving] = useState(false);

  async function assign(staffId) {
    try {
      await api.updateException(item.type, item.id, { assignedTo: staffId || null });
      toast.success('Assigned');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function resolve() {
    setSaving(true);
    try {
      await api.updateException(item.type, item.id, { status: 'resolved', resolutionNotes: notes || undefined });
      toast.success('Marked resolved');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    try {
      await api.updateException(item.type, item.id, { status: 'open' });
      toast.success('Reopened');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function retry() {
    setSaving(true);
    try {
      const res = await api.retryException(item.type, item.id);
      toast[res.stillFailing ? 'error' : 'success'](res.stillFailing ? 'Retried — still failing' : 'Retried — resolved');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Fragment>
      <tr>
        <td><span className="badge neutral">{TYPE_LABELS[item.type] ?? item.type}</span></td>
        <td>
          <div style={{ fontWeight: 550 }}>{item.summary}</div>
          {item.detail && <div className="muted" style={{ fontSize: 12 }}>{item.detail}</div>}
        </td>
        <td>{DateTime.formatDateTime(item.createdAt)}</td>
        <td>
          {item.status === 'open' ? (
            <select value={item.assignedTo ?? ''} onChange={(e) => assign(e.target.value)} style={{ maxWidth: 150 }}>
              <option value="">Unassigned</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (staffList.find((s) => s.id === item.assignedTo)?.name ?? '—')}
        </td>
        <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {item.retryable && item.status === 'open' && (
            <button className="icon-btn" onClick={retry} disabled={saving} title="Retry"><RefreshCw size={14} /></button>
          )}
          {item.status === 'open'
            ? <button className="ghost" onClick={() => setExpanded((v) => !v)}>Resolve</button>
            : <button className="ghost" onClick={reopen}>Reopen</button>}
        </td>
      </tr>
      {expanded && item.status === 'open' && (
        <tr>
          <td colSpan={5}>
            <div className="row" style={{ alignItems: 'flex-end', padding: '8px 0' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Resolution notes (optional)</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done about this" />
              </div>
              <button className="primary" onClick={resolve} disabled={saving}>{saving ? 'Saving...' : 'Mark resolved'}</button>
            </div>
          </td>
        </tr>
      )}
      {item.status === 'resolved' && item.resolutionNotes && (
        <tr><td colSpan={5} className="muted" style={{ fontSize: 12, paddingTop: 0 }}>Note: {item.resolutionNotes}</td></tr>
      )}
    </Fragment>
  );
}

function ExceptionsInner() {
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load() {
    setLoading(true);
    api.listExceptions(status).then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(load, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.listStaff().then(setStaffList).catch(() => {}); }, []);

  return (
    <div className="stack">
      <div>
        <h1>Exceptions</h1>
        <p className="muted" style={{ marginTop: 4 }}>Failed bookings, delivery failures, callback requests and calls that need a human to look at them.</p>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 16 }}>
          <button className={status === 'open' ? 'primary' : 'ghost'} onClick={() => setStatus('open')}>Open</button>
          <button className={status === 'resolved' ? 'primary' : 'ghost'} onClick={() => setStatus('resolved')}>Resolved</button>
        </div>

        {error && <p className="error-text">{error}</p>}
        {loading && <p className="muted">Loading...</p>}
        {!loading && items.length === 0 && <div className="empty-state"><p>{status === 'open' ? 'Nothing needs attention right now.' : 'Nothing resolved yet.'}</p></div>}
        {!loading && items.length > 0 && (
          <table>
            <thead><tr><th>Type</th><th>Details</th><th>When</th><th>Assigned to</th><th></th></tr></thead>
            <tbody>
              {items.map((item) => <ExceptionRow key={`${item.type}:${item.id}`} item={item} staffList={staffList} onChanged={load} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function ExceptionsPage() {
  return (
    <RequireAuth area="exceptions">
      <ExceptionsInner />
    </RequireAuth>
  );
}
