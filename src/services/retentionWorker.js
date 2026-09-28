// Recording retention sweep (ROADMAP.md §7 "Recording retention settings", plan.md §11
// item 5). Same interval-poller shape as src/notifications/reminder-worker.js — retention
// volume never needs more than "check every so often." Nulls out the sensitive parts of
// an old call (recording, transcript) but keeps outcome/duration/booking-link/summary so
// reporting still works after the raw recording is gone.
import { withSystemAccess, withTenant } from '../db.js';

const WORKER_INTERVAL_MS = 60 * 60_000; // hourly is plenty for a day-granularity setting

// Exported for testing — pure date math, no I/O.
export function cutoffDate(retentionDays, now = new Date()) {
  return new Date(now.getTime() - retentionDays * 86_400_000);
}

// Cross-tenant by nature — sweeps every business with a retention window set (see
// withSystemAccess in src/db.js).
async function businessesWithRetention() {
  return withSystemAccess((c) => c('businesses').find({ recording_retention_days: { $gt: 0 } }, { projection: { recording_retention_days: 1 } }).toArray());
}

export async function runRetentionSweepOnce() {
  const businesses = await businessesWithRetention();
  for (const business of businesses) {
    try {
      const cutoff = cutoffDate(business.recording_retention_days);
      await withTenant(business._id, (c) => c('call_logs').updateMany(
        { created_at: { $lt: cutoff }, $or: [{ recording_url: { $ne: null } }, { transcript: { $ne: null } }] },
        { $set: { recording_url: null, recording_sid: null, transcript: null } }
      ));
    } catch (err) {
      console.error(`retention sweep failed for business ${business._id}:`, err.message);
    }
  }
}

export function startRetentionWorker(intervalMs = WORKER_INTERVAL_MS) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runRetentionSweepOnce();
    } catch (err) {
      console.error('retention worker tick failed:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
