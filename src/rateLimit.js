// Fixed-window in-memory limiter for the public endpoints. ponytail: per-process counters —
// move to Mongo (TTL collection) before running more than one server process.
const buckets = new Map();

// Returns true when `key` has used up `max` hits inside the last `windowMs`.
export function tooMany(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > max;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60_000).unref();

export function clearRateLimits() {
  buckets.clear();
}
