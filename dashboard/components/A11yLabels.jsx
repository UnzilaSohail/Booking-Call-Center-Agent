'use client';
import { useEffect } from 'react';

// Jira 25d: most form labels in this app are written as <label>Text</label><input/> inside a .field
// box, which a screen reader does not connect (clicking the label does not focus the input either).
// This links every such label to its control by id, once on load and again whenever the page
// changes, so new forms are covered without remembering htmlFor each time. Labels that already
// have htmlFor, or wrap their input, are left alone.
let counter = 0;
const CONTROL = 'input:not([type=hidden]), select, textarea';

function link(root) {
  for (const label of root.querySelectorAll('label:not([for])')) {
    if (label.querySelector(CONTROL)) continue; // wrapping label: already associated
    const field = label.closest('.field') ?? label.parentElement;
    const control = (label.nextElementSibling?.matches?.(CONTROL) ? label.nextElementSibling : null)
      ?? field?.querySelector(CONTROL);
    if (!control || (control.id && document.querySelector(`label[for="${control.id}"]`))) continue;
    if (!control.id) control.id = `field-${++counter}`;
    label.setAttribute('for', control.id);
  }
}

export default function A11yLabels() {
  useEffect(() => {
    let frame = 0;
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => link(document.body)); };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
