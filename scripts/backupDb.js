// Backup and recovery (ROADMAP.md §12, plan.md §11 item 11) — wraps mongodump, the
// database's own backup tool, rather than a hand-rolled per-collection JSON export.
// Requires the MongoDB Database Tools installed (mongodump on PATH).
//
// Usage: npm run backup-db
// Writes backups/<timestamp>.gz.enc, an ENCRYPTED archive (scripts/backupCrypto.js says which key) — schedule this
// with cron/Task Scheduler if you want it automatic; this script itself just runs once and exits.
// The database address (it holds the password) is handed to mongodump in a temporary private file, not on the
// command line, where any user on the machine could read it in the process list.
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { backupKey, encryptStream } from './backupCrypto.js';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB_NAME || 'booking_call_center';
const backupDir = fileURLToPath(new URL('../backups', import.meta.url));
mkdirSync(backupDir, { recursive: true });

let key;
try {
  key = backupKey();
} catch (err) {
  console.error(`refusing to write an unencrypted backup: ${err.message}`);
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const archivePath = `${backupDir}/${timestamp}.gz.enc`;

const secretDir = mkdtempSync(join(tmpdir(), 'backup-'));
const configPath = join(secretDir, 'mongo.yaml');
writeFileSync(configPath, `uri: ${JSON.stringify(uri)}\n`, { mode: 0o600 });

let failed = false;
try {
  const dump = spawn('mongodump', [`--config=${configPath}`, '--db', dbName, '--archive', '--gzip'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((resolve, reject) => { dump.on('error', reject); dump.on('close', resolve); });
  await Promise.all([pipeline(dump.stdout, encryptStream(key), createWriteStream(archivePath, { mode: 0o600 })), exited.then((code) => { if (code) throw new Error(`mongodump exited with ${code}`); })]);
  console.log(`backup written: ${archivePath}`);
} catch (err) {
  failed = true;
  rmSync(archivePath, { force: true }); // never leave a partial backup that looks real
  console.error(err.code === 'ENOENT' ? 'mongodump not found — install the MongoDB Database Tools: https://www.mongodb.com/docs/database-tools/' : `backup failed: ${err.message}`);
} finally {
  rmSync(secretDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
