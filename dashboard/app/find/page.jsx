'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { publicApi } from '../../lib/api';

// Public directory (docs/customer/DISCOVERY_AND_LISTING.md): a customer who doesn't have a
// business link searches here. Each card shows the street address and city so two
// "ABC Salon"s can't be mixed up; only businesses that opted in and are ready show up.
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26 }}>Find a business to book with</h1>
        <p className="muted" style={{ marginTop: 0 }}>Search by name or by what you need, like &ldquo;haircut&rdquo; or &ldquo;teeth cleaning&rdquo;.</p>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="field">
            <label htmlFor="q">Business or service</label>
            <input id="q" type="search" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="ABC Salon, haircut, dentist..." />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
              <label htmlFor="cat">Type</label>
              <select id="cat" value={category} onChange={(e) => reset(setCategory)(e.target.value)}>
                <option value="">All types</option>
                {categories.map((c) => <option key={c.name} value={c.name}>{label(c.name)} ({c.count})</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
              <label htmlFor="city">City</label>
              <select id="city" value={city} onChange={(e) => reset(setCity)(e.target.value)}>
                <option value="">Anywhere</option>
                {cities.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0, alignSelf: 'flex-end' }}>
              <button type="button" onClick={findNearMe} disabled={locating} style={near ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : undefined}>
                {locating ? 'Locating...' : near ? '✓ Sorted by distance' : 'Near me'}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="muted">Loading...</p>}
        {data?.results.length === 0 && (
          <div className="card">
            <p style={{ margin: 0 }}>No businesses match. Try a different word or clear the filters.</p>
          </div>
        )}
        {data?.results.length === 0 && <LeadForm defaultCity={city} />}

        <div className="stack" style={{ gap: 12 }}>
          {data?.results.map((b) => (
            <div key={b.slug} className="card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{b.name}</h2>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {[b.address, b.address?.includes(b.city) ? null : b.city].filter(Boolean).join(', ')}
                    {b.distanceKm != null && <> · {b.distanceKm < 1 ? 'less than 1 km' : `${Math.round(b.distanceKm)} km`} away</>}
                  </div>
                  {b.categories.length > 0 && (
                    <div className="row" style={{ gap: 6, marginTop: 8 }}>{b.categories.map((c) => <span key={c} className="badge neutral">{label(c)}</span>)}</div>
                  )}
                  {b.description && <p style={{ fontSize: 13.5, margin: '8px 0 0' }}>{b.description}</p>}
                  {b.services.length > 0 && (
                    <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                      {b.services.map((s) => `${s.name}${s.price != null ? ` $${s.price}` : ''}`).join(' · ')}
                    </div>
                  )}
                </div>
                <Link href={`/book/${b.slug}`}><button type="button" className="primary">Book</button></Link>
              </div>
            </div>
          ))}
        </div>

        {data && data.total > data.pageSize && (
          <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted">Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
            <button type="button" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
        {data?.results.length > 0 && (
          <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>
            Not finding the right fit?{' '}
            <button type="button" onClick={() => setLeadOpen((v) => !v)} style={{ padding: 0, border: 'none', background: 'none', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}>
              Tell us what you need
            </button>
          </p>
        )}
        {data?.results.length > 0 && leadOpen && <LeadForm defaultCity={city} />}

        <p className="muted" style={{ fontSize: 12.5, marginTop: 24 }}>Are you a business? <Link href="/signup">Sign up</Link> or <Link href="/login">log in</Link>.</p>
      </div>
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
