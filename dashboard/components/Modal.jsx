'use client';
import { useEffect, useId, useRef } from 'react';

// Accessible dialog shell (Jira 25g): role=dialog + aria-modal + aria-labelledby, focus moves in on
// open, Tab/Shift+Tab stay inside, Escape closes, and focus returns to what opened it.
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({ title, onClose, children, width }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // always the latest, without re-running the effect below on every render

  useEffect(() => {
    const opener = document.activeElement;
    const el = ref.current;
    const focusables = () => [...el.querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled && n.offsetParent !== null);
    (focusables()[0] ?? el).focus();

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} style={width ? { maxWidth: width } : undefined}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
