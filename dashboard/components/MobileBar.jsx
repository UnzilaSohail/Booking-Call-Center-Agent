'use client';
import { Menu } from 'lucide-react';

// Phone-width top bar with the button that opens the sidebar (Jira 25j). Hidden on desktop by CSS.
export default function MobileBar({ onMenu }) {
  return (
    <div className="mobile-bar">
      <button type="button" onClick={onMenu} aria-label="Open menu"><Menu size={18} /></button>
      <strong style={{ fontFamily: 'var(--font-serif)' }}>Booking</strong>
    </div>
  );
}
