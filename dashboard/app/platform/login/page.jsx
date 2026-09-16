'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Login is unified now (app/login/page.jsx) — this just catches anyone with an old
// bookmark/link to this URL instead of leaving it a dead page.
export default function PlatformLoginRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/login'); }, [router]);
  return null;
}
