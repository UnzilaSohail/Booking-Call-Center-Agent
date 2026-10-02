// Little helpers that make a business feel like a brand without needing a logo upload: a stable colour
// gradient picked from its name, and its initials.
const PALETTE = [
  ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#6366f1'], ['#14b8a6', '#0ea5e9'],
  ['#f59e0b', '#ef4444'], ['#ec4899', '#8b5cf6'], ['#22c55e', '#14b8a6'],
];

export function gradientFor(name) {
  let h = 0;
  for (const c of String(name ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTE[h % PALETTE.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase();
}
