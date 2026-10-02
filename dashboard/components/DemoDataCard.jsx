'use client';
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { platformApi } from '../lib/api';
import { useConfirm } from '../lib/confirm';

// Platform console: add or remove the demo businesses (src/services/demoData.js). Everything it makes is flagged
// as demo and removed by the second button; real companies are never touched. The login password is shown once.
export default function DemoDataCard({ onChanged }) {
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [listed, setListed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const refresh = () => platformApi.getDemoData().then(setStatus).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const add = () => run(async () => setResult(await platformApi.addDemoData(listed)));
  const remove = async () => {
    if (!(await confirm({ title: 'Remove all demo data?', message: 'This deletes every demo business with its bookings, calls, customers and invoices. Real companies are not touched.', confirmLabel: 'Remove demo data', danger: true }))) return;
    await run(async () => { await platformApi.removeDemoData(); setResult(null); });
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2><Sparkles size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} aria-hidden="true" />Demo data</h2>
          <p className="muted" style={{ fontSize: 13, margin: '3px 0 0', maxWidth: 560 }}>
            Fill the product with realistic fake businesses, three months of bookings, calls and invoices, so it can be shown to clients before any real one signs up. Remove it with one click when real clients arrive.
          </p>
        </div>
        <span className={`badge ${status?.present ? 'warning' : 'neutral'}`}>{status ? (status.present ? `${status.businesses.length} demo businesses` : 'No demo data') : '...'}</span>
      </div>
      <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={listed} onChange={(e) => setListed(e.target.checked)} />
          Show demo businesses in the public directory (/find)
        </label>
        <button type="button" className="primary" disabled={busy} onClick={add}>{busy ? 'Working...' : status?.present ? 'Reset demo data' : 'Add demo data'}</button>
        {status?.present && <button type="button" className="danger" disabled={busy} onClick={remove}>Remove demo data</button>}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {result && (
        <div role="status" className="card" style={{ marginTop: 14, background: 'var(--surface-alt)', boxShadow: 'none' }}>
          <strong>Demo data added.</strong> {result.counts.bookings} bookings, {result.counts.calls} calls, {result.counts.customers} customers.
          <div style={{ fontSize: 13.5, marginTop: 6 }}>Log in as <code>{result.owners[0]}</code> (busy salon) or <code>{result.owners[1]}</code> (new business that has not finished setup).</div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>Password (shown only now): <code>{result.password}</code></div>
        </div>
      )}
    </div>
  );
}
