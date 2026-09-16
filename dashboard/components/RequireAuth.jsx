'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '../lib/api';
import Sidebar from './Sidebar';

// Client-side gate only: this is a UX convenience, not a security boundary — every
// actual protected read/write still requires a valid bearer token server-side
// (src/auth.js requireAuth), which is where the real enforcement lives (plan.md §7).
export default function RequireAuth({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
