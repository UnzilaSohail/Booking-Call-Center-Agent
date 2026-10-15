'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';

// Self-service delete/restore — a soft flag only (src/routes/config.js DELETE
// /business), not the platform admin's hard delete which actually wipes data. Staying
// logged in while deleted is what makes undo a one-click "Restore" instead of a
// forgot-password-style recovery flow.
export default function DeleteAccountSection() {
  const toast = useToast();
  const [business, setBusiness] = useState(null);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.getBusiness().then(setBusiness).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function del(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteBusiness(confirmName);
      toast.success('Account deleted — you can restore it any time from here');
      setConfirmName('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      await api.restoreBusiness();
      toast.success('Account restored');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!business) return null;

  if (business.status === 'deleted') {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <h2>Account deleted</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>
          {business.name} was deleted{business.deletedAt ? ` on ${new Date(business.deletedAt).toLocaleString()}` : ''}.
          Your data hasn&apos;t been touched — restore any time.
        </p>
        <button className="primary" onClick={restore} disabled={busy}>{busy ? 'Restoring...' : 'Restore account'}</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderColor: 'var(--danger)' }}>
      <h2>Delete account</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        Deactivates {business.name}. This is reversible — you can restore it from this same
        page any time. To permanently erase all data instead, contact the platform.
      </p>
      <form onSubmit={del} className="row" style={{ alignItems: 'center' }}>
        <input
          aria-label="Type the business name to confirm deletion"
          placeholder={`Type "${business.name}" to confirm`}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          style={{ width: 260 }}
        />
        <button type="submit" className="danger" disabled={busy || confirmName !== business.name}>
          <Trash2 size={15} /> {busy ? 'Deleting...' : 'Delete account'}
        </button>
      </form>
      {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}
    </div>
  );
}
