// Restore side of scripts/backupDb.js — wraps mongorestore against a .gz archive it
// produced. Requires the MongoDB Database Tools installed (mongorestore on PATH).
//
// Usage: npm run restore-db -- backups/2026-09-25T12-00-00-000Z.gz
import { spawnSync } from 'node:child_process';
import 'dotenv/config';

const archivePath = process.argv[2];
if (!archivePath) {
  console.error('usage: npm run restore-db -- <path-to-archive.gz>');
  process.exit(1);
}

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';

// --drop replaces existing collections with the archive's contents rather than merging —
// the standard "restore means restore," not an accretive import.
const result = spawnSync('mongorestore', ['--uri', uri, '--archive', archivePath, '--gzip', '--drop'], { stdio: 'inherit' });
if (result.error) {
  console.error('mongorestore not found — install the MongoDB Database Tools: https://www.mongodb.com/docs/database-tools/');
  process.exit(1);
}
process.exit(result.status ?? 0);
