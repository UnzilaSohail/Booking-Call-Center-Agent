// Recording retention sweep (ROADMAP.md §7 "Recording retention settings", plan.md §11
// item 5). Same interval-poller shape as src/notifications/reminder-worker.js — retention
// volume never needs more than "check every so often." Nulls out the sensitive parts of
// an old call (recording, transcript) but keeps outcome/duration/booking-link/summary so
// reporting still works after the raw recording is gone.
import twilio from 'twilio';
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

// Twilio keeps a recording (billed, unreferenced) until told to delete it; clearing our own row alone left the audio there.
async function deleteTwilioRecording(recordingSid) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio is not configured');
  await twilio(sid, token).recordings(recordingSid).remove();
}

// `deleteRecording` is injectable for tests. A recording is only forgotten here once Twilio confirmed it is gone
// (or says it never existed, 404); on any other failure the sid stays so the next hourly sweep retries.
export async function runRetentionSweepOnce({ deleteRecording = deleteTwilioRecording } = {}) {
  const businesses = await businessesWithRetention();
  for (const business of businesses) {
    try {
      const old = { created_at: { $lt: cutoffDate(business.recording_retention_days) } };
      const withAudio = await withTenant(business._id, (c) => c('call_logs').find({ ...old, recording_sid: { $ne: null } }, { projection: { recording_sid: 1 } }).toArray());
      const deleted = [];
      for (const row of withAudio) {
        try {
          await deleteRecording(row.recording_sid);
          deleted.push(row._id);
        } catch (err) {
          if (err.status === 404) deleted.push(row._id);
          else console.error(`could not delete recording ${row.recording_sid} at Twilio:`, err.message);
        }
      }
      await withTenant(business._id, async (c) => {
        if (deleted.length) await c('call_logs').updateMany({ _id: { $in: deleted } }, { $set: { recording_url: null, recording_sid: null } });
        await c('call_logs').updateMany({ ...old, transcript: { $ne: null } }, { $set: { transcript: null } });
        await c('call_logs').updateMany({ ...old, recording_sid: null, recording_url: { $ne: null } }, { $set: { recording_url: null } });
      });
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
