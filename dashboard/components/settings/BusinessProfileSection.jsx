'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { useTimezones } from '../../lib/timezones';
import Loading from '../Skeleton';
import InfoTip from '../InfoTip';

const INDUSTRIES = ['Salon / Spa', 'Medical / Dental', 'Fitness', 'Home Services', 'Restaurant', 'Professional Services', 'Other'];

// Lets the owner see what the monthly email looks like right now (this month so far, sent to their own address only).
function SampleReportButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { const r = await api.sendSampleReport(); toast.success(`Sample report sent to ${r.sentTo}`); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  return <button type="button" className="ghost" onClick={send} disabled={busy}>{busy ? 'Sending...' : 'Email me a sample report now'}</button>;
}

export default function BusinessProfileSection() {
  const toast = useToast();
  const TIMEZONES = useTimezones();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getBusiness().then(setForm).catch((e) => setError(e.message)); }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateBusiness({
        name: form.name, industry: form.industry, timezone: form.timezone, rescheduleCutoffMinutes: Number(form.rescheduleCutoffMinutes),
        contactEmail: form.contactEmail, contactPhone: form.contactPhone, address: form.address,
        minBookingNoticeMinutes: Number(form.minBookingNoticeMinutes) || 0,
        maxBookingWindowDays: form.maxBookingWindowDays === '' ? null : Number(form.maxBookingWindowDays),
        transferPhoneNumber: form.transferPhoneNumber,
        recordingEnabled: form.recordingEnabled,
        recordingRetentionDays: form.recordingRetentionDays === '' ? null : Number(form.recordingRetentionDays),
        reviewLink: form.reviewLink ?? '',
        monthlyReportEnabled: form.monthlyReportEnabled !== false,
        phoneVerification: form.phoneVerification === true,
      });
      toast.success('Business profile saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <div className="card">{error ? <p className="error-text">{error}</p> : <Loading />}</div>;

  return (
    <div className="card">
      <h2>Business profile</h2>
      <form onSubmit={save}>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Business name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Timezone</label>
            <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Industry</label>
            <select value={form.industry ?? ''} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
              <option value="">Not set</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Your business phone number</label>
            <input value={form.phoneNumber ?? 'No number yet'} disabled />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Last time to change an appointment (minutes before) <InfoTip term="cutoff" /></label>
            <input type="number" min={0} value={form.rescheduleCutoffMinutes} onChange={(e) => setForm({ ...form, rescheduleCutoffMinutes: e.target.value })} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
          How close to the appointment a customer can still reschedule or cancel on their own. Staff can always change it from the dashboard.
        </p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Soonest a customer can book (minutes from now) <InfoTip term="minNotice" /></label>
            <input type="number" min={0} value={form.minBookingNoticeMinutes} onChange={(e) => setForm({ ...form, minBookingNoticeMinutes: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>How far ahead customers can book (days, blank = no limit) <InfoTip term="bookingWindow" /></label>
            <input type="number" min={1} value={form.maxBookingWindowDays ?? ''} onChange={(e) => setForm({ ...form, maxBookingWindowDays: e.target.value })} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
          How soon a new booking can start from now, and how far out it can be made — applies to both call and dashboard bookings.
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Contact email</label>
            <input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Contact phone</label>
            <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="General/support number, not the booking line" />
          </div>
        </div>
        <div className="field">
          <label>Address</label>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="field">
          <label>Where to send calls the AI can't handle <InfoTip term="transferNumber" /></label>
          <input value={form.transferPhoneNumber} onChange={(e) => setForm({ ...form, transferPhoneNumber: e.target.value })} placeholder="Where calls go when the AI hands off, if no department/staff/location number applies" />
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.recordingEnabled} onChange={(e) => setForm({ ...form, recordingEnabled: e.target.checked })} />
            Record calls
          </label>
          <div className="field" style={{ flex: 1 }}>
            <label>Delete recordings and transcripts after (days, blank = keep) <InfoTip term="retention" /></label>
            <input type="number" min={1} value={form.recordingRetentionDays ?? ''} onChange={(e) => setForm({ ...form, recordingRetentionDays: e.target.value })} />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 14 }}>
          Callers are always told a call may be recorded. After the number of days above, the recording and transcript are erased automatically. The record of the call itself (when, how long, how it ended) is kept.
        </p>
        <div className="field">
          <label htmlFor="review-link">Google review link <InfoTip term="reviewLink" /></label>
          <input id="review-link" type="url" value={form.reviewLink ?? ''} onChange={(e) => setForm({ ...form, reviewLink: e.target.value })} placeholder="https://g.page/r/..." />
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>After each visit we text the customer once, about 2 hours later, asking for a review. Leave blank to switch this off. Find your link on Google: search your business, then Share, then Ask for reviews.</p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.phoneVerification === true} onChange={(e) => setForm({ ...form, phoneVerification: e.target.checked })} />
          Text customers a code to confirm their phone number before an online booking (stops fake bookings; costs one text per booking. Turn on only after a real text reaches your phone)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.monthlyReportEnabled !== false} onChange={(e) => setForm({ ...form, monthlyReportEnabled: e.target.checked })} />
          Email me a report at the start of each month (calls, bookings, money, no-shows)
        </label>
        <p style={{ margin: '0 0 14px' }}><SampleReportButton /></p>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button>
      </form>
    </div>
  );
}
