// A restart or crash in the middle of a call leaves call_logs.outcome = 'in_progress' forever: the call shows as live
// on the dashboard and has no end time. The bridge hangs up every call after 15 minutes at most, so a call still
// 'in_progress' after 30 minutes cannot be live any more. It is closed as interrupted (our fault, so no duration is
// recorded and it is not billed). Runs once at start-up and then every 10 minutes.
import { withSystemAccess } from '../db.js';

const STALE_AFTER_MS = 30 * 60_000;
const EVERY_MS = 10 * 60_000;

export async function closeStaleCalls({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const res = await withSystemAccess((c) => c('call_logs').updateMany(
    { outcome: 'in_progress', created_at: { $lt: cutoff } },
    { $set: { outcome: 'failed: interrupted', ended_at: now } },
  ));
  return res.modifiedCount;
}

export function startStaleCallWorker() {
  const tick = () => closeStaleCalls().then((n) => { if (n) console.log(`closed ${n} call(s) left in progress by a restart`); }, (err) => console.error('stale call sweep failed:', err));
  tick();
  const timer = setInterval(tick, EVERY_MS);
  return () => clearInterval(timer);
}
