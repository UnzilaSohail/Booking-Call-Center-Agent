'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Contact, Crown, Download, Mail, Upload, UserPlus, Users } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import Loading from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import Avatar from '../../components/Avatar';
import CountUp from '../../components/CountUp';

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CustomersInner() {
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const [shown, setShown] = useState(50);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback((query) => {
    setLoading(true);
    api.listCustomers(query)
      .then((r) => { setCustomers(r.items); setTotal(r.total); setShown(50); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(''); }, [load]);

  // 100 more rows; when everything fetched so far is on screen, fetch the next 500 from the server
  async function showMore() {
    if (shown < customers.length) { setShown(shown + 100); return; }
    setLoadingMore(true);
    try {
      const next = await api.listCustomers(q, customers.length);
      setCustomers((prev) => [...prev, ...next.items]);
      setShown(shown + 100);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function search(e) {
    e.preventDefault();
    load(q);
  }

  async function exportCsv() {
    try {
      const csv = await api.exportCustomersCsv();
      downloadText('customers.csv', csv);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function importCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { imported, updated } = await api.importCustomersCsv(text);
      toast.success(`Imported ${imported}, updated ${updated}`);
      load(q);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Customers</h1>
          <p className="muted" style={{ marginTop: 4 }}>Everyone who's called or booked, built up automatically from bookings and calls.</p>
        </div>
        <div className="row">
          <button className="ghost" onClick={exportCsv}><Download size={14} /> Export CSV</button>
          <button className="ghost" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            <Upload size={14} /> {importing ? 'Importing...' : 'Import CSV'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={importCsv} style={{ display: 'none' }} />
        </div>
      </div>

      {!loading && !error && customers.length > 0 && !q && (
        <div className="stat-cards">
          {[
            [Users, 'var(--accent-soft)', 'var(--accent)', 'Customers', total],
            [Crown, 'var(--warning-soft)', 'var(--warning)', 'VIP regulars', customers.filter((c) => c.tags?.includes('VIP')).length],
            [UserPlus, 'var(--success-soft)', 'var(--success)', 'New in the last 30 days', customers.filter((c) => Date.now() - new Date(c.created_at ?? 0).getTime() < 30 * 86_400_000).length],
            [Mail, 'var(--info-soft)', 'var(--info)', 'Reachable by email', customers.filter((c) => c.email).length],
          ].map(([Icon, bg, fg, label, value]) => (
            <div key={label} className="stat-card">
              <div className="icon-badge" style={{ background: bg }}><Icon size={17} color={fg} /></div>
              <div className="value"><CountUp value={value} /></div>
              <div className="label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={search} className="row">
        <input aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, or email" style={{ maxWidth: 320 }} />
        <button type="submit" className="ghost">Search</button>
      </form>

      <div className="card">
        {loading && <Loading />}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && customers.length === 0 && (
          <EmptyState icon={Contact} action={{ label: 'Import a customer list (CSV)', onClick: () => fileInputRef.current?.click() }}>
            No customers yet. They appear automatically when someone books or calls, or you can import a list you already have.
          </EmptyState>
        )}
        {!loading && customers.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Tags</th></tr></thead>
            <tbody>
              {customers.slice(0, shown).map((c) => (
                <tr key={c.id}>
                  <td><span className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}><Avatar name={c.name || c.phone} /><Link href={`/customers/${c.id}`}>{c.name || '(no name)'}</Link></span></td>
                  <td>{c.phone}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.tags?.length ? c.tags.map((t) => <span key={t} className="badge neutral" style={{ marginRight: 4 }}>{t}</span>) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && (customers.length > shown || customers.length < total) && (
          <div className="row" style={{ justifyContent: 'center', alignItems: 'center', marginTop: 14 }}>
            <span className="muted" style={{ fontSize: 13 }}>Showing {Math.min(shown, customers.length)} of {total}</span>
            <button type="button" disabled={loadingMore} onClick={showMore}>{loadingMore ? 'Loading...' : 'Show more'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  return (
    <RequireAuth area="customers">
      <CustomersInner />
    </RequireAuth>
  );
}
