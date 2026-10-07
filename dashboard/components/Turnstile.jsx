'use client';
import { useEffect, useRef } from 'react';

// Cloudflare's "are you a person" box (Jira AIN-433). Shows nothing when no site key is set (local development), and the
// server then does not ask for it either. Calls onToken(token) when passed and onToken('') when the token runs out.
// Change `resetKey` (e.g. after a failed submit) to get a fresh box: a token can be used only once.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
let scriptPromise = null;
const loadScript = () => (scriptPromise ??= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true; s.onload = () => resolve(window.turnstile); s.onerror = () => { scriptPromise = null; reject(new Error('could not load the check')); };
  document.head.appendChild(s);
}));

export default function Turnstile({ onToken, resetKey = 0 }) {
  const box = useRef(null);
  useEffect(() => {
    if (!SITE_KEY || !box.current) return undefined;
    let widget = null; let gone = false;
    loadScript().then((ts) => {
      if (gone || !box.current) return;
      widget = ts.render(box.current, { sitekey: SITE_KEY, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken('') });
    }).catch(() => {});
    return () => { gone = true; onToken(''); if (widget != null) window.turnstile?.remove(widget); };
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return SITE_KEY ? <div ref={box} style={{ margin: '8px 0' }} /> : null;
}

export const turnstileOn = Boolean(SITE_KEY);
