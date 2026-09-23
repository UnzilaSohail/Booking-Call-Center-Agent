'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Contact, Download, Upload } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';

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

  const load = useCallback((query) => {
    setLoading(true);
    api.listCustomers(query)
      .then(setCustomers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(''); }, [load]);

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

      <form onSubmit={search} className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, or email" style={{ maxWidth: 320 }} />
        <button type="submit" className="ghost">Search</button>
      </form>

      <div className="card">
        {loading && <p className="muted">Loading...</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && customers.length === 0 && (
          <div className="empty-state">
            <Contact size={28} color="var(--text-faint)" />
            <p>No customers yet — they show up automatically once someone books or calls.</p>
          </div>
        )}
        {!loading && customers.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Tags</th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/customers/${c.id}`}>{c.name || '(no name)'}</Link></td>
                  <td>{c.phone}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.tags?.length ? c.tags.map((t) => <span key={t} className="badge neutral" style={{ marginRight: 4 }}>{t}</span>) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
