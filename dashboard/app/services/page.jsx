'use client';
import { useEffect, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/Toast';

function ServicesSection() {
  const toast = useToast();
  const [services, setServices] = useState([]);
  const [form, setForm] = useState({ name: '', durationMinutes: 30, bufferMinutes: 0, price: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.listServices().then(setServices).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createService({ ...form, durationMinutes: Number(form.durationMinutes), bufferMinutes: Number(form.bufferMinutes) || 0, price: form.price ? Number(form.price) : undefined });
      setForm({ name: '', durationMinutes: 30, bufferMinutes: 0, price: '' });
      toast.success('Service added');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditForm({ name: s.name, durationMinutes: s.duration_minutes, bufferMinutes: s.buffer_minutes, price: s.price ?? '' });
  }

  async function saveEdit(id) {
    setError(null);
    try {
      await api.updateService(id, { name: editForm.name, durationMinutes: Number(editForm.durationMinutes), bufferMinutes: Number(editForm.bufferMinutes), price: editForm.price === '' ? null : Number(editForm.price) });
      setEditingId(null);
      toast.success('Service updated');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this service?')) return;
    setError(null);
    try {
      await api.deleteService(id);
      toast.success('Service deleted');
      load();
    } catch (err) {
      // ApiError from a 409 (future bookings still on it) — surfaced as-is, it's already clear.
      setError(err instanceof ApiError ? err.message : 'failed to delete');
    }
  }

  return (
    <div className="card">
      <h2>All services</h2>
      <table>
        <thead><tr><th>Name</th><th>Duration</th><th>Buffer</th><th>Price</th><th></th></tr></thead>
        <tbody>
          {services.map((s) => editingId === s.id ? (
            <tr key={s.id}>
              <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
              <td><input type="number" min={1} style={{ width: 80 }} value={editForm.durationMinutes} onChange={(e) => setEditForm({ ...editForm, durationMinutes: e.target.value })} /></td>
              <td><input type="number" min={0} style={{ width: 80 }} value={editForm.bufferMinutes} onChange={(e) => setEditForm({ ...editForm, bufferMinutes: e.target.value })} /></td>
              <td><input type="number" min={0} step="0.01" style={{ width: 90 }} value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} /></td>
              <td className="row" style={{ gap: 4 }}>
                <button className="primary" onClick={() => saveEdit(s.id)}>Save</button>
                <button className="icon-btn" onClick={() => setEditingId(null)}><X size={15} /></button>
              </td>
            </tr>
          ) : (
            <tr key={s.id}>
              <td>{s.name}</td><td>{s.duration_minutes} min</td><td>{s.buffer_minutes} min</td><td>{s.price ?? '—'}</td>
              <td className="row" style={{ gap: 4 }}>
                <button className="icon-btn" onClick={() => startEdit(s)}><Pencil size={14} /></button>
                <button className="icon-btn" onClick={() => remove(s.id)}><Trash2 size={14} color="var(--danger)" /></button>
              </td>
            </tr>
          ))}
          {services.length === 0 && <tr><td colSpan={5} className="muted">No services yet — add one below.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={add} className="row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 2 }}><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>Duration (min)</label><input type="number" min={1} required value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} /></div>
        <div className="field"><label>Buffer (min)</label><input type="number" min={0} value={form.bufferMinutes} onChange={(e) => setForm({ ...form, bufferMinutes: e.target.value })} /></div>
        <div className="field"><label>Price</label><input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        <button type="submit" className="primary">Add</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function ServicesInner() {
  return (
    <div className="stack">
      <div>
        <h1>Services</h1>
        <p className="muted" style={{ marginTop: 4 }}>What customers and the voice agent can book — durations, buffers, and pricing.</p>
      </div>
      <ServicesSection />
    </div>
  );
}

export default function ServicesPage() {
  return (
    <RequireAuth area="services">
      <ServicesInner />
    </RequireAuth>
  );
}
