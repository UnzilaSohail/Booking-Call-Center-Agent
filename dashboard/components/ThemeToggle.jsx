'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

// Light / dark switch. The first choice comes from the person's system setting (an inline script in
// app/layout.jsx sets it before the page paints, so there is no flash); after that their own choice is remembered.
export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState('light');
  useEffect(() => { setTheme(document.documentElement.dataset.theme || 'light'); }, []);

  function flip() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* private mode: it just resets next visit */ }
    setTheme(next);
  }

  return (
    <button type="button" className={`theme-toggle ${className}`} onClick={flip} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
