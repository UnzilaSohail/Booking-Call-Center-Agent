import 'dotenv/config';
import { createServer } from 'node:http';
import { app } from './app.js';
import { attachTwilioMediaStreamServer, beginDrain, getActiveCalls } from './voice/twilioBridge.js';
import { startSyncWorker } from './calendar/sync-worker.js';
import { startReminderWorker } from './notifications/reminder-worker.js';
import { startRetentionWorker } from './services/retentionWorker.js';
import { startBillingWorker } from './billing/worker.js';

const port = process.env.PORT || 3000;

const httpServer = createServer(app);
attachTwilioMediaStreamServer(httpServer, '/voice/stream'); // plan.md §8 phase 4

httpServer.listen(port, () => console.log(`listening on :${port}`));

// plan.md §8 phases 3 & 5 — both are simple interval pollers, not a separate worker
// process, since booking volume at this stage doesn't justify a real job queue (plan.md §8).
const stopSyncWorker = startSyncWorker();
const stopReminderWorker = startReminderWorker();
const stopRetentionWorker = startRetentionWorker();
const stopBillingWorker = startBillingWorker();

// 27l: on a restart signal stop the workers, refuse NEW calls politely, and let calls already in
// progress finish (up to DRAIN_TIMEOUT_MS) before exiting. A second signal exits immediately.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    stopSyncWorker();
    stopReminderWorker();
    stopRetentionWorker();
    stopBillingWorker();
    const active = getActiveCalls();
    if (active) console.log(`${signal}: waiting for ${active} active call(s) to finish before exiting`);
    const clean = await beginDrain();
    if (!clean) console.warn(`drain timed out with ${getActiveCalls()} call(s) still active, exiting anyway`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref(); // open sockets must not hold the exit
  });
}
