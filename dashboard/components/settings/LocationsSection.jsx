'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import Loading from '../Skeleton';

export default function LocationsSection() {
  const toast = useToast();
  const [locations, setLocations] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', contactPhone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.listLocations().then(setLocations).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function add(e) {
    e.preventDefault();
    if (!form.name) return;
    setSaving(true);
    setError(null);
    try {
      await api.createLocation(form);
      setForm({ name: '', address: '', contactPhone: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      await api.deleteLocation(id);
      toast.success('Location removed');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!locations) return <div className="card">{error ? <p className="error-text">{error}</p> : <Loading />}</div>;

  return (
    <div className="card">
      <h2>Locations</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Additional addresses this business operates from. Booking/calls stay routed through the one phone number above.
      </p>
      <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
        {locations.map((loc) => (
          <div key={loc.id} className="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <strong>{loc.name}</strong>{loc.is_primary && <span className="badge neutral" style={{ marginLeft: 6 }}>Primary</span>}
              {loc.address && <div className="muted" style={{ fontSize: 12.5 }}>{loc.address}</div>}
            </div>
            <button className="icon-btn" onClick={() => remove(loc.id)}><Trash2 size={15} color="var(--danger)" /></button>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Downtown branch" />
        </div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Address</label>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label>Contact phone</label>
          <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
        </div>
        <button type="submit" className="primary" disabled={saving}><Plus size={14} /> Add</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
