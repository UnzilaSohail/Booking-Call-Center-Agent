'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { copyText } from '../../lib/clipboard';
import Loading from '../Skeleton';
import InfoTip from '../InfoTip';

const CATEGORIES = ['hair-salon', 'barber', 'nail-salon', 'spa-massage', 'dentist', 'doctor', 'physiotherapy', 'fitness', 'home-services', 'restaurant', 'professional-services', 'other'];
const catLabel = (c) => c.replace(/-/g, ' ').replace(/^./, (x) => x.toUpperCase());

// Customer-facing booking link + opt-in directory listing (docs/customer/DISCOVERY_AND_LISTING.md).
export default function BookingPageSection() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function load() { api.getListing().then(setForm).catch((e) => setError(e.message)); }
  useEffect(load, []);

  if (!form) return <div className="card">{error ? <p className="error-text">{error}</p> : <Loading />}</div>;

  const link = `${window.location.origin}/book/${form.slug}`;
  const set = (patch) => setForm({ ...form, ...patch });
  const toggleCategory = (c) => set({ categories: form.categories.includes(c) ? form.categories.filter((x) => x !== c) : [...form.categories, c].slice(0, 3) });

  async function copyLink() {
    if (await copyText(link)) toast.success('Link copied');
    else toast.warning('Could not copy, select the link and copy it');
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateListing({
        slug: form.slug, bookingPageEnabled: form.bookingPageEnabled, listed: form.listed, categories: form.categories,
        city: form.city, region: form.region, country: form.country, description: form.description,
      });
      toast.success('Booking page saved');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Booking page &amp; listing <InfoTip term="listing" /></h2>
      <p className="muted" style={{ marginTop: 0 }}>Share this link on your website, Instagram or a QR code so customers can book without calling.</p>
      <form onSubmit={save}>
        <div className="field">
          <label htmlFor="slug">Your booking link <InfoTip term="slug" /></label>
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>{window.location.origin}/book/</span>
            <input id="slug" required value={form.slug ?? ''} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />
            <button type="button" onClick={copyLink}>Copy</button>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>Letters, numbers and hyphens. Changing it breaks links you already shared.</span>
        </div>
        <label style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={form.bookingPageEnabled} onChange={(e) => set({ bookingPageEnabled: e.target.checked })} />
          Accept online bookings on this page
        </label>

        <h3 style={{ fontSize: 15 }}>Directory listing</h3>
        <label style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={form.listed} onChange={(e) => set({ listed: e.target.checked })} />
          List my business in the public directory (/find)
        </label>
        <p style={{ fontSize: 13, marginTop: 0 }}>
          {form.hiddenByPlatform
            ? <span className="badge danger">Hidden by the platform</span>
            : form.live
              ? <span className="badge success">Live: customers can find you</span>
              : form.listed
                ? <span className="badge warning">On, but not visible yet: finish go-live, add a service and save your opening hours</span>
                : <span className="badge neutral">Not listed. Only people with your link can book.</span>}
        </p>
        <div className="field">
          <label>Type (pick up to 3)</label>
          <div className="row" style={{ gap: 8 }}>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" aria-pressed={form.categories.includes(c)} onClick={() => toggleCategory(c)}
                style={form.categories.includes(c) ? { background: 'var(--ink)', color: 'var(--ink-text)', borderColor: 'var(--ink)' } : undefined}>{catLabel(c)}</button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}><label htmlFor="city">City</label><input id="city" value={form.city} onChange={(e) => set({ city: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="region">State / region</label><input id="region" value={form.region} onChange={(e) => set({ region: e.target.value })} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="country">Country</label><input id="country" value={form.country} onChange={(e) => set({ country: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="desc">Short description</label><textarea id="desc" rows={2} maxLength={300} value={form.description} onChange={(e) => set({ description: e.target.value })} /></div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </form>
    </div>
  );
}
