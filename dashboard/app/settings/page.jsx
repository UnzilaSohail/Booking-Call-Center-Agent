'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { useTimezones } from '../../lib/timezones';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const INDUSTRIES = ['Salon / Spa', 'Medical / Dental', 'Fitness', 'Home Services', 'Restaurant', 'Professional Services', 'Other'];

function BusinessProfileSection() {
  const toast = useToast();
  const TIMEZONES = useTimezones();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getBusiness().then(setForm).catch((e) => setError(e.message)); }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateBusiness({
        name: form.name, industry: form.industry, timezone: form.timezone, rescheduleCutoffMinutes: Number(form.rescheduleCutoffMinutes),
        contactEmail: form.contactEmail, contactPhone: form.contactPhone, address: form.address,
      });
      toast.success('Business profile saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  return (
    <div className="card">
      <h2>Business profile</h2>
      <form onSubmit={save}>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Business name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Timezone</label>
            <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Industry</label>
            <select value={form.industry ?? ''} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
              <option value="">Not set</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Booking phone number</label>
            <input value={form.phoneNumber ?? 'Not provisioned yet'} disabled />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Call-in change cutoff (minutes)</label>
            <input type="number" min={0} value={form.rescheduleCutoffMinutes} onChange={(e) => setForm({ ...form, rescheduleCutoffMinutes: e.target.value })} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
          How close to an appointment a caller can still reschedule/cancel it by phone. Dashboard admins can always override.
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Contact email</label>
            <input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Contact phone</label>
            <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="General/support number, not the booking line" />
          </div>
        </div>
        <div className="field">
          <label>Address</label>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button>
      </form>
    </div>
  );
}

