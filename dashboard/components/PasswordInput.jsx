'use client';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// A password box with an eye button that shows what is being typed. Takes the same props as <input>
// (the type is managed here); `style`, e.g. a width, goes on the wrapper so the button stays inside the box.
export default function PasswordInput({ style, ...props }) {
  const [shown, setShown] = useState(false);
  const label = shown ? 'Hide password' : 'Show password';
  return (
    <div className="pw-wrap" style={style}>
      <input {...props} type={shown ? 'text' : 'password'} />
      <button type="button" className="pw-toggle" onClick={() => setShown((s) => !s)} aria-label={label} aria-pressed={shown} title={label}>
        {shown ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
