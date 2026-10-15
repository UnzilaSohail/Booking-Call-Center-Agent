'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import Loading from '../Skeleton';
import InfoTip from '../InfoTip';

const EMPTY_KNOWLEDGE_FORM = {
  greeting: '', faqs: [{ question: '', answer: '' }], bookingPolicy: '', cancellationPolicy: '',
  preparationInstructions: '', restrictedTopics: '', emergencyRules: '', pronunciation: [{ term: '', pronunciation: '' }],
};

function toForm(k) {
  return {
    greeting: k.greeting ?? '',
    faqs: k.faqs?.length ? k.faqs : [{ question: '', answer: '' }],
    bookingPolicy: k.booking_policy ?? '',
    cancellationPolicy: k.cancellation_policy ?? '',
    preparationInstructions: k.preparation_instructions ?? '',
    restrictedTopics: k.restricted_topics ?? '',
    emergencyRules: k.emergency_rules ?? '',
    pronunciation: k.pronunciation?.length ? k.pronunciation : [{ term: '', pronunciation: '' }],
  };
}

// Knowledge base: everything the voice agent's system prompt is built from
// (src/voice/geminiSession.js), edited here as a draft and only reaching live calls once
// published — see src/routes/knowledge.js for the draft/publish/rollback model.
export default function KnowledgeBaseSection() {
  const toast = useToast();
  const [status, setStatus] = useState(null); // { publishedAt, hasUnpublishedChanges }
  const [form, setForm] = useState(EMPTY_KNOWLEDGE_FORM);
  const [versions, setVersions] = useState(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.getKnowledge().then((k) => {
      setForm(toForm(k.draft));
      setStatus({ publishedAt: k.publishedAt, hasUnpublishedChanges: k.hasUnpublishedChanges });
    }).catch((e) => setError(e.message));
    api.getKnowledgeVersions().then(setVersions).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function updateRow(field, i, patch) {
    setForm((prev) => ({ ...prev, [field]: prev[field].map((row, idx) => (idx === i ? { ...row, ...patch } : row)) }));
  }
  function addRow(field, empty) {
    setForm((prev) => ({ ...prev, [field]: [...prev[field], empty] }));
  }
  function removeRow(field, i) {
    setForm((prev) => ({ ...prev, [field]: prev[field].filter((_, idx) => idx !== i) }));
  }

  async function saveDraft() {
    setSaving(true);
    setError(null);
    try {
      await api.saveKnowledgeDraft({
        ...form,
        faqs: form.faqs.filter((f) => f.question.trim() && f.answer.trim()),
        pronunciation: form.pronunciation.filter((p) => p.term.trim() && p.pronunciation.trim()),
      });
      toast.success('Draft saved');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      await api.publishKnowledge();
      toast.success('Knowledge base published — live calls now use it');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function rollback(version) {
    try {
      await api.rollbackKnowledge(version);
      toast.success(`Rolled back to version ${version}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!status) return <div className="card">{error ? <p className="error-text">{error}</p> : <Loading />}</div>;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>What your AI should know <InfoTip term="knowledge" /></h2>
        {status.hasUnpublishedChanges && <span className="badge warning">Unpublished changes</span>}
      </div>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
        Everything the voice agent knows and follows on calls. Edits here are a draft —
        callers keep getting the last <strong>published</strong> version until you publish.
        {status.publishedAt && <> Last published {new Date(status.publishedAt).toLocaleString()}.</>}
      </p>

      <div className="field">
        <label>Greeting</label>
        <input value={form.greeting} onChange={(e) => setForm({ ...form, greeting: e.target.value })} placeholder="Thanks for calling Bright Smiles Dental!" />
      </div>

      <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Common questions (Q&amp;A)</label>
      <div className="stack" style={{ gap: 8, marginTop: 6, marginBottom: 10 }}>
        {form.faqs.map((f, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input aria-label={`Question ${i + 1}`} value={f.question} onChange={(e) => updateRow('faqs', i, { question: e.target.value })} placeholder="Do you take walk-ins?" />
            </div>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <input aria-label={`Answer ${i + 1}`} value={f.answer} onChange={(e) => updateRow('faqs', i, { answer: e.target.value })} placeholder="Yes, subject to availability." />
            </div>
            <button className="icon-btn" onClick={() => removeRow('faqs', i)} disabled={form.faqs.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
        <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addRow('faqs', { question: '', answer: '' })}><Plus size={14} /> Add another question</button>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Booking policy</label>
          <textarea rows={2} value={form.bookingPolicy} onChange={(e) => setForm({ ...form, bookingPolicy: e.target.value })} placeholder="e.g. A card is required to hold same-day bookings." />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Cancellation policy</label>
          <textarea rows={2} value={form.cancellationPolicy} onChange={(e) => setForm({ ...form, cancellationPolicy: e.target.value })} placeholder="e.g. Cancel at least 24 hours ahead to avoid a fee." />
        </div>
      </div>
      <div className="field">
        <label>Preparation instructions</label>
        <textarea rows={2} value={form.preparationInstructions} onChange={(e) => setForm({ ...form, preparationInstructions: e.target.value })} placeholder="e.g. Please arrive 10 minutes early with photo ID." />
      </div>
      <div className="field">
        <label>Restricted topics</label>
        <textarea rows={2} value={form.restrictedTopics} onChange={(e) => setForm({ ...form, restrictedTopics: e.target.value })} placeholder="e.g. Medical diagnoses, legal advice, pricing negotiation." />
      </div>
      <div className="field">
        <label>Emergency rules</label>
        <textarea rows={2} value={form.emergencyRules} onChange={(e) => setForm({ ...form, emergencyRules: e.target.value })} placeholder="e.g. If a caller describes severe pain or bleeding, tell them to call 911 or go to the ER, then flag the call." />
      </div>

      <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pronunciation dictionary</label>
      <div className="stack" style={{ gap: 8, marginTop: 6, marginBottom: 10 }}>
        {form.pronunciation.map((p, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input aria-label={`Word ${i + 1}`} value={p.term} onChange={(e) => updateRow('pronunciation', i, { term: e.target.value })} placeholder="Xero" />
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <input aria-label={`How to say word ${i + 1}`} value={p.pronunciation} onChange={(e) => updateRow('pronunciation', i, { pronunciation: e.target.value })} placeholder="ZEER-oh" />
            </div>
            <button className="icon-btn" onClick={() => removeRow('pronunciation', i)} disabled={form.pronunciation.length === 1}>
              <Trash2 size={15} color="var(--danger)" />
            </button>
          </div>
        ))}
        <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => addRow('pronunciation', { term: '', pronunciation: '' })}><Plus size={14} /> Add another term</button>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="row" style={{ marginTop: 4 }}>
        <button className="ghost" onClick={saveDraft} disabled={saving}>{saving ? 'Saving...' : 'Save draft'}</button>
        <button className="primary" onClick={publish} disabled={publishing}>{publishing ? 'Publishing...' : 'Publish'}</button>
      </div>

      {versions?.length > 0 && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <label style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Version history</label>
          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
            {versions.map((v) => (
              <div key={v.version} className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>
                  v{v.version} — {new Date(v.publishedAt).toLocaleString()}
                  {v.publishedByName && <span className="muted"> by {v.publishedByName}</span>}
                  {v.rolledBackFrom != null && <span className="badge neutral" style={{ marginLeft: 8 }}>rollback of v{v.rolledBackFrom}</span>}
                </span>
                <button className="ghost" onClick={() => rollback(v.version)}>Roll back to this version</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
