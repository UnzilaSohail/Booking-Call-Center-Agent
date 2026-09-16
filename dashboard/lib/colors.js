// Deterministic color-coding for calendar events and avatars — same staff member (or
// service, when there's no staff) always gets the same color, no server-side color
// field needed. Vibrant and varied (app/globals.css semantic set), not a single hue.
const PALETTE = [
  '#2563eb', // blue (accent)
  '#16a34a', // green (success)
  '#d97706', // amber (warning)
  '#dc2626', // red (danger)
  '#0891b2', // cyan (info)
  '#7c3aed', // violet
  '#db2777', // pink
  '#0d9488', // teal
];

export function colorForId(id) {
  if (!id) return '#8b9aa1'; // no staff/service assigned — neutral
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
