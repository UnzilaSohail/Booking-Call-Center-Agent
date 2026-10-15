'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function BusinessHoursSection() {
  const toast = useToast();
  const [rows, setRows] = useState(DAY_NAMES.map((_, day) => ({ dayOfWeek: day, closed: true, openTime: '09:00', closeTime: '17:00' })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getBusinessHours().then((hours) => {
      setRows((prev) => prev.map((row) => {
        const match = hours.find((h) => h.day_of_week === row.dayOfWeek);
        return match ? { ...row, closed: false, openTime: match.open_time.slice(0, 5), closeTime: match.close_time.slice(0, 5) } : row;
      }));
    }).catch((e) => setError(e.message));
  }, []);

  function updateRow(day, patch) {
    setRows((prev) => prev.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const hours = rows.filter((r) => !r.closed).map((r) => ({ dayOfWeek: r.dayOfWeek, openTime: r.openTime, closeTime: r.closeTime }));
      await api.putBusinessHours(hours);
      toast.success('Business hours saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Business hours</h2>
      {rows.map((r) => (
        <div key={r.dayOfWeek} className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
          <label style={{ width: 110, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={!r.closed} onChange={(e) => updateRow(r.dayOfWeek, { closed: !e.target.checked })} style={{ width: 'auto' }} /> {DAY_NAMES[r.dayOfWeek]}
          </label>
          <input type="time" aria-label={`${DAY_NAMES[r.dayOfWeek]} opens`} disabled={r.closed} value={r.openTime} onChange={(e) => updateRow(r.dayOfWeek, { openTime: e.target.value })} style={{ width: 120 }} />
          <span className="muted">to</span>
          <input type="time" aria-label={`${DAY_NAMES[r.dayOfWeek]} closes`} disabled={r.closed} value={r.closeTime} onChange={(e) => updateRow(r.dayOfWeek, { closeTime: e.target.value })} style={{ width: 120 }} />
        </div>
      ))}
      <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save hours'}</button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
