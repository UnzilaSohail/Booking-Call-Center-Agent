'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import Loading from '../Skeleton';
import LoadError from '../LoadError';
import { useApi } from '../../lib/useApi';

export default function HolidaysSection() {
  const toast = useToast();
  const [holidays, setHolidays] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const { data: loaded, error: loadError, reload } = useApi(() => api.getHolidays(), []);
  // The editable copy: a fresh load replaces it.
  useEffect(() => { if (loaded) setHolidays(loaded.length ? loaded : [{ date: '', name: '' }]); }, [loaded]);

  function update(i, patch) {
    setHolidays((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const cleaned = await api.putHolidays(holidays.filter((h) => h.date));
      setHolidays(cleaned.length ? cleaned : [{ date: '', name: '' }]);
      toast.success('Holidays saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!holidays) return <div className="card">{loadError ? <LoadError error={loadError} onRetry={reload} /> : <Loading />}</div>;

  return (
    <div className="card">
      <h2>Holidays</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Full closures on specific dates — no slots are offered on these days, regardless of the usual weekly hours.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {holidays.map((h, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              {i === 0 && <label>Date</label>}
              <input type="date" value={h.date} onChange={(e) => update(i, { date: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Name (optional)</label>}
              <input value={h.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} placeholder="Christmas" />
            </div>
            <button className="icon-btn" onClick={() => setHolidays((prev) => prev.filter((_, idx) => idx !== i))} disabled={holidays.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => setHolidays((prev) => [...prev, { date: '', name: '' }])}><Plus size={14} /> Add another date</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save holidays'}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
