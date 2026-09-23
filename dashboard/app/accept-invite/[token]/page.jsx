'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { acceptInviteApi, setToken, ApiError } from '../../../lib/api';

const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', receptionist: 'Receptionist', staff: 'Staff', billing: 'Billing', custom: 'Custom access' };

// Public, token-authenticated page (ROADMAP.md §10 "User invitation") — reached from
// the link in a team-invite email (src/routes/team.js), no dashboard login yet. Same
// standalone-card shape as dashboard/app/manage/[token]/page.jsx.
function AcceptInviteInner() {
  const { token } = useParams();
  const router = useRouter();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    acceptInviteApi.get(token).then(setInvite).catch((e) => setError(e instanceof ApiError ? e.message : 'something went wrong'));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setFormError(null);
    if (password.length < 8) return setFormError('password must be at least 8 characters');
    if (password !== confirmPassword) return setFormError('passwords do not match');

    setSaving(true);
    try {
      const { token: sessionToken } = await acceptInviteApi.accept(token, password);
      setToken(sessionToken);
      router.push('/');
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 0' }}>
      <div className="card" style={{ width: 400 }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600 }}>Join the team</div>
        </div>

        {error && <p className="error-text">This invite link has expired or is invalid. Ask the business owner to send a new one.</p>}
        {!error && !invite && <p className="muted">Loading...</p>}

        {!error && invite && (
          <form onSubmit={submit} className="stack">
            <p style={{ fontSize: 14 }}>
              You&apos;ve been invited to join <strong>{invite.businessName}</strong> as a <strong>{ROLE_LABELS[invite.role] ?? invite.role}</strong>. Set a password to finish setting up your account.
            </p>
            <div className="field">
              <label>Password</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            {formError && <p className="error-text">{formError}</p>}
            <button type="submit" className="primary" disabled={saving}>{saving ? 'Setting up...' : 'Set password and log in'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return <AcceptInviteInner />;
}