function LocationsSection() {
  const toast = useToast();
  const [locations, setLocations] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', contactPhone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.listLocations().then(setLocations).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function add(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    setError(null);
    try {
      await api.createLocation(form);
      setForm({ name: '', address: '', contactPhone: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      await api.deleteLocation(id);
      toast.success('Location removed');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!locations) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  return (
    <div className="card">
      <h2>Locations</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Additional addresses this business operates from. Booking/calls stay routed through the one phone number above.
      </p>
      <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
        {locations.map((loc) => (
          <div key={loc.id} className="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <strong>{loc.name}</strong>{loc.is_primary && <span className="badge neutral" style={{ marginLeft: 6 }}>Primary</span>}
              {loc.address && <div className="muted" style={{ fontSize: 12.5 }}>{loc.address}</div>}
            </div>
            <button className="icon-btn" onClick={() => remove(loc.id)}><Trash2 size={15} color="var(--danger)" /></button>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Downtown branch" />
        </div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Address</label>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Contact phone</label>
          <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
        </div>
        <button type="submit" className="primary" disabled={saving}><Plus size={14} /> Add</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function ChangePasswordSection() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.changePassword({ currentPassword, newPassword });
      toast.success('Password changed');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Change password</h2>
      <form onSubmit={submit} className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Current password</label>
          <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>New password</label>
          <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Change'}</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function BusinessHoursSection() {
  const toast = useToast();
  const [rows, setRows] = useState(DAY_NAMES.map((_, day) => ({ dayOfWeek: day, closed: true, openTime: '09:00', closeTime: '17:00' })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getBusinessHours().then((hours) => {
      setRows((prev) => prev.map((row) => {
        const match = hours.find((h) => h.day_of_week === row.dayOfWeek);
        return match ? { ...row, closed: false, openTime: match.open_time.slice(0, 5), closeTime: match.close_time.slice(0, 5) } : row;
      }));
    }).catch((e) => setError(e.message));
  }, []);

  function updateRow(day, patch) {
    setRows((prev) => prev.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const hours = rows.filter((r) => !r.closed).map((r) => ({ dayOfWeek: r.dayOfWeek, openTime: r.openTime, closeTime: r.closeTime }));
      await api.putBusinessHours(hours);
      toast.success('Business hours saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Business hours</h2>
      {rows.map((r) => (
        <div key={r.dayOfWeek} className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
          <label style={{ width: 110, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={!r.closed} onChange={(e) => updateRow(r.dayOfWeek, { closed: !e.target.checked })} style={{ width: 'auto' }} /> {DAY_NAMES[r.dayOfWeek]}
          </label>
          <input type="time" disabled={r.closed} value={r.openTime} onChange={(e) => updateRow(r.dayOfWeek, { openTime: e.target.value })} style={{ width: 120 }} />
          <span className="muted">to</span>
          <input type="time" disabled={r.closed} value={r.closeTime} onChange={(e) => updateRow(r.dayOfWeek, { closeTime: e.target.value })} style={{ width: 120 }} />
        </div>
      ))}
      <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save hours'}</button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

const EMPTY_KNOWLEDGE_FORM = {
  greeting: '', faqs: [{ question: '', answer: '' }], bookingPolicy: '', cancellationPolicy: '',
  preparationInstructions: '', restrictedTopics: '', emergencyRules: '', pronunciation: [{ term: '', pronunciation: '' }],
};

function toForm(k) {
  return {
    greeting: k.greeting ?? '',
    faqs: k.faqs?.length ? k.faqs : [{ question: '', answer: '' }],
    bookingPolicy: k.booking_policy ?? '',
    cancellationPolicy: k.cancellation_policy ?? '',
    preparationInstructions: k.preparation_instructions ?? '',
    restrictedTopics: k.restricted_topics ?? '',
    emergencyRules: k.emergency_rules ?? '',
    pronunciation: k.pronunciation?.length ? k.pronunciation : [{ term: '', pronunciation: '' }],
  };
}

// Knowledge base: everything the voice agent's system prompt is built from
// (src/voice/geminiSession.js), edited here as a draft and only reaching live calls once
// published — see src/routes/knowledge.js for the draft/publish/rollback model.
function KnowledgeBaseSection() {
  const toast = useToast();
  const [status, setStatus] = useState(null); // { publishedAt, hasUnpublishedChanges }
  const [form, setForm] = useState(EMPTY_KNOWLEDGE_FORM);
  const [versions, setVersions] = useState(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.getKnowledge().then((k) => {
      setForm(toForm(k.draft));
      setStatus({ publishedAt: k.publishedAt, hasUnpublishedChanges: k.hasUnpublishedChanges });
    }).catch((e) => setError(e.message));
    api.getKnowledgeVersions().then(setVersions).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function updateRow(field, i, patch) {
    setForm((prev) => ({ ...prev, [field]: prev[field].map((row, idx) => (idx === i ? { ...row, ...patch } : row)) }));
  }
  function addRow(field, empty) {
    setForm((prev) => ({ ...prev, [field]: [...prev[field], empty] }));
  }
  function removeRow(field, i) {
    setForm((prev) => ({ ...prev, [field]: prev[field].filter((_, idx) => idx !== i) }));
  }

  async function saveDraft() {
    setSaving(true);
    setError(null);
    try {
      await api.saveKnowledgeDraft({
        ...form,
        faqs: form.faqs.filter((f) => f.question.trim() && f.answer.trim()),
        pronunciation: form.pronunciation.filter((p) => p.term.trim() && p.pronunciation.trim()),
      });
      toast.success('Draft saved');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      await api.publishKnowledge();
      toast.success('Knowledge base published — live calls now use it');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function rollback(version) {
    try {
      await api.rollbackKnowledge(version);
      toast.success(`Rolled back to version ${version}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!status) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Knowledge base</h2>
        {status.hasUnpublishedChanges && <span className="badge warning">Unpublished changes</span>}
      </div>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Everything the voice agent knows and follows on calls. Edits here are a draft —
        callers keep getting the last <strong>published</strong> version until you publish.
        {status.publishedAt && <> Last published {new Date(status.publishedAt).toLocaleString()}.</>}
      </p>

      <div className="field">
        <label>Greeting</label>
        <input value={form.greeting} onChange={(e) => setForm({ ...form, greeting: e.target.value })} placeholder="Thanks for calling Bright Smiles Dental!" />
      </div>

      <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Common questions (Q&amp;A)</label>
      <div className="stack" style={{ gap: 8, marginTop: 6, marginBottom: 10 }}>
        {form.faqs.map((f, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input value={f.question} onChange={(e) => updateRow('faqs', i, { question: e.target.value })} placeholder="Do you take walk-ins?" />
            </div>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <input value={f.answer} onChange={(e) => updateRow('faqs', i, { answer: e.target.value })} placeholder="Yes, subject to availability." />
            </div>
            <button className="icon-btn" onClick={() => removeRow('faqs', i)} disabled={form.faqs.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
        <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addRow('faqs', { question: '', answer: '' })}><Plus size={14} /> Add another question</button>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Booking policy</label>
          <textarea rows={2} value={form.bookingPolicy} onChange={(e) => setForm({ ...form, bookingPolicy: e.target.value })} placeholder="e.g. A card is required to hold same-day bookings." />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Cancellation policy</label>
          <textarea rows={2} value={form.cancellationPolicy} onChange={(e) => setForm({ ...form, cancellationPolicy: e.target.value })} placeholder="e.g. Cancel at least 24 hours ahead to avoid a fee." />
        </div>
      </div>
      <div className="field">
        <label>Preparation instructions</label>
        <textarea rows={2} value={form.preparationInstructions} onChange={(e) => setForm({ ...form, preparationInstructions: e.target.value })} placeholder="e.g. Please arrive 10 minutes early with photo ID." />
      </div>
      <div className="field">
        <label>Restricted topics</label>
        <textarea rows={2} value={form.restrictedTopics} onChange={(e) => setForm({ ...form, restrictedTopics: e.target.value })} placeholder="e.g. Medical diagnoses, legal advice, pricing negotiation." />
      </div>
      <div className="field">
        <label>Emergency rules</label>
        <textarea rows={2} value={form.emergencyRules} onChange={(e) => setForm({ ...form, emergencyRules: e.target.value })} placeholder="e.g. If a caller describes severe pain or bleeding, tell them to call 911 or go to the ER, then flag the call." />
      </div>

      <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pronunciation dictionary</label>
      <div className="stack" style={{ gap: 8, marginTop: 6, marginBottom: 10 }}>
        {form.pronunciation.map((p, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input value={p.term} onChange={(e) => updateRow('pronunciation', i, { term: e.target.value })} placeholder="Xero" />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input value={p.pronunciation} onChange={(e) => updateRow('pronunciation', i, { pronunciation: e.target.value })} placeholder="ZEER-oh" />
            </div>
            <button className="icon-btn" onClick={() => removeRow('pronunciation', i)} disabled={form.pronunciation.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
        <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addRow('pronunciation', { term: '', pronunciation: '' })}><Plus size={14} /> Add another term</button>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="row" style={{ marginTop: 4 }}>
        <button className="ghost" onClick={saveDraft} disabled={saving}>{saving ? 'Saving...' : 'Save draft'}</button>
        <button className="primary" onClick={publish} disabled={publishing}>{publishing ? 'Publishing...' : 'Publish'}</button>
      </div>

      {versions?.length > 0 && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Version history</label>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {versions.map((v) => (
              <div key={v.version} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>
                  v{v.version} — {new Date(v.publishedAt).toLocaleString()}
                  {v.publishedByName && <span className="muted"> by {v.publishedByName}</span>}
                  {v.rolledBackFrom != null && <span className="badge neutral" style={{ marginLeft: 8 }}>rollback of v{v.rolledBackFrom}</span>}
                </span>
                <button className="ghost" onClick={() => rollback(v.version)}>Roll back to this version</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarConnectSection() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.calendarStatus().then(setStatus).catch((e) => setError(e.message)); }, []);

  async function connect() {
    try {
      const { url } = await api.calendarConnectUrl();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Google Calendar</h2>
      {status?.connected ? (
        <p>Connected — bookings mirror to <code>{status.google_calendar_id}</code>.</p>
      ) : (
        <p className="muted">Not connected. Bookings still work (the database is the source of truth); connect to also see them on your Google Calendar and to catch conflicts with manually-added personal events.</p>
      )}
      <button className="primary" onClick={connect}>{status?.connected ? 'Reconnect' : 'Connect Google Calendar'}</button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function PhoneNumberSection() {
  const [phoneNumber, setPhoneNumber] = useState(null);
  const [areaCode, setAreaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getPhoneNumber().then((r) => setPhoneNumber(r?.phone_number)).catch((e) => setError(e.message)); }, []);

  async function provision() {
    setLoading(true);
    setError(null);
    try {
      const { phoneNumber: purchased } = await api.provisionPhoneNumber(areaCode ? { areaCode } : {});
      setPhoneNumber(purchased);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Inbound phone number</h2>
      {phoneNumber ? (
        <p>Customers call <strong>{phoneNumber}</strong> to book.</p>
      ) : (
        <>
          <p className="muted">This purchases a real Twilio number and is billed to the Twilio account.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field"><label>Area code (optional)</label><input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} placeholder="e.g. 415" /></div>
            <button className="primary" onClick={provision} disabled={loading}>{loading ? 'Provisioning...' : 'Get a phone number'}</button>
          </div>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <div className="stack">
        <div>
          <h1>Settings</h1>
        </div>
        <BusinessProfileSection />
        <LocationsSection />
        <BusinessHoursSection />
        <KnowledgeBaseSection />
        <CalendarConnectSection />
        <PhoneNumberSection />
        <ChangePasswordSection />
      </div>
    </RequireAuth>
  );
}
