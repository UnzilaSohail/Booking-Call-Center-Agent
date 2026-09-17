'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, storeTokenForRole } from '../../lib/api';
import { useTimezones } from '../../lib/timezones';

const INDUSTRIES = ['Salon / Spa', 'Medical / Dental', 'Fitness', 'Home Services', 'Restaurant', 'Professional Services', 'Other'];

const STEP_LABELS = ['Business', 'Location', 'Owner account', 'Review'];

export default function SignupPage() {
  const router = useRouter();
  const TIMEZONES = useTimezones();
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [timezone, setTimezone] = useState('UTC');

  const [locationName, setLocationName] = useState('');
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [termsAccepted, setTermsAccepted] = useState(false);

  function next(e) {
    e.preventDefault();
    setError(null);
    if (step === 2 && ownerPassword !== confirmPassword) {
      setError('passwords do not match');
      return;
    }
    setStep((s) => s + 1);
  }
  function back() {
    setError(null);
    setStep((s) => s - 1);
  }

  async function submit(e) {
    e.preventDefault();
    if (!termsAccepted) {
      setError('you must accept the terms and privacy policy');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { token } = await api.signup({
        businessName, industry, timezone,
        locationName: locationName || undefined, address: address || undefined, contactPhone: contactPhone || undefined,
        ownerName: ownerName || undefined, ownerEmail, ownerPhone, ownerPassword, termsAccepted,
      });
      storeTokenForRole('business', token);
      router.push('/onboarding');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px 0' }}>
      <div className="card" style={{ width: 440 }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600 }}>Create your account</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            Step {step + 1} of {STEP_LABELS.length} — {STEP_LABELS[step]}
          </div>
        </div>

        <form onSubmit={step < 3 ? next : submit}>
          {step === 0 && (
            <>
              <div className="field">
                <label>Business name</label>
                <input required value={businessName} onChange={(e) => setBusinessName(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>Industry</label>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="field">
                <label>Location name (optional)</label>
                <input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder={businessName || 'e.g. Downtown branch'} />
              </div>
              <div className="field">
                <label>Address (optional)</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="field">
                <label>Contact phone (optional)</label>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="General/support number" />
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>You can add more locations later from Settings.</p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="field">
                <label>Your name (optional)</label>
                <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" required value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
              </div>
              <div className="field">
                <label>Phone</label>
                <input type="tel" required value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+15551234567" />
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Password</label>
                  <input type="password" required minLength={8} value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Confirm password</label>
                  <input type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
                We&apos;ll text and email you a code to verify these on the next step.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <div className="stack" style={{ gap: 6, marginBottom: 14, fontSize: 13.5 }}>
                <div><strong>{businessName}</strong> — {industry}, {timezone}</div>
                {(locationName || address) && <div className="muted">{locationName || businessName}{address ? ` — ${address}` : ''}</div>}
                <div className="muted">{ownerName ? `${ownerName} · ` : ''}{ownerEmail} · {ownerPhone}</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 16 }}>
                <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
                <span>I agree to the Terms of Service and Privacy Policy.</span>
              </label>
            </>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className="row" style={{ marginTop: 8 }}>
            {step > 0 && <button type="button" className="ghost" onClick={back}>Back</button>}
            {step < 3 ? (
              <button type="submit" className="primary">Continue</button>
            ) : (
              <button type="submit" className="primary" disabled={submitting}>{submitting ? 'Creating account...' : 'Create account'}</button>
            )}
          </div>
        </form>

        <p className="muted" style={{ marginTop: 16, fontSize: 12.5 }}>
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
