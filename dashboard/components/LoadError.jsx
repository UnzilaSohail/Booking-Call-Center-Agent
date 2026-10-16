'use client';

// The error line every page shows when a load fails, with a way to try again.
export default function LoadError({ error, onRetry }) {
  if (!error) return null;
  return (
    <p className="error-text">
      {error}
      {onRetry && <> <button type="button" className="ghost" onClick={onRetry} style={{ marginLeft: 8 }}>Try again</button></>}
    </p>
  );
}
