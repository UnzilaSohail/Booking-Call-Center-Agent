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

// Failure counters (logins, one-time codes): only WRONG attempts count, so a good user is never locked out by
// their own successful logins. blocked() is checked before trying, fail() after a wrong answer, forgive() on success.
export function blocked(key, max) {
  const b = buckets.get(key);
  return !!b && Date.now() < b.resetAt && b.count >= max;
}
export function fail(key, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) buckets.set(key, { count: 1, resetAt: now + windowMs });
  else b.count += 1;
}
export function forgive(key) {
  buckets.delete(key);
}

// One policy for every password login: 8 wrong passwords per email and 30 per address in 15 minutes.
const LOGIN_WINDOW = 15 * 60_000;
export const loginBlocked = (ip, email) => blocked(`login-id:${email}`, 8) || blocked(`login-ip:${ip}`, 30);
export const loginFailed = (ip, email) => { fail(`login-id:${email}`, LOGIN_WINDOW); fail(`login-ip:${ip}`, LOGIN_WINDOW); };
export const loginSucceeded = (email) => forgive(`login-id:${email}`);

export function clearRateLimits() {
  buckets.clear();
}
