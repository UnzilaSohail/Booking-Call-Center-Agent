import './globals.css';
import './theme.css';
import { ToastProvider } from '../lib/Toast';
import { ConfirmProvider } from '../lib/confirm';
import A11yLabels from '../components/A11yLabels';

export const metadata = {
  title: 'Booking Admin',
  description: 'Admin dashboard for the AI call center booking agent',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Serif for headings only (globals.css --font-serif) — plain <link>, not
            next/font/google: Turbopack's own font fetcher doesn't go through Node's
            TLS settings, so it fails under a TLS-intercepting proxy/AV even when the
            browser and curl can reach fonts.googleapis.com fine. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet" />
        {/* Sets light or dark before the first paint (the person's saved choice, else their system setting), so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}" }} />
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
