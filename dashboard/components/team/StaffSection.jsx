'use client';
import { Fragment, useEffect, useState } from 'react';
import { CalendarClock, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import Avatar from '../Avatar';
import { ApiError, api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { DateTime } from '../../lib/datetime';
import { useConfirm } from '../../lib/confirm';
import EmptyState from '../EmptyState';
import LoadError from '../LoadError';
import { useApi } from '../../lib/useApi';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function emptyWeek() {
  return DAY_NAMES.map((_, day) => ({ dayOfWeek: day, closed: true, openTime: '09:00', closeTime: '17:00' }));
}

// Expandable per-staff schedule: hours (defaults to "follow business hours" unless
// overridden), an optional daily break, a location assignment, and time off — same
// row-expand pattern the Calls page uses for call details.
function StaffScheduleEditor({ staff, locations, services, onChanged }) {
  const confirm = useConfirm();
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
  useEffect(loadTimeOff, [staff.id]);  

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
    const payload = { startTime: new Date(newStart).toISOString(), endTime: new Date(newEnd).toISOString(), reason: newReason || undefined };
    try {
      try {
        await api.createStaffTimeOff(staff.id, payload);
      } catch (err) {
        // 409 = customers already booked in that window. Show who, and only add it if confirmed.
        if (!(err instanceof ApiError && err.status === 409) || !(await confirm({ title: 'Customers are already booked', message: `${err.message}\n\nAdd the time off anyway? Those customers will still be booked and need a call.`, confirmLabel: 'Add anyway' }))) throw err;
        await api.createStaffTimeOff(staff.id, { ...payload, force: true });
      }
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
              <input type="time" aria-label={`${DAY_NAMES[r.dayOfWeek]} starts`} disabled={r.closed} value={r.openTime} onChange={(e) => updateRow(r.dayOfWeek, { openTime: e.target.value })} style={{ width: 110 }} />
              <span className="muted">to</span>
              <input type="time" aria-label={`${DAY_NAMES[r.dayOfWeek]} ends`} disabled={r.closed} value={r.closeTime} onChange={(e) => updateRow(r.dayOfWeek, { closeTime: e.target.value })} style={{ width: 110 }} />
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
          <input type="time" aria-label="Break starts" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} style={{ width: 110 }} />
          <span className="muted">to</span>
          <input type="time" aria-label="Break ends" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} style={{ width: 110 }} />
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

export default function StaffSection() {
  const confirm = useConfirm();
  const toast = useToast();
  const [locations, setLocations] = useState([]);
  const [services, setServices] = useState([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState(null);

  const { data: staff, error: loadError, reload: load } = useApi(() => api.listStaff(), [], []);
  useEffect(() => { api.listLocations().then(setLocations).catch(() => {}); api.listServices().then(setServices).catch(() => {}); }, []);  

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
    if (!(await confirm({ title: 'Remove this staff member?', message: 'They disappear from the calendar and the booking page. This cannot be undone.', confirmLabel: 'Remove', danger: true }))) return;
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
      <h2>People customers can book</h2>
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
          {staff.length === 0 && loadError && <tr><td colSpan={2}><LoadError error={loadError} onRetry={load} /></td></tr>}
          {staff.length === 0 && !loadError && <tr><td colSpan={2}><EmptyState icon={Users} action={{ label: 'Add your first team member', onClick: () => document.getElementById('staff-name')?.focus() }}>No team members yet. Add the people customers can book with.</EmptyState></td></tr>}
        </tbody>
      </table>
      <form onSubmit={add} className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
        <div className="field" style={{ flex: 1 }}><label>Name</label><input id="staff-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button type="submit" className="primary">Add</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
