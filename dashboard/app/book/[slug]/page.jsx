'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { publicApi, ApiError } from '../../../lib/api';

// Public booking page (docs/customer/CUSTOMER_JOURNEY.md): service -> stylist -> time ->
// details -> confirmation. The business is fixed by the URL and its name/address sit in
// the header of every step, so a customer can't book ABC Dentist thinking it is ABC Salon.
// Times are shown in the business's timezone (what the customer will actually walk in to),
// not the browser's.
const STEPS = ['Service', 'Stylist', 'Time', 'Your details'];

const fmt = (iso, tz, opts) => new Date(iso).toLocaleString([], { timeZone: tz, ...opts });
const timeOf = (iso, tz) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit' });
const dayTimeOf = (iso, tz) => fmt(iso, tz, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

export default function BookPage() {
  const { slug } = useParams();
  const [biz, setBiz] = useState(null);
  const [missing, setMissing] = useState(false);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [step, setStep] = useState(0);
  const [service, setService] = useState(null);
  const [staffChoice, setStaffChoice] = useState('any'); // staff id or 'any'
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState(null);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', smsConsent: true, emailConsent: true, website: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const key = useRef(null);

  useEffect(() => {
    Promise.all([publicApi.business(slug), publicApi.services(slug)])
      .then(([b, s]) => { setBiz(b); setServices(s); setDate(todayIn(b.timezone)); })
      .catch(() => setMissing(true));
  }, [slug]);

  async function pickService(s) {
    setService(s); setSlot(null); setSlots(null); setError(null); setStaffChoice('any');
    const list = await publicApi.staff(slug, s.id).catch(() => []);
    setStaff(list);
    setStep(list.length ? 1 : 2);
  }

  async function loadSlots(d = date, who = staffChoice, svc = service) {
    setSlots(null); setSlot(null);
    try {
      setSlots((await publicApi.availability(slug, { serviceId: svc.id, date: d, staffId: who })).slots);
    } catch (e) {
      setSlots([]); setError(e.message);
    }
  }
  useEffect(() => { if (step === 2 && service && date) loadSlots(); }, [step, date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    key.current ??= crypto.randomUUID();
    try {
      setResult(await publicApi.book(slug, {
        serviceId: service.id, staffId: staffChoice, startTime: slot, name: form.name, phone: form.phone, email: form.email,
        consent: { sms: form.smsConsent, email: form.emailConsent }, idempotencyKey: key.current, website: form.website,
      }));
    } catch (err) {
      key.current = null;
      setError(err.message);
      if (err instanceof ApiError && err.status === 409) { setStep(2); loadSlots(); }
    } finally {
      setSaving(false);
    }
  }

  const tz = biz?.timezone ?? 'UTC';
  const where = biz && [biz.address, biz.city && !biz.address?.includes(biz.city) ? biz.city : null].filter(Boolean).join(', ');
  const staffName = staffChoice === 'any' ? 'Any available' : staff.find((s) => s.id === staffChoice)?.name;
  const selected = { background: 'var(--ink)', color: 'var(--ink-text)', borderColor: 'var(--ink)' };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px' }}>
      <div className="card" style={{ maxWidth: 480, margin: '0 auto' }}>
        {missing && (
          <>
            <h1 style={{ fontSize: 20 }}>We couldn&apos;t find that business</h1>
            <p className="muted">The link may be wrong, or online booking is switched off. <Link href="/find">Find a business</Link></p>
          </>
        )}
        {!missing && !biz && <p className="muted">Loading...</p>}

        {biz && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}><Link href="/find">Find a business</Link> &rsaquo; {biz.name} &middot; <Link href={`/my/${slug}`}>My appointments</Link></div>
              <h1 style={{ fontSize: 22, margin: '4px 0 2px' }}>{biz.name}</h1>
              {where && <div className="muted" style={{ fontSize: 13 }}>{where}</div>}
              {biz.phone && <div className="muted" style={{ fontSize: 13 }}>{biz.phone}</div>}
            </div>

            {!result && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 12 }} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
                Step {step + 1} of {STEPS.length}: <strong>{STEPS[step]}</strong>
              </div>
            )}

            {!result && step === 0 && (
              <div className="stack" style={{ gap: 8 }}>
                {services.length === 0 && <p className="muted">This business hasn&apos;t set up its services yet. Please call them instead.</p>}
                {services.map((s) => (
                  <button key={s.id} type="button" onClick={() => pickService(s)} style={{ justifyContent: 'space-between', width: '100%', padding: '12px 14px' }}>
                    <span>{s.name}</span>
                    <span className="muted">{s.durationMinutes} min{s.price != null ? ` · $${s.price}` : ''}</span>
                  </button>
                ))}
              </div>
            )}

            {!result && step === 1 && (
              <>
                <p style={{ marginTop: 0 }}>Who would you like for <strong>{service.name}</strong>?</p>
                <div className="stack" style={{ gap: 8 }}>
                  {[{ id: 'any', name: 'Any available' }, ...staff].map((s) => (
                    <button key={s.id} type="button" style={{ width: '100%', padding: '12px 14px', justifyContent: 'flex-start' }} onClick={() => { setStaffChoice(s.id); setStep(2); }}>
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 14 }}><button type="button" onClick={() => setStep(0)}>Back</button></div>
              </>
            )}

            {!result && step === 2 && (
              <>
                <p style={{ marginTop: 0 }}><strong>{service.name}</strong>{staff.length > 0 && <> with {staffName}</>}</p>
                <div className="field">
                  <label htmlFor="date">Date</label>
                  <input id="date" type="date" min={todayIn(tz)} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Available times ({tz})</label>
                  {slots === null && <p className="muted">Loading...</p>}
                  {slots?.length === 0 && <p className="muted">Nothing open this day. Try another date.</p>}
                  <div className="row" style={{ gap: 8 }}>
                    {slots?.map((s) => (
                      <button key={s} type="button" onClick={() => { setSlot(s); setError(null); }} style={slot === s ? selected : undefined}>{timeOf(s, tz)}</button>
                    ))}
                  </div>
                </div>
                {error && <p className="error-text">{error}</p>}
                <div className="row">
                  <button type="button" onClick={() => setStep(staff.length ? 1 : 0)}>Back</button>
                  <button type="button" className="primary" disabled={!slot} onClick={() => { setError(null); setStep(3); }}>Continue</button>
                </div>
              </>
            )}

            {!result && step === 3 && (
              <form onSubmit={submit}>
                <p style={{ marginTop: 0 }}>
                  <strong>{service.name}</strong>{staff.length > 0 && <> with {staffName}</>}<br />
                  {dayTimeOf(slot, tz)}
                </p>
                <div className="field"><label htmlFor="name">Your name</label><input id="name" required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="phone">Mobile number</label><input id="phone" required type="tel" autoComplete="tel" placeholder="(555) 123-4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="field"><label htmlFor="email">Email (optional)</label><input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '4px 0 14px', alignItems: 'flex-start' }}>
                  <input type="checkbox" style={{ marginTop: 3, width: "auto" }} checked={form.smsConsent && form.emailConsent} onChange={(e) => setForm({ ...form, smsConsent: e.target.checked, emailConsent: e.target.checked })} />
                  <span>I agree to receive booking confirmations and reminders by SMS and email. You can reply STOP at any time.</span>
                </label>
                {error && <p className="error-text">{error}</p>}
                <div className="row">
                  <button type="button" onClick={() => setStep(2)} disabled={saving}>Back</button>
                  <button type="submit" className="primary" disabled={saving}>{saving ? 'Booking...' : 'Confirm booking'}</button>
                </div>
              </form>
            )}

            {result && (
              <div role="status">
                <p className="success-text" style={{ fontSize: 16, fontWeight: 600 }}>You&apos;re booked!</p>
                <div className="stack" style={{ gap: 4, fontSize: 14 }}>
                  <div><strong>{result.booking.serviceName}</strong>{result.booking.staffName && <> with {result.booking.staffName}</>}</div>
                  <div>{dayTimeOf(result.booking.startTime, result.business.timezone)}</div>
                  <div className="muted">{result.business.name}{where && <> · {where}</>}</div>
                </div>
                <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>We&apos;ll send a confirmation with this link to change or cancel your appointment.</p>
                {result.booking.reference && <p style={{ fontSize: 13 }}>Your booking reference: <strong>{result.booking.reference}</strong></p>}
                <div className="row"><a href={result.manageUrl}><button type="button" className="primary">Change or cancel</button></a><Link href={`/my/${slug}`}><button type="button">See all my appointments</button></Link></div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
