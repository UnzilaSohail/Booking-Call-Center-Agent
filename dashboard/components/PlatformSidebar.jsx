'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, Building2, CalendarClock, LayoutDashboard, LogOut, Settings as SettingsIcon } from 'lucide-react';
import Avatar from './Avatar';
import { platformApi } from '../lib/api';

const LINKS = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/bookings', label: 'Bookings', icon: CalendarClock },
  { href: '/platform/companies', label: 'Companies', icon: Building2 },
  { href: '/platform/activity', label: 'Agent activity', icon: Activity },
  { href: '/platform/settings', label: 'Settings', icon: SettingsIcon },
];

export default function PlatformSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState(null);

  useEffect(() => { platformApi.getMe().then((me) => setEmail(me.email)).catch(() => {}); }, []);

  function logout() {
    platformApi.clearToken();
    router.push('/login');
  }

  return (
    <aside className="sidebar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 8px 22px' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9, flexShrink: 0,
          border: '1px solid rgba(245, 248, 247, 0.22)', background: 'rgba(245, 248, 247, 0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LayoutDashboard size={16} color="#f5f7f8" />
        </div>
        <div>
          <div className="sidebar-brand" style={{ padding: 0, fontSize: 15.5 }}>Booking</div>
          <div style={{ fontSize: 10.5, fontWeight: 500, marginTop: 1, letterSpacing: '0.03em', color: 'rgba(245, 248, 247, 0.5)' }}>
            AI agents for effortless scheduling
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
          <Avatar name={email || 'Platform admin'} size={26} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#f5f7f8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>
              {email || 'Loading...'}
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(245, 248, 247, 0.5)' }}>Platform admin</div>
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
