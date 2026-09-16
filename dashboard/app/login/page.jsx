'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { unifiedLogin, storeTokenForRole } from '../../lib/api';

// One login for both roles — the backend (src/routes/unifiedLogin.js) figures out
// whether these credentials belong to a platform admin or a company admin, so nobody
// has to remember a separate URL for each. Redirects to the right dashboard for
// whichever role it turned out to be.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, role } = await unifiedLogin({ email, password });
      storeTokenForRole(role, token);
      router.push(role === 'platform' ? '/platform' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
          Works for both company and platform admin accounts — new accounts are created
          by a platform admin, not self-service.
        </p>
      </form>
    </div>
  );
}
