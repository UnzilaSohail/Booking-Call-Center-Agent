'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '../lib/api';
import Sidebar from './Sidebar';

// Client-side gate only: this is a UX convenience, not a security boundary — every
// actual protected read/write still requires a valid bearer token server-side
// (src/auth.js requireAuth/requireArea), which is where the real enforcement lives
// (plan.md §7). `area` is optional (ROADMAP.md §10 role areas, src/permissions.js) —
// pages that don't pass one are visible to every role, same as before roles existed.
export default function RequireAuth({ children, area }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    if (!area) {
      setReady(true);
      return;
    }
    api.getMe()
      .then((me) => setAllowed((me.areas ?? []).includes(area)))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [router, area]);

  if (!ready) return null;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <div className="page">
          {allowed ? children : (
            <div className="empty-state" style={{ padding: '48px 20px' }}>
              <p>You don&apos;t have permission to view this page.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
