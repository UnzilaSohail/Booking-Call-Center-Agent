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
      publicApi.directory(params).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, category, city, page]);

  const reset = (fn) => (v) => { fn(v); setPage(1); };

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
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="muted">Loading...</p>}
        {data?.results.length === 0 && (
          <div className="card"><p style={{ margin: 0 }}>No businesses match. Try a different word or clear the filters.</p></div>
        )}

        <div className="stack" style={{ gap: 12 }}>
          {data?.results.map((b) => (
            <div key={b.slug} className="card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{b.name}</h2>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{[b.address, b.address?.includes(b.city) ? null : b.city].filter(Boolean).join(', ')}</div>
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
        <p className="muted" style={{ fontSize: 12.5, marginTop: 24 }}>Are you a business? <Link href="/signup">Sign up</Link> or <Link href="/login">log in</Link>.</p>
      </div>
    </div>
  );
}
