'use client';
import { useId, useState } from 'react';

// Label + input + hint + inline error in one piece (Jira 24g, 25d). The label is tied to the input
// with htmlFor, the hint/error are announced through aria-describedby, and the error appears after
// the person leaves the field (or when `showErrors` is set after a failed submit), not while typing.
export default function TextField({ label, value, onChange, validate, hint, required, optional, type = 'text', showErrors = false, style, ...rest }) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const error = (touched || showErrors) && validate ? validate(value) : '';
  const note = error || hint;
  return (
    <div className="field" style={style}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {optional && <span className="faint" style={{ textTransform: 'none', fontWeight: 400 }}> (optional)</span>}
      </label>
      <input
        id={id} type={type} value={value} required={required}
        onChange={(e) => onChange(e.target.value)} onBlur={() => setTouched(true)}
        aria-invalid={error ? 'true' : undefined} aria-describedby={note ? `${id}-note` : undefined}
        {...rest}
      />
      {note && <span id={`${id}-note`} className={error ? 'field-error' : 'hint'} role={error ? 'alert' : undefined}>{note}</span>}
    </div>
  );
}
