'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle, CalendarDays, Contact, CreditCard, History, LayoutDashboard, ListChecks, ListTodo, LogOut, Phone, Settings as SettingsIcon,
  Tag, Users,
} from 'lucide-react';
import Avatar from './Avatar';
import ThemeToggle from './ThemeToggle';
import { api, clearToken } from '../lib/api';

const ROLE_LABELS = {
  owner: 'Owner', manager: 'Manager', receptionist: 'Receptionist', staff: 'Staff', billing: 'Billing', custom: 'Custom access',
};

// `area` is null for pages every role can see (src/permissions.js areas gate everything
// else — ROADMAP.md §10).
const LINKS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, area: null },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, area: 'bookings' },
  { href: '/bookings', label: 'Bookings', icon: ListChecks, area: 'bookings' },
  { href: '/customers', label: 'Customers', icon: Contact, area: 'customers' },
  { href: '/calls', label: 'Calls', icon: Phone, area: 'calls' },
  { href: '/services', label: 'Services', icon: Tag, area: 'services' },
  { href: '/team', label: 'Team', icon: Users, area: 'team' },
  { href: '/exceptions', label: 'Needs attention', icon: AlertTriangle, area: 'exceptions' },
  { href: '/onboarding', label: 'Setup guide', icon: ListTodo, area: null },
  { href: '/billing', label: 'Billing', icon: CreditCard, area: 'billing' },
  { href: '/settings', label: 'Settings', icon: SettingsIcon, area: 'settings' },
  { href: '/audit-log', label: 'Activity history', icon: History, area: 'settings' },
];

export default function Sidebar({ open = false, onNavigate }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [setup, setSetup] = useState(null); // { done, total } while onboarding is unfinished (Jira 26a)

  useEffect(() => { api.getMe().then(setMe).catch(() => {}); }, []);
  useEffect(() => {
    api.getOnboardingStatus().then((s) => {
      const done = s.steps.filter((x) => x.done).length;
      setSetup(s.steps.find((x) => x.key === 'go_live')?.done ? null : { done, total: s.steps.length });
    }).catch(() => {});
  }, [pathname]);

  function logout() {
    clearToken();
    router.push('/login');
  }

  const displayName = me?.name || me?.email || 'Loading...';

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main menu">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 8px 22px' }}>
        <div className="brand-mark"><CalendarDays size={18} color="#ffffff" /></div>
        <div>
          <div className="sidebar-brand" style={{ padding: 0, fontSize: 15.5 }}>Booking</div>
          <div style={{ fontSize: 10.5, fontWeight: 500, marginTop: 1, letterSpacing: '0.03em', color: 'rgba(245, 248, 247, 0.5)' }}>
            Smart scheduling
          </div>
        </div>
      </div>
      <nav className="stack" style={{ gap: 2, flex: 1 }}>
        {LINKS.filter(({ area }) => !area || (me?.areas ?? []).includes(area)).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={onNavigate} className={`sidebar-link${pathname === href || (href !== '/' && pathname.startsWith(href)) ? ' active' : ''}`}>
            <Icon size={16} />
            {label}
            {href === '/onboarding' && setup && <span className="count" aria-label={`${setup.done} of ${setup.total} steps done`}>{setup.done}/{setup.total}</span>}
          </Link>
        ))}
      </nav>
      <div style={{ borderTop: '1px solid rgba(245, 248, 247, 0.12)', paddingTop: 12, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 10px' }}>
          <Avatar name={displayName} size={26} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#f5f7f8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>
              {displayName}
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(245, 248, 247, 0.5)' }}>{ROLE_LABELS[me?.role] ?? 'Administrator'}</div>
          </div>
        </div>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap', gap: 6 }}>
          <button className="ghost" onClick={logout} style={{ justifyContent: 'flex-start', flex: 1 }}>
            <LogOut size={16} />
            Log out
          </button>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
