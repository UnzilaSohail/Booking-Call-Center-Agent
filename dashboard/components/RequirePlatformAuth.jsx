'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { platformApi } from '../lib/api';
import PlatformSidebar from './PlatformSidebar';
import MobileBar from './MobileBar';

// Same client-side-gate-only caveat as RequireAuth: the real enforcement is the
// requirePlatformAuth middleware server-side (src/platformAuth.js).
export default function RequirePlatformAuth({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!platformApi.getToken()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="app-shell">
      <MobileBar onMenu={() => setMenuOpen(true)} />
      <PlatformSidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className={`sidebar-backdrop${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <main id="main-content" tabIndex={-1} className="main-content">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
