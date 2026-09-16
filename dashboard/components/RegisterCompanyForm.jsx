'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { platformApi } from '../lib/api';
import { useToast } from '../lib/Toast';

const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const emptyService = () => ({ name: '', durationMinutes: 30, bufferMinutes: 0, price: '' });
const emptyFaq = () => ({ question: '', answer: '' });

export default function RegisterCompanyForm({ onRegistered }) {
  const toast = useToast();

  const [businessName, setBusinessName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');

  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [hours, setHours] = useState(DAY_NAMES.map((_, day) => ({ dayOfWeek: day, closed: day === 0 || day === 6, openTime: '09:00', closeTime: '17:00' })));
  const [services, setServices] = useState([emptyService()]);
  const [faqs, setFaqs] = useState([emptyFaq()]);

  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [justCreated, setJustCreated] = useState(null);

  function updateHourRow(day, patch) {
    setHours((prev) => prev.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));
  }
  function updateService(i, patch) {
    setServices((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function updateFaq(i, patch) {
    setFaqs((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function reset() {
    setBusinessName(''); setContactEmail(''); setContactPhone(''); setAddress('');
    setAdminName(''); setAdminEmail(''); setAdminPassword('');
    setHours(DAY_NAMES.map((_, day) => ({ dayOfWeek: day, closed: day === 0 || day === 6, openTime: '09:00', closeTime: '17:00' })));
    setServices([emptyService()]);
    setFaqs([emptyFaq()]);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setJustCreated(null);
    setSubmitting(true);
    try {
      await platformApi.registerCompany({
        businessName, timezone, adminName: adminName || undefined, adminEmail, adminPassword,
        contactEmail: contactEmail || undefined, contactPhone: contactPhone || undefined, address: address || undefined,
        hours: hours.filter((h) => !h.closed).map((h) => ({ dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime })),
        services: services.filter((s) => s.name.trim()).map((s) => ({ name: s.name, durationMinutes: Number(s.durationMinutes), bufferMinutes: Number(s.bufferMinutes) || 0, price: s.price ? Number(s.price) : undefined })),
        faqs: faqs.filter((f) => f.question.trim() && f.answer.trim()),
      });
      setJustCreated({ businessName, adminEmail });
      toast.success(`${businessName} registered`);
      reset();
      onRegistered?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="card">
        <h2>Business</h2>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Business name</label>
            <input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Contact email (optional)</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Contact phone (optional)</label>
            <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="General/support number, not the booking line" />
          </div>
        </div>
        <div className="field">
          <label>Address (optional)</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h2>Company admin account</h2>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Admin name (optional)</label>
            <input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Admin email</label>
            <input type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Admin password</label>
            <input type="password" required minLength={8} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Business hours</h2>
        <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>Can be changed later from the company's own Settings.</p>
        {hours.map((r) => (
          <div key={r.dayOfWeek} className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
            <label style={{ width: 110, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!r.closed} onChange={(e) => updateHourRow(r.dayOfWeek, { closed: !e.target.checked })} style={{ width: 'auto' }} /> {DAY_NAMES[r.dayOfWeek]}
            </label>
            <input type="time" disabled={r.closed} value={r.openTime} onChange={(e) => updateHourRow(r.dayOfWeek, { openTime: e.target.value })} style={{ width: 120 }} />
            <span className="muted">to</span>
            <input type="time" disabled={r.closed} value={r.closeTime} onChange={(e) => updateHourRow(r.dayOfWeek, { closeTime: e.target.value })} style={{ width: 120 }} />
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Services</h2>
        <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>What this business offers — used for both call-in and dashboard bookings. Add more later in Settings.</p>
        <div className="stack" style={{ gap: 8 }}>
          {services.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                {i === 0 && <label>Name</label>}
                <input value={s.name} onChange={(e) => updateService(i, { name: e.target.value })} placeholder="e.g. Haircut" />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                {i === 0 && <label>Duration (min)</label>}
                <input type="number" min={1} value={s.durationMinutes} onChange={(e) => updateService(i, { durationMinutes: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                {i === 0 && <label>Buffer (min)</label>}
                <input type="number" min={0} value={s.bufferMinutes} onChange={(e) => updateService(i, { bufferMinutes: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                {i === 0 && <label>Price</label>}
                <input type="number" min={0} step="0.01" value={s.price} onChange={(e) => updateService(i, { price: e.target.value })} />
              </div>
              <button type="button" className="icon-btn" onClick={() => setServices((prev) => prev.filter((_, idx) => idx !== i))} disabled={services.length === 1}>
                <Trash2 size={15} color="var(--danger)" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="ghost" style={{ marginTop: 10 }} onClick={() => setServices((prev) => [...prev, emptyService()])}>
          <Plus size={14} /> Add another service
        </button>
      </div>

      <div className="card">
        <h2>Common questions (Q&amp;A)</h2>
        <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
          The voice agent answers callers directly from these — parking, walk-ins, policies, anything that isn't a booking action.
        </p>
        <div className="stack" style={{ gap: 8 }}>
          {faqs.map((f, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                {i === 0 && <label>Question</label>}
                <input value={f.question} onChange={(e) => updateFaq(i, { question: e.target.value })} placeholder="Do you take walk-ins?" />
              </div>
              <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                {i === 0 && <label>Answer</label>}
                <input value={f.answer} onChange={(e) => updateFaq(i, { answer: e.target.value })} placeholder="Yes, subject to availability." />
              </div>
              <button type="button" className="icon-btn" onClick={() => setFaqs((prev) => prev.filter((_, idx) => idx !== i))} disabled={faqs.length === 1}>
                <Trash2 size={15} color="var(--danger)" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="ghost" style={{ marginTop: 10 }} onClick={() => setFaqs((prev) => [...prev, emptyFaq()])}>
          <Plus size={14} /> Add another question
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {justCreated && (
        <p className="success-text">
          {justCreated.businessName} registered — give {justCreated.adminEmail} their password so they can log in at /login.
        </p>
      )}
      <button type="submit" className="primary" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
        {submitting ? 'Registering...' : 'Register company'}
      </button>
    </form>
  );
}
