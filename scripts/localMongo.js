// Local dev convenience only — NOT for production. Starts a real MongoDB replica set
// (via mongodb-memory-server) on a fixed port so MONGODB_URI in .env never has to
// change, and keeps it alive until this process is stopped (Ctrl+C).
//
// Usage: npm run local-db
// Then in .env: MONGODB_URI=mongodb://127.0.0.1:27117/?replicaSet=rs0
//
// Data lives in .local_mongo_data/ (gitignored) and survives restarts of this script,
// but not a full environment reset — this is for trying the app out locally, not for
// anything you need to keep. Use MongoDB Atlas (or your own server) for that.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const PORT = 27117;
const DB_PATH = fileURLToPath(new URL('../.local_mongo_data', import.meta.url));
mkdirSync(DB_PATH, { recursive: true });

const rs = await MongoMemoryReplSet.create({
  replSet: { count: 1, name: 'rs0' },
  instanceOpts: [{ port: PORT, dbPath: DB_PATH, storageEngine: 'wiredTiger' }],
});

console.log(`local MongoDB ready: ${rs.getUri()}`);
console.log('set MONGODB_URI to that in .env, then npm run migrate');
console.log('press Ctrl+C to stop');

process.on('SIGINT', async () => { await rs.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await rs.stop(); process.exit(0); });
