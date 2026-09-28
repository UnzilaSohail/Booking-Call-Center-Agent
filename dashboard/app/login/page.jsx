'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, unifiedLogin, storeTokenForRole } from '../../lib/api';

// One login for both roles — the backend (src/routes/unifiedLogin.js) figures out
// whether these credentials belong to a platform admin or a company admin, so nobody
// has to remember a separate URL for each. Redirects to the right dashboard for
// whichever role it turned out to be.
//
// MFA (ROADMAP.md §12) is company-admin only — a second step swaps in here when the
// first response comes back mfaRequired instead of a token (src/routes/unifiedLogin.js).
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await unifiedLogin({ email, password });
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
        return;
      }
      storeTokenForRole(result.role, result.token);
      router.push(result.role === 'platform' ? '/platform' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = await api.mfaVerifyLogin(mfaToken, code);
      storeTokenForRole('business', token);
      router.push('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (mfaToken) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <form onSubmit={submitCode} className="card" style={{ width: 360 }}>
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600 }}>Booking</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Enter your 6-digit authenticator code</div>
          </div>
          <div className="field">
            <label>Code</label>
            <input inputMode="numeric" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <button type="button" className="ghost" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={() => { setMfaToken(null); setCode(''); }}>
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <form onSubmit={submit} className="card" style={{ width: 360 }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600 }}>Booking</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Log in</div>
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? 'Logging in...' : 'Log in'}
        </button>
        <p className="muted" style={{ marginTop: 16, fontSize: 12.5 }}>
          Works for both company and platform admin accounts.
        </p>
        <p className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
          New business? <Link href="/signup">Sign up</Link>
        </p>
      </form>
    </div>
  );
}
