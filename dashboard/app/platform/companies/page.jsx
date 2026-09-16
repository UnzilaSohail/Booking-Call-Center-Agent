'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import RequirePlatformAuth from '../../../components/RequirePlatformAuth';
import RegisterCompanyForm from '../../../components/RegisterCompanyForm';
import { platformApi } from '../../../lib/api';

function StatusBadge({ status }) {
  return <span className={`badge ${status === 'suspended' ? 'danger' : 'success'}`}>{status}</span>;
}

function CompaniesInner() {
  const router = useRouter();
  const [companies, setCompanies] = useState([]);
  const [q, setQ] = useState('');
  const [listError, setListError] = useState(null);

  const load = () => platformApi.listCompanies(q || undefined).then(setCompanies).catch((e) => setListError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div>
        <h1>Companies</h1>
        <p className="muted" style={{ marginTop: 4 }}>Register new companies and manage everyone on the platform.</p>
      </div>

      <RegisterCompanyForm onRegistered={load} />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2>All companies</h2>
          <div style={{ position: 'relative', width: 220 }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-faint)' }} />
            <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 28 }} />
          </div>
        </div>
        {listError && <p className="error-text">{listError}</p>}
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>Timezone</th><th>Phone number</th><th>Upcoming</th><th>Registered</th></tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/platform/companies/${c.id}`)}>
                <td>{c.name}</td>
                <td><StatusBadge status={c.status} /></td>
                <td>{c.timezone}</td>
                <td>{c.phoneNumber ?? '—'}</td>
                <td>{c.upcomingBookings}</td>
                <td>{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {companies.length === 0 && !listError && (
              <tr><td colSpan={6} className="muted">No companies match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  return (
    <RequirePlatformAuth>
      <CompaniesInner />
    </RequirePlatformAuth>
  );
}
