// Cron-style poller (ROADMAP.md §11), same shape as src/notifications/reminder-worker.js
// — a plain interval rather than a queue, since closing billing periods never needs
// more than "check every so often."
import { withSystemAccess, serialize } from '../db.js';
import { closeBillingPeriod } from '../services/billingService.js';

export async function runBillingSweepOnce() {
  const now = new Date();
  const due = await withSystemAccess((c) =>
    c('businesses').find({ current_period_end: { $lte: now } }).limit(100).toArray()
  );
  for (const raw of due) {
    try {
      await closeBillingPeriod(serialize(raw));
    } catch (err) {
      console.error(`billing close failed for business ${raw._id}:`, err.message);
    }
  }
  return due.length;
}

export function startBillingWorker(intervalMs = 60 * 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runBillingSweepOnce();
    } catch (err) {
      console.error('billing worker tick failed:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
