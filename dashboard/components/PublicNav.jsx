'use client';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

// Top bar for the pages customers see (find, book, my appointments, manage): logo, theme switch, and a way in
// for businesses. `right` can add page-specific links.
export default function PublicNav({ right }) {
  return (
    <header className="public-nav">
      <Link href="/find" className="logo">
        <span className="brand-mark"><CalendarDays size={18} color="#ffffff" /></span>
        Booking
      </Link>
      <nav className="row" style={{ alignItems: 'center', gap: 14, flexWrap: 'nowrap' }} aria-label="Site">
        {right}
        <Link href="/login" style={{ fontWeight: 600, fontSize: 14 }}>For businesses</Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}
