import './globals.css';
import { ToastProvider } from '../lib/Toast';

export const metadata = {
  title: 'Booking Admin',
  description: 'Admin dashboard for the AI call center booking agent',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Serif for headings only (globals.css --font-serif) — plain <link>, not
            next/font/google: Turbopack's own font fetcher doesn't go through Node's
            TLS settings, so it fails under a TLS-intercepting proxy/AV even when the
            browser and curl can reach fonts.googleapis.com fine. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;1,500;1,600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
