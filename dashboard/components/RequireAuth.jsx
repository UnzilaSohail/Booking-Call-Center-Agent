'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, clearToken } from '../lib/api';
import Sidebar from './Sidebar';
import MobileBar from './MobileBar';

// Client-side gate only: this is a UX convenience, not a security boundary — every
// actual protected read/write still requires a valid bearer token server-side
// (src/auth.js requireAuth/requireArea), which is where the real enforcement lives
// (plan.md §7). `area` is optional (ROADMAP.md §10 role areas, src/permissions.js) —
// pages that don't pass one are visible to every role, same as before roles existed.
export default function RequireAuth({ children, area }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    // Always validated against the server, even on pages with no `area` gate — a token
    // that's merely present but expired/invalid (a stale one left in localStorage from a
    // previous session, or one whose admin got suspended) would otherwise render the page
    // and leave every API call underneath it failing with "invalid or expired token"
    // instead of just sending the admin back to log in.
    api.getMe()
      .then((me) => setAllowed(!area || (me.areas ?? []).includes(area)))
      .catch((err) => {
        if (err.status === 401) {
          clearToken();
          router.replace('/login');
          return;
        }
        setAllowed(true); // fail open on a transient/network error, not an auth one
      })
      .finally(() => setReady(true));
  }, [router, area]);

  if (!ready) return null;

  return (
    <div className="app-shell">
      <MobileBar onMenu={() => setMenuOpen(true)} />
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <div className={`sidebar-backdrop${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <main id="main-content" tabIndex={-1} className="main-content">
        <div className="page">
          {allowed ? children : (
            <div className="empty-state" style={{ padding: '48px 20px' }}>
              <p>You don&apos;t have permission to view this page.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
