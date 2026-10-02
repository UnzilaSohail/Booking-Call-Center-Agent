'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarPlus, Check, Clock, MapPin, User } from 'lucide-react';
import { publicApi, ApiError } from '../../../lib/api';
import Loading from '../../../components/Skeleton';
import TextField from '../../../components/TextField';
import PublicNav from '../../../components/PublicNav';
import Confetti from '../../../components/Confetti';
import { gradientFor, initials } from '../../../lib/brand';
import { validateName, validatePhone, validateEmail } from '../../../lib/validate';

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

// The next two weeks as tappable date tiles (a native date box stays underneath for anything further out).
function nextDays(start, n = 14) {
  const base = new Date(`${start}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base.getTime() + i * 864e5);
    return { value: d.toISOString().slice(0, 10), dow: i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' }), day: d.getUTCDate() };
  });
}
const hourOf = (iso, tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)));
const PARTS = [['Morning', (h) => h < 12], ['Afternoon', (h) => h >= 12 && h < 17], ['Evening', (h) => h >= 17]];

// "Add to calendar": a standard .ics file the phone or computer opens in any calendar app (Jira 26e).
const icsText = (s) => String(s ?? '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
function downloadIcs(result, where) {
  const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Booking//Appointment//EN', 'BEGIN:VEVENT',
    `UID:${result.booking.id}@booking`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(result.booking.startTime)}`, `DTEND:${stamp(result.booking.endTime)}`,
    `SUMMARY:${icsText(`${result.booking.serviceName} at ${result.business.name}`)}`,
    ...(where ? [`LOCATION:${icsText(where)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = 'appointment.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function BookPageClient() {
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
  const [location, setLocation] = useState(null); // only used when the business has more than one location
  const key = useRef(null);

  useEffect(() => {
    Promise.all([publicApi.business(slug), publicApi.services(slug)])
      .then(([b, s]) => { setBiz(b); setServices(s); setDate(todayIn(b.timezone)); })
      .catch(() => setMissing(true));
  }, [slug]);

  async function pickService(s) {
    setService(s); setSlot(null); setSlots(null); setError(null); setStaffChoice('any');
    const list = await publicApi.staff(slug, s.id, location?.id).catch(() => []);
    setStaff(list);
    setStep(list.length ? 1 : 2);
  }

  async function loadSlots(d = date, who = staffChoice, svc = service) {
    setSlots(null); setSlot(null);
    try {
      setSlots((await publicApi.availability(slug, { serviceId: svc.id, date: d, staffId: who, ...(location ? { locationId: location.id } : {}) })).slots);
    } catch (e) {
      setSlots([]); setError(e.message);
    }
  }
  useEffect(() => { if (step === 2 && service && date) loadSlots(); }, [step, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const [submitted, setSubmitted] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (validateName(form.name) || validatePhone(form.phone) || validateEmail(form.email)) {
      setSubmitted(true);
      setError('Please fix the highlighted fields.');
      return;
    }
    setSaving(true); setError(null);
    key.current ??= crypto.randomUUID();
    try {
      setResult(await publicApi.book(slug, {
        serviceId: service.id, staffId: staffChoice, locationId: location?.id, startTime: slot, name: form.name, phone: form.phone, email: form.email,
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
  // Jira 17z: a business with several locations asks WHERE first; the chosen location's name and
  // address then replace the head-office address in the header, so the customer sees exactly where to go.
  const multi = (biz?.locations?.length ?? 0) > 1;
  const needLocation = multi && !location && !result;
  const stepNo = step + 1 + (multi ? 1 : 0);
  const stepTotal = STEPS.length + (multi ? 1 : 0);
  const address = biz && (location ? location.address : biz.address);
  const where = biz && (location
    ? [location.name, location.address].filter(Boolean).join(': ')
    : [biz.address, biz.city && !biz.address?.includes(biz.city) ? biz.city : null].filter(Boolean).join(', '));
  const staffName = staffChoice === 'any' ? 'Any available' : staff.find((s) => s.id === staffChoice)?.name;
  const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const inFlow = biz && !result && !needLocation;

  return (
    <div className="public-shell">
      <PublicNav right={biz && <Link href={`/my/${slug}`} style={{ fontWeight: 600, fontSize: 14 }}>My appointments</Link>} />
      <main id="main-content" tabIndex={-1} className="public-wrap">
        {result && <Confetti />}
        {missing && (
          <div className="card fade-up" style={{ maxWidth: 480, margin: '40px auto' }}>
            <h1 style={{ fontSize: 22 }}>We couldn&apos;t find that business</h1>
            <p className="muted">The link may be wrong, or online booking is switched off. <Link href="/find">Find a business</Link></p>
          </div>
        )}
        {!missing && !biz && <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}><Loading lines={4} /></div>}

        {biz && (
          <>
            <div className="row fade-up" style={{ alignItems: 'center', gap: 16, flexWrap: 'nowrap', margin: '10px 0 22px' }}>
              <div className="avatar-lg" style={{ background: gradientFor(biz.name) }} aria-hidden="true">{initials(biz.name)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 12.5 }}><Link href="/find">Find a business</Link> &rsaquo; {biz.name}</div>
                <h1 style={{ fontSize: 28, margin: '2px 0' }}>{biz.name}</h1>
                {where && <div className="muted" style={{ fontSize: 13.5 }}><MapPin size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} aria-hidden="true" />{where}{biz.phone && <> &middot; {biz.phone}</>}</div>}
                {multi && location && !result && (
                  <button type="button" className="ghost" style={{ padding: 0, fontSize: 12.5, minHeight: 0 }} onClick={() => { setLocation(null); setService(null); setStaff([]); setStaffChoice('any'); setSlot(null); setSlots(null); setStep(0); }}>Change location</button>
                )}
              </div>
            </div>

            <div className={result ? undefined : 'wizard-grid'}>
              <div className="card step-anim" key={result ? 'done' : needLocation ? 'loc' : step} style={result ? { maxWidth: 560, margin: '0 auto', width: '100%' } : undefined}>
                {!result && (
                  <>
                    <div className="stepper" role="img" aria-label={`Step ${needLocation ? 1 : stepNo} of ${stepTotal}`}>
                      {Array.from({ length: stepTotal }, (_, i) => {
                        const at = needLocation ? 0 : stepNo - 1;
                        return <div key={i} className={`dot${i < at ? ' done' : i === at ? ' current' : ''}`} />;
                      })}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
                      Step {needLocation ? 1 : stepNo} of {stepTotal}: <strong>{needLocation ? 'Location' : STEPS[step]}</strong>
                    </div>
                  </>
                )}

                {needLocation && (
                  <>
                    <h2 style={{ fontSize: 19, margin: '0 0 12px' }}>Which location?</h2>
                    <div className="stack" style={{ gap: 8 }}>
                      {biz.locations.map((l) => (
                        <button key={l.id} type="button" className="choice" onClick={() => setLocation(l)} style={{ justifyContent: 'flex-start' }}>
                          <span><strong>{l.name}</strong>{l.address && <span className="muted" style={{ display: 'block', fontWeight: 400 }}>{l.address}</span>}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {inFlow && step === 0 && (
                  <>
                    <h2 style={{ fontSize: 19, margin: '0 0 12px' }}>What would you like to book?</h2>
                    <div className="stack stagger" style={{ gap: 8 }}>
                      {services.length === 0 && <p className="muted">This business hasn&apos;t set up its services yet. Please call them instead.</p>}
                      {services.map((s) => (
                        <button key={s.id} type="button" className="choice lift" onClick={() => pickService(s)}>
                          <span><strong>{s.name}</strong><span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: 13 }}><Clock size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} aria-hidden="true" />{s.durationMinutes} min</span></span>
                          {s.price != null && <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 17 }}>${s.price}</strong>}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {inFlow && step === 1 && (
                  <>
                    <h2 style={{ fontSize: 19, margin: '0 0 12px' }}>Who would you like?</h2>
                    <div className="stack stagger" style={{ gap: 8 }}>
                      {[{ id: 'any', name: 'Any available', sub: 'Fastest, first free person' }, ...staff].map((s) => (
                        <button key={s.id} type="button" className="choice lift" style={{ justifyContent: 'flex-start', gap: 12 }} onClick={() => { setStaffChoice(s.id); setStep(2); }}>
                          <span className="avatar-lg" style={{ width: 38, height: 38, borderRadius: 12, fontSize: 14, background: s.id === 'any' ? 'var(--accent-soft)' : gradientFor(s.name), color: s.id === 'any' ? 'var(--accent)' : '#fff', boxShadow: 'none' }} aria-hidden="true">
                            {s.id === 'any' ? <User size={18} /> : initials(s.name)}
                          </span>
                          <span><strong>{s.name}</strong>{s.sub && <span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: 13 }}>{s.sub}</span>}</span>
                        </button>
                      ))}
                    </div>
                    <div className="row" style={{ marginTop: 14 }}><button type="button" onClick={() => setStep(0)}>Back</button></div>
                  </>
                )}

                {inFlow && step === 2 && (
                  <>
                    <h2 style={{ fontSize: 19, margin: '0 0 8px' }}>Pick a day and time</h2>
                    <div className="date-strip" role="group" aria-label="Day">
                      {nextDays(todayIn(tz)).map((d) => (
                        <button key={d.value} type="button" className="date-pill" aria-pressed={date === d.value} onClick={() => setDate(d.value)}>
                          <small>{d.dow}</small><b>{d.day}</b>
                        </button>
                      ))}
                    </div>
                    <div className="field" style={{ maxWidth: 220 }}>
                      <label htmlFor="date">Or choose another date</label>
                      <input id="date" type="date" min={todayIn(tz)} value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                    <div className="field">
                      <label id="times-label">Available times <span className="faint" style={{ textTransform: 'none', fontWeight: 400 }}>({tz})</span></label>
                      {slots === null && <Loading lines={2} />}
                      {slots?.length === 0 && <p className="muted">Nothing open this day. Try another date.</p>}
                      <div role="group" aria-labelledby="times-label">
                        {slots && PARTS.map(([name, test]) => {
                          const list = slots.filter((x) => test(hourOf(x, tz)));
                          return list.length > 0 && (
                            <div key={name} className="slot-group">
                              <h3>{name}</h3>
                              <div className="slot-grid">
                                {list.map((x) => (
                                  <button key={x} type="button" className="slot-btn" aria-pressed={slot === x} onClick={() => { setSlot(x); setError(null); }}>{timeOf(x, tz)}</button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {error && <p className="error-text" role="alert">{error}</p>}
                    <div className="row">
                      <button type="button" onClick={() => setStep(staff.length ? 1 : 0)}>Back</button>
                      <button type="button" className="primary" disabled={!slot} onClick={() => { setError(null); setStep(3); }}>Continue</button>
                    </div>
                  </>
                )}

                {inFlow && step === 3 && (
                  <form onSubmit={submit} noValidate>
                    <h2 style={{ fontSize: 19, margin: '0 0 12px' }}>Your details</h2>
                    <TextField label="Your name" required maxLength={100} autoComplete="name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} validate={validateName} showErrors={submitted} />
                    <TextField label="Mobile number" required type="tel" autoComplete="tel" placeholder="(555) 123-4567" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} validate={validatePhone} showErrors={submitted} hint="We text your confirmation here." />
                    <TextField label="Email" optional type="email" autoComplete="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} validate={validateEmail} showErrors={submitted} />
                    <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                    <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '4px 0 14px', alignItems: 'flex-start' }}>
                      <input type="checkbox" style={{ marginTop: 3, width: 'auto', minHeight: 0 }} checked={form.smsConsent && form.emailConsent} onChange={(e) => setForm({ ...form, smsConsent: e.target.checked, emailConsent: e.target.checked })} />
                      <span>I agree to receive booking confirmations and reminders by SMS and email. You can reply STOP at any time.</span>
                    </label>
                    {error && <p className="error-text" role="alert">{error}</p>}
                    <div className="row">
                      <button type="button" onClick={() => setStep(2)} disabled={saving}>Back</button>
                      <button type="submit" className="primary" disabled={saving}>{saving ? 'Booking...' : 'Confirm booking'}</button>
                    </div>
                  </form>
                )}

                {result && (
                  <div role="status" style={{ textAlign: 'center' }}>
                    <div className="success-mark" aria-hidden="true" style={{ width: 64, height: 64, margin: '0 auto 12px' }}>
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    </div>
                    <h2 style={{ fontSize: 26, margin: '0 0 4px' }}>You&apos;re booked!</h2>
                    <p className="muted" style={{ margin: '0 0 16px' }}>We sent a confirmation to your phone. Here are your details.</p>
                    <div className="card" style={{ padding: 16, background: 'var(--surface-alt)', borderColor: 'transparent', textAlign: 'left' }}>
                      <div style={{ fontSize: 16 }}><strong>{result.booking.serviceName}</strong>{result.booking.staffName && <> with {result.booking.staffName}</>}</div>
                      <div style={{ fontSize: 15, marginTop: 2 }}>{dayTimeOf(result.booking.startTime, result.business.timezone)}</div>
                      <div className="muted" style={{ marginTop: 6 }}>{result.business.name}{where && <> &middot; {where}</>}</div>
                    </div>
                    {result.booking.reference && (
                      <div style={{ margin: '16px 0' }}>
                        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Your booking reference</div>
                        <span className="ref-code">{result.booking.reference}</span>
                      </div>
                    )}
                    <div className="row" style={{ marginBottom: 12, justifyContent: 'center' }}>
                      <button type="button" onClick={() => downloadIcs(result, where)}><CalendarPlus size={15} /> Add to calendar</button>
                      {address && <a href={mapsUrl(`${result.business.name} ${address}`)} target="_blank" rel="noreferrer"><button type="button"><MapPin size={15} /> Get directions</button></a>}
                    </div>
                    <div className="row" style={{ justifyContent: 'center' }}>
                      <a href={result.manageUrl}><button type="button" className="primary">Change or cancel</button></a>
                      <Link href={`/my/${slug}`}><button type="button">See all my appointments</button></Link>
                    </div>
                  </div>
                )}
              </div>

              {!result && (
                <aside className="card wizard-summary" aria-label="Your booking so far">
                  <h2 style={{ fontSize: 15, margin: '0 0 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your booking</h2>
                  <dl style={{ margin: 0, display: 'grid', gap: 12, fontSize: 14.5 }}>
                    <div><dt className="muted" style={{ fontSize: 12 }}>Service</dt><dd style={{ margin: 0, fontWeight: 600 }}>{service ? service.name : <span className="faint">Not chosen yet</span>}{service?.price != null && <span style={{ float: 'right' }}>${service.price}</span>}</dd></div>
                    {service && <div><dt className="muted" style={{ fontSize: 12 }}>Duration</dt><dd style={{ margin: 0 }}>{service.durationMinutes} min</dd></div>}
                    {step > 1 && staff.length > 0 && <div><dt className="muted" style={{ fontSize: 12 }}>With</dt><dd style={{ margin: 0 }}>{staffName}</dd></div>}
                    {step > 2 && slot && <div><dt className="muted" style={{ fontSize: 12 }}>When</dt><dd style={{ margin: 0 }}>{dayTimeOf(slot, tz)}</dd></div>}
                    {where && <div><dt className="muted" style={{ fontSize: 12 }}>Where</dt><dd style={{ margin: 0 }}>{where}</dd></div>}
                  </dl>
                  <p className="muted" style={{ fontSize: 12.5, margin: '16px 0 0' }}>Free to change or cancel from your confirmation.</p>
                </aside>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
