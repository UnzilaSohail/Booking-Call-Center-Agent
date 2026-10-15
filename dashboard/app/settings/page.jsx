'use client';
import { useEffect, useState } from 'react';
import RequireAuth from '../../components/RequireAuth';
import { api } from '../../lib/api';
import { useToast } from '../../lib/Toast';
import { copyText } from '../../lib/clipboard';
import MfaCard from '../../components/MfaCard';
import { GLOSSARY } from '../../lib/glossary';
import BusinessProfileSection from '../../components/settings/BusinessProfileSection';
import BookingPageSection from '../../components/settings/BookingPageSection';
import LocationsSection from '../../components/settings/LocationsSection';
import ChangePasswordSection from '../../components/settings/ChangePasswordSection';
import BusinessHoursSection from '../../components/settings/BusinessHoursSection';
import HolidaysSection from '../../components/settings/HolidaysSection';
import TransferDepartmentsSection from '../../components/settings/TransferDepartmentsSection';
import KnowledgeBaseSection from '../../components/settings/KnowledgeBaseSection';
import CalendarConnectSection from '../../components/settings/CalendarConnectSection';
import PhoneNumberSection from '../../components/settings/PhoneNumberSection';
import DeleteAccountSection from '../../components/settings/DeleteAccountSection';

// Settings is grouped into tabs so the page isn't one 12-section scroll (Jira 25a). The tab lives in the
// address (#booking, #calls ...) so a link or a refresh lands on the same one.
function GlossaryCard() {
  return (
    <div className="card">
      <h2>Plain-English glossary</h2>
      <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>What the terms in this dashboard mean. You'll also find a small ? next to many fields.</p>
      <dl style={{ margin: 0, display: 'grid', gap: 12 }}>
        {Object.values(GLOSSARY).map(([term, meaning]) => (
          <div key={term}><dt style={{ fontWeight: 650 }}>{term}</dt><dd style={{ margin: '2px 0 0' }} className="muted">{meaning}</dd></div>
        ))}
      </dl>
    </div>
  );
}

const TABS = [
  { id: 'business', label: 'Business', render: () => <><BusinessProfileSection /><LocationsSection /></> },
  { id: 'booking', label: 'Booking & hours', render: () => <><BookingPageSection /><BusinessHoursSection /><HolidaysSection /></> },
  { id: 'calls', label: 'Calls & AI', render: () => <><PhoneNumberSection /><TransferDepartmentsSection /><KnowledgeBaseSection /><CalendarConnectSection /></> },
  { id: 'account', label: 'Account & security', render: () => <><ChangePasswordSection /><MfaCard client={api} /><DeleteAccountSection /></> },
  { id: 'help', label: 'Help', render: () => <GlossaryCard /> },
];

function SettingsTabs() {
  const [tab, setTab] = useState(TABS[0].id);
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (TABS.some((t) => t.id === fromHash)) setTab(fromHash);
  }, []);

  function choose(id) {
    setTab(id);
    window.history.replaceState(null, '', `#${id}`);
  }
  function onKeyDown(e, index) {
    const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!move) return;
    e.preventDefault();
    const next = TABS[(index + move + TABS.length) % TABS.length];
    choose(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t, i) => (
          <button
            key={t.id} id={`tab-${t.id}`} type="button" role="tab" className="tab"
            aria-selected={tab === t.id} aria-controls="settings-panel" tabIndex={tab === t.id ? 0 : -1}
            onClick={() => choose(t.id)} onKeyDown={(e) => onKeyDown(e, i)}
          >{t.label}</button>
        ))}
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="stack">
        {TABS.find((t) => t.id === tab).render()}
      </div>
    </>
  );
}

// The three things an owner most often comes here for, at a glance: the business, its public booking link, its phone number.
function SettingsHero() {
  const toast = useToast();
  const [b, setB] = useState(null);
  useEffect(() => { Promise.all([api.getBusiness(), api.getListing()]).then(([biz, listing]) => setB({ ...biz, slug: listing.slug })).catch(() => {}); }, []);
  if (!b) return null;
  const link = b.slug ? `${window.location.origin}/book/${b.slug}` : null;
  return (
    <div className="hero-card fade-up" style={{ padding: '20px 24px' }}>
      <div>
        <h1 style={{ fontSize: 26 }}>{b.name}</h1>
        <p style={{ margin: '4px 0 0' }}>{b.phoneNumber ? `Customers call ${b.phoneNumber}` : 'No business phone number yet'}{b.address ? ` · ${b.address}` : ''}</p>
      </div>
      {link && (
        <div className="agent-card" style={{ minWidth: 280 }}>
          <small>Your booking link: share it anywhere</small>
          <div className="row" style={{ alignItems: 'center', marginTop: 6, flexWrap: 'nowrap' }}>
            <code style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{link.replace(/^https?:\/\//, '')}</code>
            <button type="button" className="primary" style={{ padding: '6px 12px' }} onClick={async () => { if (await copyText(link)) toast.success('Link copied'); }}>Copy</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth area="settings">
      <div className="stack">
        <SettingsHero />
        <SettingsTabs />
      </div>
    </RequireAuth>
  );
}
