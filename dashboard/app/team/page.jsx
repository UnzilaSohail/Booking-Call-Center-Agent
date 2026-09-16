'use client';
import { useEffect, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import Avatar from '../../components/Avatar';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/Toast';

function StaffSection() {
  const toast = useToast();
  const [staff, setStaff] = useState([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState(null);

  const load = () => api.listStaff().then(setStaff).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            <tr key={s.id}>
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
                    <button className="icon-btn" onClick={() => { setEditingId(s.id); setEditName(s.name); }}><Pencil size={14} /></button>
                    <button className="icon-btn" onClick={() => remove(s.id)}><Trash2 size={14} color="var(--danger)" /></button>
                  </>
                )}
              </td>
            </tr>
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

function TeamInner() {
  return (
    <div className="stack">
      <div>
        <h1>Team</h1>
        <p className="muted" style={{ marginTop: 4 }}>Staff members bookings can be assigned to.</p>
      </div>
      <StaffSection />
    </div>
  );
}

export default function TeamPage() {
  return (
    <RequireAuth>
      <TeamInner />
    </RequireAuth>
  );
}
