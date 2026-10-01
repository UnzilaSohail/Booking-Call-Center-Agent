import './globals.css';
import { ToastProvider } from '../lib/Toast';
import { ConfirmProvider } from '../lib/confirm';
import A11yLabels from '../components/A11yLabels';

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
      {/* suppressHydrationWarning: browser extensions (Grammarly, etc.) inject their own
          attributes onto <body> before React hydrates — a real mismatch, but a harmless
          one, so this silences just that noise without disabling hydration warnings
          elsewhere. https://react.dev/link/hydration-mismatch */}
      <body suppressHydrationWarning>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <ToastProvider><ConfirmProvider>{children}</ConfirmProvider></ToastProvider>
        <A11yLabels />
      </body>
    </html>
  );
}
