// Placeholder shapes shown while data loads (Jira 24d), instead of a bare "Loading...".
// Screen readers still get a polite "Loading" announcement.
const WIDTHS = ['92%', '78%', '85%', '64%', '88%'];

export function Skeleton({ lines = 3, height = 14, style }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: WIDTHS[i % WIDTHS.length] }} />
      ))}
    </div>
  );
}

export function Loading({ lines = 3, height, style }) {
  return (
    <div role="status" aria-live="polite" style={style}>
      <span className="sr-only">Loading</span>
      <Skeleton lines={lines} height={height} />
    </div>
  );
}

export default Loading;
