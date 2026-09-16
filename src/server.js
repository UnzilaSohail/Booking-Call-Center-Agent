import 'dotenv/config';
import { createServer } from 'node:http';
import { app } from './app.js';
import { attachTwilioMediaStreamServer } from './voice/twilioBridge.js';
import { startSyncWorker } from './calendar/sync-worker.js';
import { startReminderWorker } from './notifications/reminder-worker.js';

const port = process.env.PORT || 3000;

const httpServer = createServer(app);
attachTwilioMediaStreamServer(httpServer, '/voice/stream'); // plan.md §8 phase 4

httpServer.listen(port, () => console.log(`listening on :${port}`));

// plan.md §8 phases 3 & 5 — both are simple interval pollers, not a separate worker
// process, since booking volume at this stage doesn't justify a real job queue (plan.md §8).
const stopSyncWorker = startSyncWorker();
const stopReminderWorker = startReminderWorker();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopSyncWorker();
    stopReminderWorker();
    httpServer.close(() => process.exit(0));
  });
}
