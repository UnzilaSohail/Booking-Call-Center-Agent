'use client';
import { useId, useState } from 'react';
import { GLOSSARY } from '../lib/glossary';

// Small "?" next to a field or heading that explains the term in plain words (Jira 25c). Works with
// hover, keyboard focus and tap; the text is exposed to screen readers through aria-describedby.
export default function InfoTip({ term, text }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [title, body] = term ? GLOSSARY[term] ?? ['', term] : ['', text];
  return (
    <span className="infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button" className="infotip-btn" aria-label={title ? `What is ${title}?` : 'More information'}
        aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      >?</button>
      {open && <span role="tooltip" id={id} className="infotip-pop">{title && <strong>{title}. </strong>}{body}</span>}
    </span>
  );
}
