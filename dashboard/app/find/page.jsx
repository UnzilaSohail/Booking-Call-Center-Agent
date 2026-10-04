'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MapPin, Navigation, Search } from 'lucide-react';
import { publicApi } from '../../lib/api';
import { gradientFor, initials } from '../../lib/brand';
import Loading from '../../components/Skeleton';
import PublicNav from '../../components/PublicNav';

// Public directory (docs/customer/DISCOVERY_AND_LISTING.md): a customer who doesn't have a business link
// searches here. Each card shows the street address and city so two "ABC Salon"s can't be mixed up; only
// businesses that opted in and are ready show up. Look: one friendly search bar, quick type chips, and
// cards that lift on hover (theme.css).
const label = (slug) => slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function FindPage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [categories, setCategories] = useState([]);
  const [cities, setCities] = useState([]);
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  // Jira 16x "near me" — the coords themselves, plus state for the button's own label
  // (not just a boolean) so the person gets real feedback ("locating...", or why it failed)
  // instead of a button that silently does nothing.
  const [near, setNear] = useState(null);
  const [locating, setLocating] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);

  useEffect(() => {
    publicApi.categories().then(setCategories).catch(() => {});
    publicApi.cities().then(setCities).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = { page };
      if (q.trim()) params.q = q.trim();
      if (category) params.category = category;
      if (city) params.city = city;
      if (near) { params.lat = near.lat; params.lng = near.lng; }
      publicApi.directory(params).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, category, city, page, near]);

  const reset = (fn) => (v) => { fn(v); setPage(1); };

  function findNearMe() {
    if (!navigator.geolocation) { setError('Your browser does not support location search.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false); setPage(1); },
      () => { setError("Couldn't get your location — check your browser's location permission."); setLocating(false); },
      { timeout: 10_000 }
    );
  }

  return (
    <div className="public-shell">
      <PublicNav />
      <main id="main-content" tabIndex={-1} className="public-wrap">
        <section className="hero fade-up">
          <h1>Book local services <span className="grad-text">in seconds</span></h1>
          <p className="lead">Find a salon, clinic or studio near you and book online. No phone call, no account needed.</p>

          <form className="search-pill" role="search" onSubmit={(e) => e.preventDefault()}>
            <div className="seg">
              <Search size={18} color="var(--text-muted)" aria-hidden="true" />
              <label htmlFor="q">Business or service</label>
              <input id="q" type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Haircut, dentist, Glow Studio..." autoComplete="off" />
            </div>
            <div className="seg city">
              <MapPin size={18} color="var(--text-muted)" aria-hidden="true" />
              <label htmlFor="city">City</label>
              <select id="city" value={city} onChange={(e) => reset(setCity)(e.target.value)}>
                <option value="">Anywhere</option>
                {cities.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
              </select>
            </div>
            <button type="button" className="primary" onClick={findNearMe} disabled={locating} style={{ borderRadius: 999, padding: '0 20px' }}>
              <Navigation size={15} aria-hidden="true" /> {locating ? 'Locating...' : near ? 'Nearest first' : 'Near me'}
            </button>
          </form>

          <div className="chip-row" role="group" aria-label="Type of business">
            <button type="button" className="chip-btn" aria-pressed={!category} onClick={() => reset(setCategory)('')}>All</button>
            {categories.map((c) => (
              <button key={c.name} type="button" className="chip-btn" aria-pressed={category === c.name} onClick={() => reset(setCategory)(category === c.name ? '' : c.name)}>
                {label(c.name)} <span style={{ opacity: 0.7 }}>{c.count}</span>
              </button>
            ))}
          </div>
          <div className="trust-row">
            <span>Book in under a minute</span><span>Instant confirmation</span><span>Change or cancel online</span>
          </div>
        </section>

        {error && <p className="error-text" role="alert">{error}</p>}
        {!data && !error && (
          <div className="stack" style={{ gap: 14 }}>{[0, 1, 2].map((i) => <div key={i} className="card" style={{ padding: 22 }}><Loading lines={3} /></div>)}</div>
        )}
        {data && data.results.length > 0 && (
          <p className="muted" style={{ margin: '0 0 12px' }} aria-live="polite">{data.total} business{data.total === 1 ? '' : 'es'} found{near ? ', nearest first' : ''}</p>
        )}
        {data?.results.length === 0 && (
          <div className="card" style={{ padding: 22 }}>
            <p style={{ margin: '0 0 10px' }}>{q || category || city || near ? 'No businesses match. Try a different word, or clear the filters.' : 'No businesses are listed here yet. Tell us what you need and we will help you find one.'}</p>
            {(q || category || city || near) && <button type="button" onClick={() => { setQ(''); setCategory(''); setCity(''); setNear(null); setPage(1); }}>Clear filters</button>}
          </div>
        )}
        {data?.results.length === 0 && <LeadForm defaultCity={city} />}

        <div className="stack stagger" style={{ gap: 14 }}>
          {data?.results.map((b) => (
            <article key={b.slug} className="card lift biz-card">
              <div className="avatar-lg" style={{ background: gradientFor(b.name) }} aria-hidden="true">{initials(b.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 19 }}>{b.name}</h2>
                <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
                  <MapPin size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} aria-hidden="true" />
                  {[b.address, b.address?.includes(b.city) ? null : b.city].filter(Boolean).join(', ')}
                  {b.distanceKm != null && <> · {b.distanceKm < 1 ? 'less than 1 km' : `${Math.round(b.distanceKm)} km`} away</>}
                </div>
                {b.categories.length > 0 && (
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>{b.categories.map((c) => <span key={c} className="badge violet">{label(c)}</span>)}</div>
                )}
                {b.description && <p style={{ fontSize: 14, margin: '8px 0 0' }}>{b.description}</p>}
                {b.services.length > 0 && (
                  <div className="chips" style={{ marginTop: 10, marginBottom: 0 }}>
                    {b.services.map((s) => <span key={s.name} className="chip">{s.name}{s.price != null ? ` · $${s.price}` : ''}</span>)}
                  </div>
                )}
              </div>
              <Link href={`/book/${b.slug}`} aria-label={`Book with ${b.name}`}><button type="button" className="primary" style={{ borderRadius: 999, padding: '10px 22px' }}>Book</button></Link>
            </article>
          ))}
        </div>

        {data && data.total > data.pageSize && (
          <div className="row" style={{ marginTop: 18, alignItems: 'center' }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted">Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
            <button type="button" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
        {data?.results.length > 0 && (
          <p className="muted" style={{ fontSize: 13.5, marginTop: 22 }}>
            Not finding the right fit?{' '}
            <button type="button" onClick={() => setLeadOpen((v) => !v)} style={{ padding: 0, border: 'none', background: 'none', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', boxShadow: 'none' }}>
              Tell us what you need
            </button>
          </p>
        )}
        {data?.results.length > 0 && leadOpen && <LeadForm defaultCity={city} />}

        <p className="muted" style={{ fontSize: 13, marginTop: 28 }}>Are you a business? <Link href="/signup">Sign up</Link> or <Link href="/login">log in</Link>.</p>
      </main>
    </div>
  );
}

// Jira 16z — captured even when the directory search itself found nothing, or by choice
// from a visitor who saw results but still wants a human to match them. No business_id:
// nobody's been matched yet (src/routes/publicBooking.js POST /public/leads).
function LeadForm({ defaultCity }) {
  const [form, setForm] = useState({ name: '', contact: '', need: '', city: defaultCity || '', website: '' });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await publicApi.submitLead(form);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (done) return <div className="card" style={{ marginTop: 12 }}><p className="success-text" style={{ margin: 0 }}>Thanks — we&apos;ll follow up to help you find the right business.</p></div>;

  return (
    <form onSubmit={submit} className="card" style={{ marginTop: 12 }}>
      <p style={{ marginTop: 0, fontWeight: 600 }}>Tell us what you need</p>
      <div className="field"><label htmlFor="lead-name">Your name</label><input id="lead-name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="lead-contact">Phone or email</label><input id="lead-contact" required maxLength={150} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
      <div className="field"><label htmlFor="lead-need">What are you looking for?</label><textarea id="lead-need" required maxLength={1000} rows={3} value={form.need} onChange={(e) => setForm({ ...form, need: e.target.value })} /></div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="primary" disabled={saving}>{saving ? 'Sending...' : 'Send'}</button>
    </form>
  );
}
