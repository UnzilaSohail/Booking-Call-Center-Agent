'use client';
import { useEffect, useState } from 'react';
import { useToast } from '../lib/Toast';
import Loading from './Skeleton';
import PasswordInput from './PasswordInput';

// MFA (ROADMAP.md §12, plan.md §11 item 9) — TOTP only, no QR image rendered here; the
// secret is shown as text for manual entry into an authenticator app. Shared by the company
// Settings page and the platform Settings page: `client` is `api` or `platformApi` (lib/api.js).
export default function MfaCard({ client }) {
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [enrollment, setEnrollment] = useState(null); // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    client.getMe().then(setMe).catch((e) => setError(e.message));
  }
  useEffect(load, [client]);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await client.mfaEnroll());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.mfaEnrollConfirm(code);
      toast.success('Two-factor authentication enabled');
      setEnrollment(null);
      setCode('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.mfaDisable(password);
      toast.success('Two-factor authentication disabled');
      setPassword('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <div className="card">{error ? <p className="error-text">{error}</p> : <Loading />}</div>;

  return (
    <div className="card">
      <h2>Two-factor authentication</h2>
      {me.mfaEnabled ? (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>Enabled — a code from your authenticator app is required at login.</p>
          <form onSubmit={disable} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Current password</label>
              <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="danger" disabled={busy}>{busy ? 'Disabling...' : 'Disable'}</button>
          </form>
        </>
      ) : enrollment ? (
        <form onSubmit={confirmEnroll}>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>
            Add an account in your authenticator app (Google Authenticator, Authy, 1Password, ...) using this key, then enter the 6-digit code it shows.
          </p>
          <div className="field">
            <label>Secret key</label>
            <input readOnly value={enrollment.secret} style={{ fontFamily: 'ui-monospace, monospace' }} onFocus={(e) => e.target.select()} />
          </div>
          <div className="field">
            <label>6-digit code</label>
            <input inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Verifying...' : 'Enable'}</button>
            <button type="button" className="ghost" onClick={() => setEnrollment(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>Not enabled. Require a 6-digit authenticator code in addition to your password at login.</p>
          <button className="primary" onClick={startEnroll} disabled={busy}>{busy ? 'Starting...' : 'Set up two-factor authentication'}</button>
        </>
      )}
      {error && !enrollment && <p className="error-text">{error}</p>}
    </div>
  );
}
