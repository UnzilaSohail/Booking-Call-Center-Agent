// Rate limits (Jira 36h). Counters live in MongoDB (`rate_limits`, expired rows removed by a TTL index), so a restart
// does not give an attacker a fresh start and several server processes share one count.
// Only the busiest, least sensitive limiter (public page reads) stays in memory: tooManyLocal().
import { getDb } from './db.js';

// Parallel test processes share one database and all call from 127.0.0.1; each gets its own key space.
const NS = process.env.NODE_TEST_CONTEXT ? `t${process.pid}:` : '';

const rows = async () => (await getDb()).collection('rate_limits');

// Counts one hit for `key` inside a fixed window and returns the count so far.
async function hit(key, windowMs) {
  const col = await rows();
  const _id = NS + key;
  const live = await col.findOneAndUpdate({ _id, expires_at: { $gt: new Date() } }, { $inc: { count: 1 } }, { returnDocument: 'after' });
  if (live) return live.count;
  // ponytail: two first-ever hits in the same millisecond can both write 1 (one hit uncounted); acceptable for limits this size
  await col.replaceOne({ _id }, { _id, count: 1, expires_at: new Date(Date.now() + windowMs) }, { upsert: true });
  return 1;
}

// true when `key` has used up `max` hits inside the last `windowMs` (this call counts as a hit)
export async function tooMany(key, max, windowMs) {
  return (await hit(key, windowMs)) > max;
}

// Failure counters (logins, one-time codes): only WRONG attempts count, so a good user is never locked out by
// their own successful logins. blocked() is checked before trying, fail() after a wrong answer, forgive() on success.
export async function blocked(key, max) {
  const row = await (await rows()).findOne({ _id: NS + key, expires_at: { $gt: new Date() } });
  return !!row && row.count >= max;
}
export const fail = hit;
export async function forgive(key) {
  await (await rows()).deleteOne({ _id: NS + key });
}

// One policy for every password login: 8 wrong passwords per email and 30 per address in 15 minutes.
// The attempt is counted BEFORE the password is checked (one atomic $inc). Checking first and counting after let a
// burst of parallel guesses all pass the check. A correct login gives its attempt back, so only wrong ones count.
const LOGIN_WINDOW = 15 * 60_000;
const LOGIN_MAX_PER_EMAIL = 8;
const LOGIN_MAX_PER_IP = 30;
export async function loginAttempt(ip, email) {
  const forEmail = await hit(`login-id:${email}`, LOGIN_WINDOW);
  const forIp = await hit(`login-ip:${ip}`, LOGIN_WINDOW);
  // lockedNow: this was the 8th attempt, so if it turns out wrong it is the one that locks the email (owner is told once)
  return { blocked: forEmail > LOGIN_MAX_PER_EMAIL || forIp > LOGIN_MAX_PER_IP, lockedNow: forEmail === LOGIN_MAX_PER_EMAIL };
}
export async function loginSucceeded(ip, email) {
  await forgive(`login-id:${email}`);
  await (await rows()).updateOne({ _id: NS + `login-ip:${ip}`, count: { $gt: 0 } }, { $inc: { count: -1 } });
}
export const isLocked = (email) => blocked(`login-id:${email}`, LOGIN_MAX_PER_EMAIL);
export const unlockLogin = (email) => forgive(`login-id:${email}`); // platform team's "unlock" button

// In-memory fixed window for the public page reads (120 a minute per visitor): cheap, and fine if it resets.
const local = new Map();
export function tooManyLocal(key, max, windowMs) {
  const now = Date.now();
  const b = local.get(key);
  if (!b || now >= b.resetAt) { local.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  b.count += 1;
  return b.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of local) if (now >= b.resetAt) local.delete(k);
}, 60_000).unref();

// Tests only: forget this process's counters.
export async function clearRateLimits() {
  local.clear();
  await (await rows()).deleteMany(NS ? { _id: { $regex: `^${NS}` } } : {});
}
