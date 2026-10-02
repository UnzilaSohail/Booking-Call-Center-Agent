'use client';
import { useEffect, useState } from 'react';

// Numbers on the dashboard glide up from 0 when they first arrive. Keeps any prefix/suffix ("$1,240", "32%");
// anything that isn't a number (the "—" placeholder) is shown as is, and reduced-motion shows the final value.
export default function CountUp({ value, ms = 800 }) {
  const text = String(value ?? '');
  const m = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(text);
  const target = m ? parseFloat(m[2].replace(/,/g, '')) : null;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (target === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(target ?? 0); return; }
    let raf; const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(target * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  if (target === null) return <>{text}</>;
  const decimals = m[2].includes('.') ? m[2].split('.')[1].length : 0;
  return <>{m[1]}{n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{m[3]}</>;
}
