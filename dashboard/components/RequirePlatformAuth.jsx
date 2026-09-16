'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { platformApi } from '../lib/api';
import PlatformSidebar from './PlatformSidebar';

// Same client-side-gate-only caveat as RequireAuth: the real enforcement is the
// requirePlatformAuth middleware server-side (src/platformAuth.js).
export default function RequirePlatformAuth({ children }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

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
      <PlatformSidebar />
      <div className="main-content">
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
