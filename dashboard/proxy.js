import { NextResponse } from 'next/server';

// Content-Security-Policy (Jira 36g). Tells the browser exactly which places the dashboard may load code from and talk
// to, so a script injected by an attacker is refused. Scripts need a fresh one-time "nonce" for every page view
// (that is why pages are rendered per request); styles allow inline because the app uses inline style attributes.
//
// CSP_MODE (set in the dashboard's environment, then restart): "enforce" (default), "report" (log problems in the
// browser console but block nothing: use this first if a page ever seems broken), or "off".
export function proxy(request) {
  const mode = process.env.CSP_MODE || 'enforce';
  if (mode === 'off') return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.stripe.com",
    `media-src 'self' blob: ${api}`,
    `connect-src 'self' ${api} https://*.stripe.com https://*.stripe.network https://challenges.cloudflare.com${dev ? ' ws: wss:' : ''}`,
    'frame-src https://js.stripe.com https://hooks.stripe.com https://*.stripe.network https://challenges.cloudflare.com',
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  const header = mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(header, policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  return response;
}

export const config = {
  // Pages only: not Next's own files, images or the icon
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] }],
};
