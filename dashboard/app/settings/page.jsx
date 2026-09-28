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
        minBookingNoticeMinutes: Number(form.minBookingNoticeMinutes) || 0,
        maxBookingWindowDays: form.maxBookingWindowDays === '' ? null : Number(form.maxBookingWindowDays),
        transferPhoneNumber: form.transferPhoneNumber,
        recordingEnabled: form.recordingEnabled,
        recordingRetentionDays: form.recordingRetentionDays === '' ? null : Number(form.recordingRetentionDays),
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
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Minimum booking notice (minutes)</label>
            <input type="number" min={0} value={form.minBookingNoticeMinutes} onChange={(e) => setForm({ ...form, minBookingNoticeMinutes: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Maximum booking window (days, blank = unlimited)</label>
            <input type="number" min={1} value={form.maxBookingWindowDays ?? ''} onChange={(e) => setForm({ ...form, maxBookingWindowDays: e.target.value })} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
          How soon a new booking can start from now, and how far out it can be made — applies to both call and dashboard bookings.
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
        <div className="field">
          <label>Human transfer number (fallback)</label>
          <input value={form.transferPhoneNumber} onChange={(e) => setForm({ ...form, transferPhoneNumber: e.target.value })} placeholder="Where calls go when the AI hands off, if no department/staff/location number applies" />
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.recordingEnabled} onChange={(e) => setForm({ ...form, recordingEnabled: e.target.checked })} />
            Record calls
          </label>
          <div className="field" style={{ flex: 1 }}>
            <label>Recording &amp; transcript retention (days, blank = keep forever)</label>
            <input type="number" min={1} value={form.recordingRetentionDays ?? ''} onChange={(e) => setForm({ ...form, recordingRetentionDays: e.target.value })} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
          Callers are always told calls may be recorded. A retention window nulls out old recordings/transcripts on a schedule (src/services/retentionWorker.js) — call outcomes and durations are kept either way.
        </p>
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

// MFA (ROADMAP.md §12, plan.md §11 item 9) — TOTP only, no QR image rendered here; the
// secret is shown as text for manual entry into an authenticator app.
function MfaSection() {
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [enrollment, setEnrollment] = useState(null); // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.getMe().then(setMe).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await api.mfaEnroll());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.mfaEnrollConfirm(code);
      toast.success('Two-factor authentication enabled');
      setEnrollment(null);
      setCode('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.mfaDisable(password);
      toast.success('Two-factor authentication disabled');
      setPassword('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  return (
    <div className="card">
      <h2>Two-factor authentication</h2>
      {me.mfaEnabled ? (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>Enabled — a code from your authenticator app is required at login.</p>
          <form onSubmit={disable} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Current password</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="danger" disabled={busy}>{busy ? 'Disabling...' : 'Disable'}</button>
          </form>
        </>
      ) : enrollment ? (
        <form onSubmit={confirmEnroll}>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>
            Add an account in your authenticator app (Google Authenticator, Authy, 1Password, ...) using this key, then enter the 6-digit code it shows.
          </p>
          <div className="field">
            <label>Secret key</label>
            <input readOnly value={enrollment.secret} style={{ fontFamily: 'ui-monospace, monospace' }} onFocus={(e) => e.target.select()} />
          </div>
          <div className="field">
            <label>6-digit code</label>
            <input inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Verifying...' : 'Enable'}</button>
            <button type="button" className="ghost" onClick={() => setEnrollment(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>Not enabled. Require a 6-digit authenticator code in addition to your password at login.</p>
          <button className="primary" onClick={startEnroll} disabled={busy}>{busy ? 'Starting...' : 'Set up two-factor authentication'}</button>
        </>
      )}
      {error && !enrollment && <p className="error-text">{error}</p>}
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

function HolidaysSection() {
  const toast = useToast();
  const [holidays, setHolidays] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getHolidays().then((h) => setHolidays(h.length ? h : [{ date: '', name: '' }])).catch((e) => setError(e.message)); }, []);

  function update(i, patch) {
    setHolidays((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const cleaned = await api.putHolidays(holidays.filter((h) => h.date));
      setHolidays(cleaned.length ? cleaned : [{ date: '', name: '' }]);
      toast.success('Holidays saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!holidays) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  return (
    <div className="card">
      <h2>Holidays</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Full closures on specific dates — no slots are offered on these days, regardless of the usual weekly hours.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {holidays.map((h, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              {i === 0 && <label>Date</label>}
              <input type="date" value={h.date} onChange={(e) => update(i, { date: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Name (optional)</label>}
              <input value={h.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} placeholder="Christmas" />
            </div>
            <button className="icon-btn" onClick={() => setHolidays((prev) => prev.filter((_, idx) => idx !== i))} disabled={holidays.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => setHolidays((prev) => [...prev, { date: '', name: '' }])}><Plus size={14} /> Add another date</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save holidays'}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// Department-based transfer routing (ROADMAP.md §5) — src/voice/tools.js's
// resolveTransferTarget matches a department the caller names before falling back to
// staff/location/business-wide numbers.
function TransferDepartmentsSection() {
  const toast = useToast();
  const [departments, setDepartments] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getTransferDepartments().then((d) => setDepartments(d.length ? d : [{ name: '', phoneNumber: '' }])).catch((e) => setError(e.message)); }, []);

  function update(i, patch) {
    setDepartments((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const cleaned = await api.putTransferDepartments(departments.filter((d) => d.name && d.phoneNumber));
      setDepartments(cleaned.length ? cleaned : [{ name: '', phoneNumber: '' }]);
      toast.success('Departments saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!departments) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  return (
    <div className="card">
      <h2>Transfer departments</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Named phone lines the AI can transfer to when a caller asks for one by name (e.g. "billing").
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {departments.map((d, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Department</label>}
              <input value={d.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Billing" />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Phone number</label>}
              <input value={d.phoneNumber} onChange={(e) => update(i, { phoneNumber: e.target.value })} placeholder="+15551234567" />
            </div>
            <button className="icon-btn" onClick={() => setDepartments((prev) => prev.filter((_, idx) => idx !== i))} disabled={departments.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => setDepartments((prev) => [...prev, { name: '', phoneNumber: '' }])}><Plus size={14} /> Add another department</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save departments'}</button>
      </div>
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

// Self-service delete/restore — a soft flag only (src/routes/config.js DELETE
// /business), not the platform admin's hard delete which actually wipes data. Staying
// logged in while deleted is what makes undo a one-click "Restore" instead of a
// forgot-password-style recovery flow.
function DeleteAccountSection() {
  const toast = useToast();
  const [business, setBusiness] = useState(null);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.getBusiness().then(setBusiness).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function del(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteBusiness(confirmName);
      toast.success('Account deleted — you can restore it any time from here');
      setConfirmName('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      await api.restoreBusiness();
      toast.success('Account restored');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!business) return null;

  if (business.status === 'deleted') {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <h2>Account deleted</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>
          {business.name} was deleted{business.deletedAt ? ` on ${new Date(business.deletedAt).toLocaleString()}` : ''}.
          Your data hasn&apos;t been touched — restore any time.
        </p>
        <button className="primary" onClick={restore} disabled={busy}>{busy ? 'Restoring...' : 'Restore account'}</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderColor: 'var(--danger)' }}>
      <h2>Delete account</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        Deactivates {business.name}. This is reversible — you can restore it from this same
        page any time. To permanently erase all data instead, contact the platform.
      </p>
      <form onSubmit={del} className="row" style={{ alignItems: 'center' }}>
        <input
          placeholder={`Type "${business.name}" to confirm`}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          style={{ width: 260 }}
        />
        <button type="submit" className="danger" disabled={busy || confirmName !== business.name}>
          <Trash2 size={15} /> {busy ? 'Deleting...' : 'Delete account'}
        </button>
      </form>
      {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth area="settings">
      <div className="stack">
        <div>
          <h1>Settings</h1>
        </div>
        <BusinessProfileSection />
        <LocationsSection />
        <BusinessHoursSection />
        <HolidaysSection />
        <TransferDepartmentsSection />
        <KnowledgeBaseSection />
        <CalendarConnectSection />
        <PhoneNumberSection />
        <ChangePasswordSection />
        <MfaSection />
        <DeleteAccountSection />
      </div>
    </RequireAuth>
  );
}
