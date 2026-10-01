'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { customerApi, publicApi, ApiError } from '../../../lib/api';
import Loading from '../../../components/Skeleton';
import { useConfirm } from '../../../lib/confirm';
import TextField from '../../../components/TextField';
import { validateName, validateEmail } from '../../../lib/validate';

// Customer portal "My appointments" (docs/customer/PORTAL_SPEC.md). This is the customer's
// door, separate from the company /login: no password, just a code sent to their own phone or
// email, for this one business. The token is stored under this business's slug only.
const fmt = (iso, tz, o) => new Date(iso).toLocaleString([], { timeZone: tz, ...o });
const when = (iso, tz) => fmt(iso, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeOf = (iso, tz) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit' });
const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const keyFor = (slug) => `customer_token:${slug}`;
const readToken = (slug) => { try { return localStorage.getItem(keyFor(slug)); } catch { return null; } };
const writeToken = (slug, t) => { try { t ? localStorage.setItem(keyFor(slug), t) : localStorage.removeItem(keyFor(slug)); } catch { /* private mode: session only */ } };
const selected = { background: 'var(--ink)', color: 'var(--ink-text)', borderColor: 'var(--ink)' };

function SignIn({ slug, biz, onToken }) {
  const [mode, setMode] = useState('phone');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const who = mode === 'phone' ? { phone: value } : { email: value };

  async function send(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await customerApi.requestCode(slug, who); setSent(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function verify(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onToken((await customerApi.verify(slug, { ...who, code })).token); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>See your appointments</h2>
      <p className="muted" style={{ marginTop: 0 }}>Sign in with the {mode === 'phone' ? 'mobile number' : 'email'} you booked with at {biz.name}. We will send you a code. No password needed.</p>
      {!sent ? (
        <form onSubmit={send}>
          <div className="field">
            <label htmlFor="who">{mode === 'phone' ? 'Mobile number' : 'Email'}</label>
            <input id="who" required type={mode === 'phone' ? 'tel' : 'email'} autoComplete={mode === 'phone' ? 'tel' : 'email'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'phone' ? '(555) 123-4567' : 'you@example.com'} />
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="row" style={{ alignItems: 'center' }}>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending...' : 'Send me a code'}</button>
            <button type="button" className="ghost" onClick={() => { setMode(mode === 'phone' ? 'email' : 'phone'); setValue(''); setError(null); }}>Use {mode === 'phone' ? 'email' : 'phone'} instead</button>
          </div>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p role="status">If that {mode === 'phone' ? 'number' : 'email'} is on file, a code is on its way.</p>
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input id="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="row">
            <button type="button" onClick={() => { setSent(false); setCode(''); setError(null); }}>Back</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Checking...' : 'Sign in'}</button>
          </div>
        </form>
      )}
    </>
  );
}

function Appointment({ a, token, biz, onChanged }) {
  const [mode, setMode] = useState('view'); // view | reschedule | cancel
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: a.timezone }).format(new Date(a.startTime)));
  const [slots, setSlots] = useState(null);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (mode !== 'reschedule') return;
    setSlots(null); setSlot(null);
    customerApi.availability(token, a.id, date).then((r) => setSlots(r.slots)).catch((e) => { setSlots([]); setError(e.message); });
  }, [mode, date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); setMode('view'); onChanged(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div>
          <strong>{a.serviceName}</strong>{a.staffName && <> with {a.staffName}</>}
          <div>{when(a.startTime, a.timezone)}</div>
        </div>
        {a.status !== 'confirmed' ? <span className="badge neutral">{a.status}</span> : a.reference && <span className="badge neutral" title="Your booking reference">Ref {a.reference}</span>}
      </div>

      {a.upcoming && mode === 'view' && (
        a.canChange ? (
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setMode('reschedule')}>Reschedule</button>
            <button type="button" className="danger" onClick={() => setMode('cancel')}>Cancel</button>
          </div>
        ) : <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Too close to the appointment to change online{biz.phone ? <>, please call {biz.phone}</> : null}.</p>
      )}

      {mode === 'reschedule' && (
        <div style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor={`d-${a.id}`}>New date</label><input id={`d-${a.id}`} type="date" min={todayIn(a.timezone)} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {slots === null && <Loading />}
          {slots?.length === 0 && <p className="muted">Nothing open this day.</p>}
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            {slots?.map((s) => <button key={s} type="button" style={slot === s ? selected : undefined} onClick={() => setSlot(s)}>{timeOf(s, a.timezone)}</button>)}
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="row">
            <button type="button" disabled={busy} onClick={() => { setMode('view'); setError(null); }}>Back</button>
            <button type="button" className="primary" disabled={busy || !slot} onClick={() => run(() => customerApi.reschedule(token, a.id, slot))}>{busy ? 'Saving...' : 'Confirm new time'}</button>
          </div>
        </div>
      )}

      {mode === 'cancel' && (
        <div style={{ marginTop: 12 }}>
          <p>Cancel this appointment? This can&apos;t be undone.</p>
          {error && <p className="error-text">{error}</p>}
          <div className="row">
            <button type="button" disabled={busy} onClick={() => { setMode('view'); setError(null); }}>Keep it</button>
            <button type="button" className="danger" disabled={busy} onClick={() => run(() => customerApi.cancel(token, a.id))}>{busy ? 'Cancelling...' : 'Yes, cancel it'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Details({ me, token, onSaved }) {
  const [form, setForm] = useState({ name: me.name ?? '', email: me.email ?? '', smsOptIn: me.smsOptIn, emailOptIn: me.emailOptIn, language: me.language ?? '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { await customerApi.updateMe(token, form); setMsg({ ok: true, text: 'Saved.' }); onSaved(); } catch (err) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save}>
      <TextField label="Name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} validate={validateName} />
      <TextField label="Email" optional type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} validate={validateEmail} />
      <div className="field">
        <label htmlFor="lang">Preferred language</label>
        <select id="lang" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
          <option value="">No preference</option>
          {[['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['ar', 'Arabic'], ['ur', 'Urdu'], ['hi', 'Hindi']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <label style={{ display: 'flex', gap: 8, marginBottom: 6 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.smsOptIn} onChange={(e) => setForm({ ...form, smsOptIn: e.target.checked })} /> Text me confirmations and reminders</label>
      <label style={{ display: 'flex', gap: 8, marginBottom: 12 }}><input type="checkbox" style={{ width: 'auto' }} checked={form.emailOptIn} onChange={(e) => setForm({ ...form, emailOptIn: e.target.checked })} /> Email me confirmations and reminders</label>
      {msg && <p className={msg.ok ? 'success-text' : 'error-text'} role="status">{msg.text}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
    </form>
  );
}

function Account({ slug, token, me, onSignOut, reload }) {
  const confirm = useConfirm();
  const [list, setList] = useState(null);
  const [note, setNote] = useState(null);
  const load = () => customerApi.appointments(token).then(setList).catch((e) => { if (e instanceof ApiError && e.status === 401) onSignOut(); });
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function download() {
    const data = await customerApi.exportData(token);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'my-data.json';
    a.click();
  }
  async function requestDeletion() {
    if (!(await confirm({ title: 'Delete my data?', message: `Ask ${me.business.name} to delete your data? They will follow up with you.`, confirmLabel: 'Send request', danger: true }))) return;
    try { setNote((await customerApi.requestDeletion(token)).message); } catch (err) { setNote(err.message); }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Hi{me.name ? `, ${me.name.split(' ')[0]}` : ''}</h2>
        <button type="button" className="ghost" onClick={onSignOut}>Sign out</button>
      </div>

      <h3 style={{ fontSize: 15 }}>Upcoming</h3>
      {!list && <Loading />}
      {list?.upcoming.length === 0 && <p className="muted">No upcoming appointments. <Link href={`/book/${slug}`}>Book one</Link></p>}
      <div className="stack" style={{ gap: 10 }}>{list?.upcoming.map((a) => <Appointment key={a.id} a={a} token={token} biz={me.business} onChanged={load} />)}</div>
      {list?.upcoming.length > 0 && <p style={{ marginTop: 12 }}><Link href={`/book/${slug}`}>Book another appointment</Link></p>}

      {list?.history.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 24 }}>Past and cancelled</h3>
          <div className="stack" style={{ gap: 10 }}>{list.history.map((a) => <Appointment key={a.id} a={a} token={token} biz={me.business} onChanged={load} />)}</div>
        </>
      )}

      <h3 style={{ fontSize: 15, marginTop: 24 }}>Your details</h3>
      <Details me={me} token={token} onSaved={reload} />

      <h3 style={{ fontSize: 15, marginTop: 24 }}>Your data</h3>
      <div className="row">
        <button type="button" onClick={download}>Download my data</button>
        <button type="button" className="danger" onClick={requestDeletion}>Ask to delete my data</button>
      </div>
      {note && <p role="status" className="muted" style={{ fontSize: 13 }}>{note}</p>}
    </>
  );
}

export default function MyPage() {
  const { slug } = useParams();
  const [biz, setBiz] = useState(null);
  const [missing, setMissing] = useState(false);
  const [token, setToken] = useState(undefined); // undefined = not read yet
  const [me, setMe] = useState(null);

  useEffect(() => { publicApi.business(slug).then(setBiz).catch(() => setMissing(true)); }, [slug]);
  useEffect(() => { setToken(readToken(slug)); }, [slug]);

  const loadMe = (t = token) => customerApi.me(t).then(setMe).catch(() => { writeToken(slug, null); setToken(null); setMe(null); });
  useEffect(() => { if (token) loadMe(token); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = () => { writeToken(slug, null); setToken(null); setMe(null); };

  return (
    <main id="main-content" tabIndex={-1} style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px' }}>
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        {missing && <><h1 style={{ fontSize: 20 }}>We couldn&apos;t find that business</h1><p className="muted"><Link href="/find">Find a business</Link></p></>}
        {biz && (
          <div style={{ marginBottom: 16 }}>
            <div className="muted" style={{ fontSize: 12 }}><Link href={`/book/${slug}`}>Book an appointment</Link></div>
            <h1 style={{ fontSize: 22, margin: '4px 0 2px' }}>{biz.name}</h1>
            <div className="muted" style={{ fontSize: 13 }}>{[biz.address, biz.city && !biz.address?.includes(biz.city) ? biz.city : null].filter(Boolean).join(', ')}</div>
          </div>
        )}
        {biz && token === undefined && <Loading />}
        {biz && token === null && <SignIn slug={slug} biz={biz} onToken={(t) => { writeToken(slug, t); setToken(t); }} />}
        {biz && token && !me && <Loading />}
        {biz && token && me && <Account slug={slug} token={token} me={me} onSignOut={signOut} reload={() => loadMe(token)} />}
      </div>
    </main>
  );
}
