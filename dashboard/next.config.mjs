import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Two lockfiles exist (this app's own, and the backend's at the repo root) — pin the
  // workspace root explicitly so Turbopack doesn't guess and warn about it.
  turbopack: { root: __dirname },
  poweredByHeader: false,
  // Browser hardening. Referrer-Policy matters most: booking "manage" links carry a secret in the address, and this
  // stops it being sent to other sites. Geolocation stays allowed for "Near me". The Content-Security-Policy is set per request in proxy.js.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' }, // same address only (the demo phone frame); CSP frame-ancestors says the same
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      ],
    }];
  },
};

export default nextConfig;
