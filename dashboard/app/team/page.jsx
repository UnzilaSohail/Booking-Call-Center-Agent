'use client';
import { Fragment, useEffect, useState } from 'react';
import { CalendarClock, Mail, Pencil, Plus, Trash2, UserX, X } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import Avatar from '../../components/Avatar';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { DateTime } from '../../lib/datetime';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ROLES = ['manager', 'receptionist', 'staff', 'billing', 'custom'];
const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', receptionist: 'Receptionist', staff: 'Staff', billing: 'Billing', custom: 'Custom' };

function emptyWeek() {
  return DAY_NAMES.map((_, day) => ({ dayOfWeek: day, closed: true, openTime: '09:00', closeTime: '17:00' }));
}

// Expandable per-staff schedule: hours (defaults to "follow business hours" unless
// overridden), an optional daily break, a location assignment, and time off — same
// row-expand pattern the Calls page uses for call details.
function StaffScheduleEditor({ staff, locations, services, onChanged }) {
  const toast = useToast();
  const [customHours, setCustomHours] = useState(staff.hours != null);
  const [customServices, setCustomServices] = useState(staff.service_ids != null);
  const [serviceIds, setServiceIds] = useState(staff.service_ids ?? []);
  const [rows, setRows] = useState(() => {
    if (!staff.hours) return emptyWeek();
    return emptyWeek().map((row) => {
      const match = staff.hours.find((h) => h.day_of_week === row.dayOfWeek);
      return match ? { ...row, closed: false, openTime: match.open_time.slice(0, 5), closeTime: match.close_time.slice(0, 5) } : row;
    });
  });
  const [breakEnabled, setBreakEnabled] = useState(!!staff.daily_break);
  const [breakStart, setBreakStart] = useState(staff.daily_break?.start_time?.slice(0, 5) ?? '12:00');
  const [breakEnd, setBreakEnd] = useState(staff.daily_break?.end_time?.slice(0, 5) ?? '13:00');
  const [locationId, setLocationId] = useState(staff.location_id ?? '');
  const [phone, setPhone] = useState(staff.phone ?? '');
  const [timeOff, setTimeOff] = useState(null);
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newReason, setNewReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function loadTimeOff() {
    api.listStaffTimeOff(staff.id).then(setTimeOff).catch((e) => setError(e.message));
  }
  useEffect(loadTimeOff, [staff.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateRow(day, patch) {
    setRows((prev) => prev.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));
  }

  async function saveSchedule() {
    setSaving(true);
    setError(null);
    try {
      await api.updateStaff(staff.id, {
        hours: customHours ? rows.filter((r) => !r.closed).map((r) => ({ dayOfWeek: r.dayOfWeek, openTime: r.openTime, closeTime: r.closeTime })) : null,
        dailyBreak: breakEnabled ? { startTime: breakStart, endTime: breakEnd } : null,
        locationId: locationId || null,
        phone: phone || null,
        serviceIds: customServices ? serviceIds : null,
      });
      toast.success(`${staff.name}'s schedule saved`);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addTimeOff(e) {
    e.preventDefault();
    if (!newStart || !newEnd) return;
    setError(null);
    try {
      await api.createStaffTimeOff(staff.id, { startTime: new Date(newStart).toISOString(), endTime: new Date(newEnd).toISOString(), reason: newReason || undefined });
      setNewStart(''); setNewEnd(''); setNewReason('');
      toast.success('Time off added');
      loadTimeOff();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeTimeOff(id) {
    try {
      await api.deleteStaffTimeOff(id);
      loadTimeOff();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div style={{ padding: 16, background: 'var(--surface-alt)', borderRadius: 'var(--radius)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={customHours} onChange={(e) => setCustomHours(e.target.checked)} />
        Custom hours for {staff.name} (unchecked = follow business hours)
      </label>
      {customHours && (
        <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
          {rows.map((r) => (
            <div key={r.dayOfWeek} className="row" style={{ alignItems: 'center' }}>
              <label style={{ width: 100, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={!r.closed} onChange={(e) => updateRow(r.dayOfWeek, { closed: !e.target.checked })} style={{ width: 'auto' }} /> {DAY_NAMES[r.dayOfWeek].slice(0, 3)}
              </label>
              <input type="time" disabled={r.closed} value={r.openTime} onChange={(e) => updateRow(r.dayOfWeek, { openTime: e.target.value })} style={{ width: 110 }} />
              <span className="muted">to</span>
              <input type="time" disabled={r.closed} value={r.closeTime} onChange={(e) => updateRow(r.dayOfWeek, { closeTime: e.target.value })} style={{ width: 110 }} />
            </div>
          ))}
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 6 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={breakEnabled} onChange={(e) => setBreakEnabled(e.target.checked)} />
        Daily break
      </label>
      {breakEnabled && (
        <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
          <input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} style={{ width: 110 }} />
          <span className="muted">to</span>
          <input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} style={{ width: 110 }} />
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        {locations.length > 0 && (
          <div className="field" style={{ maxWidth: 260, marginBottom: 0 }}>
            <label>Location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Unassigned</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <div className="field" style={{ maxWidth: 260, marginBottom: 0 }}>
          <label>Direct line (for transfers)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" />
        </div>
      </div>

      {services.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={customServices} onChange={(e) => setCustomServices(e.target.checked)} />
            Only offers specific services (unchecked = offers everything)
          </label>
          {customServices && (
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {services.map((s) => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input
                    type="checkbox" style={{ width: 'auto' }}
                    checked={serviceIds.includes(s.id)}
                    onChange={(e) => setServiceIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      <button className="primary" onClick={saveSchedule} disabled={saving}>{saving ? 'Saving...' : 'Save schedule'}</button>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time off</label>
        <div className="stack" style={{ gap: 6, marginTop: 8, marginBottom: 10 }}>
          {timeOff?.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>None scheduled.</p>}
          {timeOff?.map((t) => (
            <div key={t.id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13 }}>{DateTime.formatDateTime(t.start_time)} – {DateTime.formatDateTime(t.end_time)}{t.reason ? ` (${t.reason})` : ''}</span>
              <button className="icon-btn" onClick={() => removeTimeOff(t.id)}><Trash2 size={14} color="var(--danger)" /></button>
            </div>
          ))}
        </div>
        <form onSubmit={addTimeOff} className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}><label>Start</label><input type="datetime-local" required value={newStart} onChange={(e) => setNewStart(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>End</label><input type="datetime-local" required value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0, flex: 1 }}><label>Reason (optional)</label><input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Vacation" /></div>
          <button type="submit" className="ghost"><Plus size={14} /> Add</button>
        </form>
      </div>
    </div>
  );
}

function StaffSection() {
  const toast = useToast();
  const [staff, setStaff] = useState([]);
  const [locations, setLocations] = useState([]);
  const [services, setServices] = useState([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.listStaff().then(setStaff).catch((e) => setError(e.message));
  useEffect(() => { load(); api.listLocations().then(setLocations).catch(() => {}); api.listServices().then(setServices).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createStaff({ name });
      setName('');
      toast.success('Staff added');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveEdit(id) {
    setError(null);
    try {
      await api.updateStaff(id, { name: editName });
      setEditingId(null);
      toast.success('Staff updated');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!confirm('Remove this staff member?')) return;
    setError(null);
    try {
      await api.deleteStaff(id);
      toast.success('Staff removed');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to delete');
    }
  }

  return (
    <div className="card">
      <h2>All team members</h2>
      <p className="muted" style={{ marginTop: -8 }}>Leave empty if this business has a single shared calendar — bookings won&apos;t ask for a staff member.</p>
      <table>
        <tbody>
          {staff.map((s) => (
            <Fragment key={s.id}>
              <tr>
                <td>
                  {editingId === s.id
                    ? <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ maxWidth: 220 }} />
                    : (
                      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                        <Avatar name={s.name} size={26} />
                        {s.name}
                      </div>
                    )}
                </td>
                <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  {editingId === s.id ? (
                    <>
                      <button className="primary" onClick={() => saveEdit(s.id)}>Save</button>
                      <button className="icon-btn" onClick={() => setEditingId(null)}><X size={15} /></button>
                    </>
                  ) : (
                    <>
                      <button className="icon-btn" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} title="Schedule"><CalendarClock size={14} /></button>
                      <button className="icon-btn" onClick={() => { setEditingId(s.id); setEditName(s.name); }}><Pencil size={14} /></button>
                      <button className="icon-btn" onClick={() => remove(s.id)}><Trash2 size={14} color="var(--danger)" /></button>
                    </>
                  )}
                </td>
              </tr>
              {expandedId === s.id && (
                <tr>
                  <td colSpan={2}>
                    <StaffScheduleEditor staff={s} locations={locations} services={services} onChanged={load} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {staff.length === 0 && <tr><td colSpan={2} className="muted">No team members yet — add one below.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={add} className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
        <div className="field" style={{ flex: 1 }}><label>Name</label><input required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button type="submit" className="primary">Add</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// Matches src/permissions.js's AREAS — the fixed set a custom role picks from.
const AREAS = ['bookings', 'customers', 'calls', 'services', 'team', 'settings', 'exceptions'];

function TeamMembersSection() {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('receptionist');
  const [permissions, setPermissions] = useState([]);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.listTeamMembers().then(setMembers).catch((e) => setError(e.message));
  useEffect(() => { load(); api.getMe().then(setMe).catch(() => {}); }, []);

  const isOwner = me?.role === 'owner';

  async function invite(e) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      await api.inviteTeamMember({ name, email, role, permissions: role === 'custom' ? permissions : undefined });
      setName(''); setEmail(''); setRole('receptionist'); setPermissions([]);
      toast.success(`Invited ${email}`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  }

  async function setStatus(id, status) {
    if (status === 'suspended' && !confirm('Suspend this team member? They will immediately lose access.')) return;
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
      <h2>Team members &amp; access</h2>
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
                <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  {m.role !== 'owner' && (m.status === 'suspended'
                    ? <button className="icon-btn" onClick={() => setStatus(m.id, 'active')} title="Reactivate"><Mail size={14} /></button>
                    : <button className="icon-btn" onClick={() => setStatus(m.id, 'suspended')} title="Suspend"><UserX size={14} color="var(--danger)" /></button>)}
                </td>
              )}
            </tr>
          ))}
          {members.length === 0 && <tr><td colSpan={isOwner ? 5 : 4} className="muted">Loading...</td></tr>}
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
                  {a}
                </label>
              ))}
            </div>
          )}
        </form>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function TeamInner() {
  return (
    <div className="stack">
      <div>
        <h1>Team</h1>
        <p className="muted" style={{ marginTop: 4 }}>Staff members bookings can be assigned to, and who has access to this dashboard.</p>
      </div>
      <StaffSection />
      <TeamMembersSection />
    </div>
  );
}

export default function TeamPage() {
  return (
    <RequireAuth area="team">
      <TeamInner />
    </RequireAuth>
  );
}
