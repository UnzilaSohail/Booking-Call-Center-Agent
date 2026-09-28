// Backup and recovery (ROADMAP.md §12, plan.md §11 item 11) — wraps mongodump, the
// database's own backup tool, rather than a hand-rolled per-collection JSON export.
// Requires the MongoDB Database Tools installed (mongodump on PATH).
//
// Usage: npm run backup-db
// Writes backups/<timestamp>.gz — schedule this with cron/Task Scheduler if you want it
// automatic; this script itself just runs once and exits.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB_NAME || 'booking_call_center';
const backupDir = fileURLToPath(new URL('../backups', import.meta.url));
mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const archivePath = `${backupDir}/${timestamp}.gz`;

const result = spawnSync('mongodump', ['--uri', uri, '--db', dbName, '--archive', archivePath, '--gzip'], { stdio: 'inherit' });
if (result.error) {
  console.error('mongodump not found — install the MongoDB Database Tools: https://www.mongodb.com/docs/database-tools/');
  process.exit(1);
}
process.exit(result.status ?? 0);
