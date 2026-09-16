'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarDays, LayoutDashboard, ListChecks, LogOut, Phone, Settings as SettingsIcon,
  Tag, Users,
} from 'lucide-react';
import Avatar from './Avatar';
import { api, clearToken } from '../lib/api';

const LINKS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/bookings', label: 'Bookings', icon: ListChecks },
  { href: '/calls', label: 'Calls', icon: Phone },
  { href: '/services', label: 'Services', icon: Tag },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState(null);

  useEffect(() => { api.getMe().then(setMe).catch(() => {}); }, []);

  function logout() {
    clearToken();
    router.push('/login');
  }

  const displayName = me?.name || me?.email || 'Loading...';

  return (
    <aside className="sidebar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 8px 22px' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9, flexShrink: 0,
          border: '1px solid rgba(245, 248, 247, 0.22)', background: 'rgba(245, 248, 247, 0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CalendarDays size={16} color="#f5f7f8" />
        </div>
        <div>
          <div className="sidebar-brand" style={{ padding: 0, fontSize: 15.5 }}>Booking</div>
          <div style={{ fontSize: 10.5, fontWeight: 500, marginTop: 1, letterSpacing: '0.03em', color: 'rgba(245, 248, 247, 0.5)' }}>
            Smart scheduling
          </div>
        </div>
      </div>
      <nav className="stack" style={{ gap: 2, flex: 1 }}>
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`sidebar-link${pathname === href ? ' active' : ''}`}>
            <Icon size={16} />
            {label}
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
            <div style={{ fontSize: 10.5, color: 'rgba(245, 248, 247, 0.5)' }}>Administrator</div>
          </div>
        </div>
        <button className="ghost" onClick={logout} style={{ justifyContent: 'flex-start', width: '100%' }}>
          <LogOut size={16} />
          Log out
        </button>
      </div>
    </aside>
  );
}
