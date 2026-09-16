import { colorForId } from '../lib/colors';

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

// Deterministic initials avatar — same name always gets the same background color
// (reuses the calendar's colorForId palette so it stays in the blue family too).
export default function Avatar({ name, size = 28 }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: colorForId(name) }}>
      {initials(name)}
    </div>
  );
}
