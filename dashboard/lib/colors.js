// Deterministic color-coding for calendar events and avatars — same staff member (or
// service, when there's no staff) always gets the same color, no server-side color
// field needed. Vibrant and varied (app/globals.css semantic set), not a single hue.
// Ordered so the first few are as different from each other as possible.
const PALETTE = [
  '#2563eb', // blue
  '#db2777', // pink
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
  '#0d9488', // teal
];

// `order` (optional): the ids shown together, e.g. all staff. Each gets its own colour by position, so two
// team members can never look alike; without it the colour comes from a hash of the id.
export function colorForId(id, order) {
  if (!id) return '#8b9aa1'; // no staff/service assigned — neutral
  const at = order?.indexOf(id) ?? -1;
  if (at >= 0) return PALETTE[at % PALETTE.length];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
