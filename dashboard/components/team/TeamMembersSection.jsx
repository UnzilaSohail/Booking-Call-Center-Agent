'use client';
import { useEffect, useState } from 'react';
import { Link2, Send, UserCheck, UserX, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { copyText } from '../../lib/clipboard';
import Loading from '../Skeleton';
import LoadError from '../LoadError';
import { useApi } from '../../lib/useApi';
import { useConfirm } from '../../lib/confirm';

// Matches src/permissions.js's AREAS — the fixed set a custom role picks from.
const ROLES = ['manager', 'receptionist', 'staff', 'billing', 'custom'];
const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', receptionist: 'Receptionist', staff: 'Staff', billing: 'Billing', custom: 'Custom' };
const AREAS = ['bookings', 'customers', 'calls', 'services', 'team', 'settings', 'exceptions'];
const AREA_LABELS = { bookings: 'Bookings and calendar', customers: 'Customers', calls: 'Call history', services: 'Services', team: 'Team', settings: 'Settings', exceptions: 'Needs attention' };

export default function TeamMembersSection() {
  const confirm = useConfirm();
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('receptionist');
  const [permissions, setPermissions] = useState([]);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState(null);
  // Last invite result ({email, link, emailSent, emailError, linkOnly}) — stays on screen so the
  // owner can copy the link even when the email could not be sent.
  const [lastInvite, setLastInvite] = useState(null);

  const { data: members, error: loadError, reload: load } = useApi(() => api.listTeamMembers(), [], []);
  useEffect(() => { api.getMe().then(setMe).catch(() => {}); }, []);

  const isOwner = me?.role === 'owner';

  async function invite(e) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      const res = await api.inviteTeamMember({ name, email, role, permissions: role === 'custom' ? permissions : undefined });
      setName(''); setEmail(''); setRole('receptionist'); setPermissions([]);
      showInvite(email, res);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  }

  function showInvite(toEmail, res) {
    setLastInvite({ email: toEmail, link: res.inviteLink, emailSent: res.emailSent, emailError: res.emailError });
    if (res.emailSent) toast.success(`Invite emailed to ${toEmail}`);
    else toast.warning(`Invite created for ${toEmail}, but the email was not sent. Copy the link below and send it to them.`);
  }

  async function copyInviteLink(m) {
    try {
      const res = await api.resendInvite(m.id, { sendEmail: false });
      setLastInvite({ email: m.email, link: res.inviteLink, emailSent: false, emailError: null, linkOnly: true });
      if (await copyText(res.inviteLink)) toast.success('Invite link copied');
      else toast.warning('Could not copy automatically. Select the link below and copy it.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function resendInvite(m) {
    try {
      showInvite(m.email, await api.resendInvite(m.id));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function copyShownLink() {
    if (await copyText(lastInvite.link)) toast.success('Invite link copied');
    else toast.warning('Could not copy automatically. Select the link and copy it.');
  }

  async function setStatus(id, status) {
    if (status === 'suspended' && !(await confirm({ title: 'Suspend this team member?', message: 'They will immediately lose access.', confirmLabel: 'Suspend', danger: true }))) return;
    try {
      await api.updateTeamMember(id, { status });
      toast.success(status === 'suspended' ? 'Suspended' : 'Reactivated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function setRoleFor(id, newRole) {
    try {
      await api.updateTeamMember(id, { role: newRole });
      toast.success('Role updated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Who can log in</h2>
      <p className="muted" style={{ marginTop: -8 }}>Who can log into this dashboard, and what they can see.</p>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{isOwner && <th></th>}</tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.name || '—'}</td>
              <td>{m.email}</td>
              <td>
                {isOwner && m.role !== 'owner' ? (
                  <select value={m.role} onChange={(e) => setRoleFor(m.id, e.target.value)} style={{ maxWidth: 150 }}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                ) : (ROLE_LABELS[m.role] ?? m.role)}
              </td>
              <td><span className={`badge ${m.status === 'suspended' ? 'danger' : m.status === 'invited' ? 'neutral' : 'success'}`}>{m.status}</span></td>
              {isOwner && (
                <td>
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  {m.role !== 'owner' && m.status === 'invited' && (
                    <>
                      <button className="icon-btn" onClick={() => copyInviteLink(m)} title="Copy invite link" aria-label={`Copy invite link for ${m.email}`}><Link2 size={14} /></button>
                      <button className="icon-btn" onClick={() => resendInvite(m)} title="Resend invite email" aria-label={`Resend invite email to ${m.email}`}><Send size={14} /></button>
                    </>
                  )}
                  {m.role !== 'owner' && (m.status === 'suspended'
                    ? <button className="icon-btn" onClick={() => setStatus(m.id, 'active')} title="Reactivate" aria-label={`Reactivate ${m.email}`}><UserCheck size={14} /></button>
                    : <button className="icon-btn" onClick={() => setStatus(m.id, 'suspended')} title="Suspend" aria-label={`Suspend ${m.email}`}><UserX size={14} color="var(--danger)" /></button>)}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {members.length === 0 && <tr><td colSpan={isOwner ? 5 : 4}>{loadError ? <LoadError error={loadError} onRetry={load} /> : <Loading lines={2} />}</td></tr>}
        </tbody>
      </table>

      {isOwner && (
        <form onSubmit={invite} className="stack" style={{ gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invite someone</label>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}><label>Name</label><input required value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field" style={{ maxWidth: 160 }}>
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <button type="submit" className="primary" disabled={inviting}>{inviting ? 'Inviting...' : 'Invite'}</button>
          </div>
          {role === 'custom' && (
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {AREAS.map((a) => (
                <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={permissions.includes(a)} onChange={(e) => setPermissions((prev) => (e.target.checked ? [...prev, a] : prev.filter((x) => x !== a)))} />
                  {AREA_LABELS[a]}
                </label>
              ))}
            </div>
          )}
        </form>
      )}
      {lastInvite && (
        <div className={`callout ${lastInvite.emailSent || lastInvite.linkOnly ? 'success' : 'warning'}`} role="status" style={{ marginTop: 14 }}>
          <p>
            {lastInvite.linkOnly
              ? <>Invite link for <strong>{lastInvite.email}</strong> (works for 7 days):</>
              : lastInvite.emailSent
                ? <>Invitation emailed to <strong>{lastInvite.email}</strong>. You can also share this link directly:</>
                : <>The invitation for <strong>{lastInvite.email}</strong> was created, but <strong>the email was not sent</strong>. Copy the link below and send it to them yourself (WhatsApp, SMS...). It works for 7 days.</>}
          </p>
          {!lastInvite.emailSent && !lastInvite.linkOnly && lastInvite.emailError && (
            <p className="muted" style={{ fontSize: 12 }}>Reason: {lastInvite.emailError}</p>
          )}
          <div className="row" style={{ alignItems: 'center' }}>
            <input readOnly value={lastInvite.link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button type="button" className="primary" onClick={copyShownLink}>Copy link</button>
            <button type="button" className="icon-btn" onClick={() => setLastInvite(null)} title="Dismiss" aria-label="Dismiss"><X size={14} /></button>
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
