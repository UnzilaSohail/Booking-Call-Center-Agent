'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import Loading from '../Skeleton';
import InfoTip from '../InfoTip';

// Department-based transfer routing (ROADMAP.md §5) — src/voice/tools.js's
// resolveTransferTarget matches a department the caller names before falling back to
// staff/location/business-wide numbers.
export default function TransferDepartmentsSection() {
  const toast = useToast();
  const [departments, setDepartments] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getTransferDepartments().then((d) => setDepartments(d.length ? d : [{ name: '', phoneNumber: '' }])).catch((e) => setError(e.message)); }, []);

  function update(i, patch) {
    setDepartments((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const cleaned = await api.putTransferDepartments(departments.filter((d) => d.name && d.phoneNumber));
      setDepartments(cleaned.length ? cleaned : [{ name: '', phoneNumber: '' }]);
      toast.success('Departments saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!departments) return <div className="card">{error ? <p className="error-text">{error}</p> : <Loading />}</div>;

  return (
    <div className="card">
      <h2>Call transfer: who answers what <InfoTip term="departments" /></h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Named phone lines the AI can transfer to when a caller asks for one by name (e.g. "billing").
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {departments.map((d, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Department</label>}
              <input value={d.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Billing" />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label>Phone number</label>}
              <input value={d.phoneNumber} onChange={(e) => update(i, { phoneNumber: e.target.value })} placeholder="+15551234567" />
            </div>
            <button className="icon-btn" onClick={() => setDepartments((prev) => prev.filter((_, idx) => idx !== i))} disabled={departments.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => setDepartments((prev) => [...prev, { name: '', phoneNumber: '' }])}><Plus size={14} /> Add another department</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save departments'}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
