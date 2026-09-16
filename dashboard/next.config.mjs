import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Two lockfiles exist (this app's own, and the backend's at the repo root) — pin the
  // workspace root explicitly so Turbopack doesn't guess and warn about it.
  turbopack: { root: __dirname },
};

export default nextConfig;
