import { Fraunces } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '../lib/Toast';

// Serif for headings only — the one deliberate typographic choice that keeps this from
// reading as a generic sans-everywhere admin template.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata = {
  title: 'Booking Admin',
  description: 'Admin dashboard for the AI call center booking agent',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={fraunces.variable}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
