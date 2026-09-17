'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';

const VOICE_OPTIONS = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];

const STEP_META = {
  verify_contact: { label: 'Verify email & phone', hint: 'Confirm you own the email and phone number on this account.' },
  services: { label: 'Add your services', hint: 'What customers can book.', href: '/services' },
  staff: { label: 'Add staff', hint: 'Skip this if you’re a single-resource business.', href: '/team' },
  calendar: { label: 'Connect Google Calendar', hint: 'Bookings still work without it — this just mirrors them for humans to view.', href: '/settings' },
  phone_number: { label: 'Get a phone number', hint: 'The number customers call to book.', href: '/settings' },
  knowledge_base: { label: 'Add common questions', hint: 'Parking, walk-ins, policies — anything the AI should answer directly.', href: '/settings' },
  ai_voice: { label: 'Choose an AI voice', hint: 'How the booking agent sounds on the phone.' },
  test_call: { label: 'Make a test call', hint: 'Hear the agent for yourself before real customers do.' },
  go_live: { label: 'Go live', hint: 'Start taking real bookings.' },
};

function StepBadge({ done, skippable }) {
  if (done) return <span className="badge success">Done</span>;
  if (skippable) return <span className="badge neutral">Optional</span>;
  return <span className="badge warning">Required</span>;
}

function VerifyContactStep({ status, onChanged }) {
  const toast = useToast();
  const [pending, setPending] = useState({ email: false, phone: false });
  const [codeInput, setCodeInput] = useState({ email: '', phone: '' });
  const [error, setError] = useState(null);

  async function send(channel) {
    setError(null);
    try {
      await api.sendVerificationCode(channel);
      setPending((p) => ({ ...p, [channel]: true }));
      toast.success(`Code sent to your ${channel}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirm(channel) {
    setError(null);
    try {
      await api.confirmVerificationCode(channel, codeInput[channel]);
      toast.success(`${channel === 'email' ? 'Email' : 'Phone'} verified`);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {['email', 'phone'].map((channel) => (
        <div key={channel} className="row" style={{ alignItems: 'center' }}>
          <span style={{ width: 60, fontSize: 13, textTransform: 'capitalize' }}>{channel}</span>
          {!pending[channel] ? (
            <button type="button" className="ghost" onClick={() => send(channel)}>Send code</button>
          ) : (
            <>
              <input style={{ width: 100 }} placeholder="123456" value={codeInput[channel]} onChange={(e) => setCodeInput((c) => ({ ...c, [channel]: e.target.value }))} />
              <button type="button" className="primary" onClick={() => confirm(channel)}>Confirm</button>
              <button type="button" className="ghost" onClick={() => send(channel)}>Resend</button>
            </>
          )}
        </div>
      ))}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function VoiceStep({ status, onChanged }) {
  const toast = useToast();
  const [voice, setVoice] = useState(VOICE_OPTIONS[2]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.setVoice(voice);
      toast.success('AI voice saved');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ width: 160 }}>
        {VOICE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <button type="button" className="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function TestCallStep({ onChanged }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState(null);

  async function call() {
    setCalling(true);
    setError(null);
    try {
      await api.triggerTestCall(phone);
      toast.success('Calling you now...');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <input type="tel" placeholder="+15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: 160 }} />
      <button type="button" className="primary" onClick={call} disabled={calling || !phone}>{calling ? 'Calling...' : 'Call me now'}</button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function GoLiveStep({ status, onChanged }) {
  const toast = useToast();
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function goLive() {
    setSaving(true);
    setError(null);
    try {
      await api.goLive();
      toast.success('You’re live!');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="primary" onClick={goLive} disabled={saving || !status.readyForGoLive}>
        {saving ? 'Going live...' : 'Go live'}
      </button>
      {!status.readyForGoLive && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Finish the required steps above first.</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function OnboardingContent() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.getOnboardingStatus().then(setStatus).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  if (!status) return <div className="card">{error ? <p className="error-text">{error}</p> : <p className="muted">Loading...</p>}</div>;

  const live = status.steps.find((s) => s.key === 'go_live')?.done;

  return (
    <div className="stack">
      <div>
        <h1>Guided onboarding</h1>
        <p className="muted">{live ? 'You’re live — revisit any step below anytime.' : 'Work through these steps to start taking real calls.'}</p>
      </div>
      {status.steps.map((step) => {
        const meta = STEP_META[step.key];
        return (
          <div key={step.key} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ margin: 0 }}>{meta.label}</h2>
              <StepBadge done={step.done} skippable={step.skippable} />
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: -4, marginBottom: 12 }}>{meta.hint}</p>
            {meta.href && <Link href={meta.href} className="ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' }}>Go to {meta.label}</Link>}
            {step.key === 'verify_contact' && <VerifyContactStep status={status} onChanged={load} />}
            {step.key === 'ai_voice' && <VoiceStep status={status} onChanged={load} />}
            {step.key === 'test_call' && <TestCallStep onChanged={load} />}
            {step.key === 'go_live' && <GoLiveStep status={status} onChanged={load} />}
          </div>
        );
      })}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <OnboardingContent />
    </RequireAuth>
  );
}
