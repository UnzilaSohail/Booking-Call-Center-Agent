'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC'];

function BusinessProfileSection() {
  const toast = useToast();
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
        name: form.name, timezone: form.timezone, rescheduleCutoffMinutes: Number(form.rescheduleCutoffMinutes),
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

function FaqsSection() {
  const toast = useToast();
  const [faqs, setFaqs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getBusiness().then((b) => setFaqs(b.faqs?.length ? b.faqs : [{ question: '', answer: '' }])).catch((e) => setError(e.message)); }, []);

  function update(i, patch) {
    setFaqs((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const cleaned = await api.putFaqs(faqs.filter((f) => f.question.trim() && f.answer.trim()));
      setFaqs(cleaned.length ? cleaned : [{ question: '', answer: '' }]);
      toast.success('Questions saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!faqs) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  return (
    <div className="card">
      <h2>Common questions (Q&amp;A)</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        The voice agent answers callers directly from these — parking, walk-ins, policies, anything that isn&apos;t a booking action.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {faqs.map((f, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Question</label>}
              <input value={f.question} onChange={(e) => update(i, { question: e.target.value })} placeholder="Do you take walk-ins?" />
            </div>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              {i === 0 && <label>Answer</label>}
              <input value={f.answer} onChange={(e) => update(i, { answer: e.target.value })} placeholder="Yes, subject to availability." />
            </div>
            <button className="icon-btn" onClick={() => setFaqs((prev) => prev.filter((_, idx) => idx !== i))} disabled={faqs.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => setFaqs((prev) => [...prev, { question: '', answer: '' }])}><Plus size={14} /> Add another question</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save questions'}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
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
        <BusinessHoursSection />
        <FaqsSection />
        <CalendarConnectSection />
        <PhoneNumberSection />
        <ChangePasswordSection />
      </div>
    </RequireAuth>
  );
}
