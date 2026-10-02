'use client';
import { useMemo } from 'react';

// A short burst of falling paper for a finished booking. Pure CSS (see .confetti in theme.css): the pieces are
// positioned once, animate once, and are hidden entirely for people who asked for reduced motion.
const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#0ea5e9', '#22c55e'];

export default function Confetti({ pieces = 46 }) {
  const items = useMemo(() => Array.from({ length: pieces }, (_, i) => ({
    left: Math.round(Math.random() * 100), color: COLORS[i % COLORS.length],
    dx: `${Math.round((Math.random() - 0.5) * 220)}px`, rot: `${Math.round(360 + Math.random() * 540)}deg`,
    t: `${(2 + Math.random() * 1.6).toFixed(2)}s`, d: `${(Math.random() * 0.5).toFixed(2)}s`,
  })), [pieces]);
  return (
    <div className="confetti" aria-hidden="true">
      {items.map((p, i) => <i key={i} style={{ left: `${p.left}%`, background: p.color, '--dx': p.dx, '--rot': p.rot, '--t': p.t, '--d': p.d }} />)}
    </div>
  );
}
