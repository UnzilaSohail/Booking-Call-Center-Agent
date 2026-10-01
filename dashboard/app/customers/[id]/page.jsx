'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, X } from 'lucide-react';
import RequireAuth from '../../../components/RequireAuth';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/Toast';
import { DateTime } from '../../../lib/datetime';
import Loading from '../../../components/Skeleton';
import { useConfirm } from '../../../lib/confirm';

// Staff review of "same person, new phone" (Jira 18k/18l/18m). Same email is a strong match;
// same name alone is weak, so it is labelled. Merging folds the other record into this one.
function DuplicatesCard({ id, onMerged }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { api.getDuplicates(id).then(setRows).catch(() => setRows([])); }, [id]);
  if (!rows?.length) return null;

  async function merge(d) {
    if (!(await confirm({ title: 'Merge these customers?', message: `Merge ${d.name || d.phone} (${d.phone}) into this customer? Their bookings and calls move here and their record is deleted.`, confirmLabel: 'Merge', danger: true }))) return;
    setBusy(d.id);
    try {
      await api.mergeCustomer(id, d.id);
      toast.success('Merged');
      setRows((r) => r.filter((x) => x.id !== d.id));
      onMerged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>Possible duplicates</h2>
      <p className="muted" style={{ marginTop: 0 }}>Other records that look like the same person, for example after they booked from a new phone.</p>
      <table>
        <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Matched on</th><th></th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/customers/${d.id}`}>{d.name || '(no name)'}</Link></td>
              <td>{d.phone}</td>
              <td>{d.email || '—'}</td>
              <td><span className={`badge ${d.matchedOn === 'email' ? 'success' : 'warning'}`}>{d.matchedOn === 'email' ? 'same email' : 'same name only'}</span></td>
              <td><button type="button" onClick={() => merge(d)} disabled={busy === d.id}>{busy === d.id ? 'Merging...' : 'Merge into this customer'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerDetailInner() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const [customer, setCustomer] = useState(null);
  const [services, setServices] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [form, setForm] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.getCustomer(id).then((c) => {
      setCustomer(c);
      setForm({ name: c.name ?? '', email: c.email ?? '', notes: c.notes ?? '', tags: c.tags ?? [], preferences: c.preferences, consent: c.consent });
    }).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); api.listServices().then(setServices).catch(() => {}); api.listStaff().then(setStaffList).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateCustomer(id, form);
      toast.success('Customer updated');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    if (!newTag.trim()) return;
    setForm((f) => ({ ...f, tags: [...f.tags, newTag.trim()] }));
    setNewTag('');
  }
  function removeTag(tag) {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!customer || !form) return <Loading />;

  const serviceName = (sid) => services.find((s) => s.id === sid)?.name ?? '—';

  return (
    <div className="stack">
      <div>
        <button className="ghost" onClick={() => router.push('/customers')} style={{ marginBottom: 10 }}>
          <ArrowLeft size={14} /> All customers
        </button>
        <h1>{customer.name || customer.phone}</h1>
      </div>

      <div className="card">
        <h2>Profile</h2>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Phone</label>
            <input value={customer.phone} disabled />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label>Notes</label>
          <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything staff should know about this customer." />
        </div>

        <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tags</label>
        <div className="row" style={{ alignItems: 'center', marginTop: 6, marginBottom: 10 }}>
          {form.tags.map((t) => (
            <span key={t} className="badge neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {t}
              <button className="icon-btn" style={{ padding: 0, width: 14, height: 14 }} onClick={() => removeTag(t)}><X size={11} /></button>
            </span>
          ))}
          <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag" style={{ width: 140 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} />
          <button className="icon-btn" onClick={addTag}><Plus size={14} /></button>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Preferred staff</label>
            <select value={form.preferences?.preferredStaffId ?? ''} onChange={(e) => setForm({ ...form, preferences: { ...form.preferences, preferredStaffId: e.target.value || null } })}>
              <option value="">No preference</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Preferred service</label>
            <select value={form.preferences?.preferredServiceId ?? ''} onChange={(e) => setForm({ ...form, preferences: { ...form.preferences, preferredServiceId: e.target.value || null } })}>
              <option value="">No preference</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Preferred contact method</label>
            <select value={form.preferences?.preferredContactMethod ?? ''} onChange={(e) => setForm({ ...form, preferences: { ...form.preferences, preferredContactMethod: e.target.value || null } })}>
              <option value="">No preference</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="call">Call</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Language</label>
            <select value={form.preferences?.language ?? ''} onChange={(e) => setForm({ ...form, preferences: { ...form.preferences, language: e.target.value || null } })}>
              <option value="">Not set</option>
              {[['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['ar', 'Arabic'], ['ur', 'Urdu'], ['hi', 'Hindi']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Consent</label>
        <div className="row" style={{ marginTop: 6, marginBottom: 4, gap: 18 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.consent?.recordingAcknowledged ?? false} onChange={(e) => setForm({ ...form, consent: { ...form.consent, recordingAcknowledged: e.target.checked } })} />
            Recording disclosure acknowledged
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.consent?.smsOptIn ?? true} onChange={(e) => setForm({ ...form, consent: { ...form.consent, smsOptIn: e.target.checked } })} />
            SMS opt-in
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.consent?.emailOptIn ?? true} onChange={(e) => setForm({ ...form, consent: { ...form.consent, emailOptIn: e.target.checked } })} />
            Email opt-in
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}
        <button className="primary" onClick={save} disabled={saving} style={{ marginTop: 10 }}>{saving ? 'Saving...' : 'Save'}</button>
      </div>

      <DuplicatesCard id={id} onMerged={load} />

      <div className="card">
        <h2>Booking history</h2>
        {customer.bookings.length === 0 && <p className="muted">No bookings yet.</p>}
        {customer.bookings.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Service</th><th>Ref</th><th>Booked via</th><th>Status</th><th>Confirmed</th></tr></thead>
            <tbody>
              {customer.bookings.map((b) => (
                <tr key={b.id}>
                  <td>{DateTime.formatDateTime(b.startTime)}</td>
                  <td>{serviceName(b.serviceId)}</td>
                  <td>{b.reference ?? '—'}</td>
                  <td><span className="badge neutral">{{ call: 'Phone', web: 'Web', dashboard: 'Dashboard' }[b.createdVia] ?? 'Dashboard'}</span></td>
                  <td><span className={`badge ${b.status === 'confirmed' ? 'success' : 'neutral'}`}>{b.status}</span></td>
                  <td>{b.confirmationSentAt ? DateTime.formatDateTime(b.confirmationSentAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Call history</h2>
        {customer.calls.length === 0 && <p className="muted">No calls yet.</p>}
        {customer.calls.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Outcome</th></tr></thead>
            <tbody>
              {customer.calls.map((c) => (
                <tr key={c.id}>
                  <td>{DateTime.formatDateTime(c.createdAt)}</td>
                  <td>{c.outcome || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  return (
    <RequireAuth area="customers">
      <CustomerDetailInner />
    </RequireAuth>
  );
}
