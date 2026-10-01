'use client';
import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { DateTime } from '../../lib/datetime';
import Loading from '../../components/Skeleton';

function AuditLogInner() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listAuditLogs().then(setLogs).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>Activity history</h1>
        <p className="muted" style={{ marginTop: 4 }}>Every change made from this dashboard — who did what, and when.</p>
      </div>

      <div className="card">
        {loading && <Loading />}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <div className="empty-state">
            <History size={28} color="var(--text-faint)" />
            <p>No admin actions recorded yet.</p>
          </div>
        )}
        {!loading && logs.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Status</th></tr></thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{DateTime.formatDateTime(log.createdAt)}</td>
                  <td>{log.admin?.name || log.admin?.email || 'Unknown'}</td>
                  <td><code style={{ fontSize: 12 }}>{log.method} {log.path}</code></td>
                  <td>{log.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  return (
    <RequireAuth area="settings">
      <AuditLogInner />
    </RequireAuth>
  );
}
