'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CalendarDays, CreditCard, History, Settings, ShieldCheck, Tag, UserRound, Users } from 'lucide-react';
import RequireAuth from '../../components/RequireAuth';
import Avatar from '../../components/Avatar';
import { api } from '../../lib/api';
import { describeActivity, GROUPS } from '../../lib/activity';
import Loading from '../../components/Skeleton';

// "Activity history": a plain-language timeline of what people did in the dashboard, newest first, grouped by day.
// The stored record is technical (a web address); lib/activity.js turns it into a sentence.
const ICONS = {
  Bookings: [CalendarDays, 'var(--accent-soft)', 'var(--accent)'], Customers: [UserRound, 'var(--info-soft)', 'var(--info)'],
  Team: [Users, 'var(--violet-soft)', 'var(--violet)'], Services: [Tag, 'var(--success-soft)', 'var(--success)'],
  Settings: [Settings, 'var(--surface-alt)', 'var(--text-muted)'], 'AI & calls': [Bot, 'var(--accent-soft)', 'var(--accent)'],
  Billing: [CreditCard, 'var(--warning-soft)', 'var(--warning)'], 'Needs attention': [AlertTriangle, 'var(--danger-soft)', 'var(--danger)'],
  'Setup & security': [ShieldCheck, 'var(--success-soft)', 'var(--success)'],
};

const dayLabel = (d) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};
const timeOf = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

// Several identical actions by one person within 15 minutes (e.g. five edits in a row) become one line with a count.
function collapse(items) {
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev && prev.text === it.text && prev.who === it.who && Math.abs(new Date(prev.firstAt) - new Date(it.at)) < 15 * 60_000) { prev.count += 1; prev.firstAt = it.at; } else out.push({ ...it, count: 1, firstAt: it.at });
  }
  return out;
}

function AuditLogInner() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState('');
  const [shown, setShown] = useState(40);

  useEffect(() => {
    api.listAuditLogs().then(setLogs).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const items = useMemo(() => collapse(logs.map((l) => ({ id: l.id, at: l.createdAt, who: l.admin?.name || l.admin?.email || 'Someone', ...describeActivity(l) })).filter((i) => !group || i.group === group)), [logs, group]);
  const days = useMemo(() => {
    const map = new Map();
    for (const it of items.slice(0, shown)) { const k = dayLabel(it.at); map.set(k, [...(map.get(k) ?? []), it]); }
    return [...map];
  }, [items, shown]);

  return (
    <div className="stack">
      <div>
        <h1>Activity history</h1>
        <p className="muted" style={{ marginTop: 4 }}>A simple record of who changed what in your dashboard, newest first. Useful when you wonder &ldquo;who changed that?&rdquo;</p>
      </div>

      {logs.length > 0 && (
        <div className="chip-row" style={{ justifyContent: 'flex-start', marginTop: 0 }} role="group" aria-label="Show">
          <button type="button" className="chip-btn" aria-pressed={!group} onClick={() => { setGroup(''); setShown(40); }}>Everything</button>
          {GROUPS.filter((g) => logs.some((l) => describeActivity(l).group === g)).map((g) => (
            <button key={g} type="button" className="chip-btn" aria-pressed={group === g} onClick={() => { setGroup(g); setShown(40); }}>{g}</button>
          ))}
        </div>
      )}

      <div className="card">
        {loading && <Loading />}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && logs.length === 0 && (
          <div className="empty-state">
            <History size={28} color="var(--text-faint)" />
            <p>Nothing yet. When you or your team change something, it shows up here.</p>
          </div>
        )}
        {days.map(([day, list]) => (
          <Fragment key={day}>
            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', margin: '14px 0 4px', fontFamily: 'var(--font-body)' }}>{day}</h2>
            {list.map((it) => {
              const [Icon, bg, fg] = ICONS[it.group] ?? ICONS.Settings;
              return (
                <div key={it.id} className="up-row">
                  <span style={{ width: 36, height: 36, borderRadius: 12, background: bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true"><Icon size={17} color={fg} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{it.text}{it.count > 1 && <span className="badge neutral" style={{ marginLeft: 8 }}>{it.count} times</span>}</div>
                    <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={it.who} size={18} /> {it.who}</div>
                  </div>
                  <div className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{timeOf(it.at)}</div>
                </div>
              );
            })}
          </Fragment>
        ))}
        {!loading && items.length > shown && (
          <div className="row" style={{ justifyContent: 'center', alignItems: 'center', marginTop: 14 }}>
            <span className="muted" style={{ fontSize: 13 }}>Showing {shown} of {items.length}</span>
            <button type="button" onClick={() => setShown(shown + 60)}>Show more</button>
          </div>
        )}
        {!loading && logs.length > 0 && items.length === 0 && <p className="muted">Nothing in this group yet.</p>}
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  return (
    <RequireAuth area="settings">
      <AuditLogInner />
    </RequireAuth>
  );
}
