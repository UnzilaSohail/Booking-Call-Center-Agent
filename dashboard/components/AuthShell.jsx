import Link from 'next/link';
import { CalendarDays, Check } from 'lucide-react';
import CallPreview from './CallPreview';
import ThemeToggle from './ThemeToggle';

// Shared frame for sign-in and sign-up: a coloured side that shows the product working (an AI call becoming a
// booking) and a clean form side. On a phone the colour side stacks above the form and shrinks.
const POINTS = ['Answers every call, day and night', 'Books straight into your calendar', 'Texts confirmations and reminders'];

export default function AuthShell({ children }) {
  return (
    <div className="split">
      <aside className="split-art">
        <Link href="/find" className="logo" style={{ color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 18, marginBottom: 28 }}>
          <span className="brand-mark"><CalendarDays size={18} color="#ffffff" /></span> Booking
        </Link>
        <h2 style={{ fontSize: 'clamp(26px, 3.4vw, 40px)', lineHeight: 1.1, letterSpacing: '-0.03em', margin: '0 0 12px', color: '#fff' }}>Your AI receptionist never misses a call</h2>
        <p style={{ margin: '0 0 22px', opacity: 0.85, maxWidth: 440 }}>Customers phone or book online. Bookings land in your calendar by themselves.</p>
        <CallPreview />
        <ul className="hide-sm" style={{ listStyle: 'none', padding: 0, margin: '22px 0 0', display: 'grid', gap: 8, fontSize: 14.5 }}>
          {POINTS.map((t) => <li key={t} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Check size={16} aria-hidden="true" /> {t}</li>)}
        </ul>
      </aside>
      <main id="main-content" tabIndex={-1} className="split-form" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 18, right: 18 }}><ThemeToggle /></div>
        {children}
      </main>
    </div>
  );
}
