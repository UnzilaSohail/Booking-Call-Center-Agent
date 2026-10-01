'use client';
import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import RequirePlatformAuth from '../../../components/RequirePlatformAuth';
import { platformApi } from '../../../lib/api';
import { DateTime } from '../../../lib/datetime';
import Loading from '../../../components/Skeleton';

// Jira 16z — leads from the directory's "Tell us what you need" form (src/routes/
// publicBooking.js POST /public/leads). Platform-wide since no business matched them yet.
function LeadsInner() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    platformApi.listLeads().then(setLeads).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Leads</h1>
        <p className="muted" style={{ marginTop: 4 }}>Visitors who searched the directory and asked to be matched manually, instead of booking directly.</p>
      </div>

      <div className="card">
        {error && <p className="error-text">{error}</p>}
        {loading && <Loading />}
        {!loading && leads.length === 0 && (
          <div className="empty-state">
            <Inbox size={28} color="var(--text-faint)" />
            <p>No leads yet.</p>
          </div>
        )}
        {!loading && leads.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Name</th><th>Contact</th><th>City</th><th>What they need</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>{DateTime.formatDateTime(l.createdAt)}</td>
                  <td>{l.name}</td>
                  <td>{l.contact}</td>
                  <td>{l.city ?? '—'}</td>
                  <td>{l.need}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function PlatformLeadsPage() {
  return (
    <RequirePlatformAuth>
      <LeadsInner />
    </RequirePlatformAuth>
  );
}
