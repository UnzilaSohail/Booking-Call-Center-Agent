// Restore side of scripts/backupDb.js — wraps mongorestore against an archive it produced
// (.gz.enc, decrypted on the way in; an older plain .gz still works). Requires the MongoDB Database Tools (mongorestore on PATH).
//
// Usage: npm run restore-db -- backups/2026-09-25T12-00-00-000Z.gz.enc
import { spawn } from 'node:child_process';
import { createReadStream, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';
import { backupKey, decryptFile } from './backupCrypto.js';

const archivePath = process.argv[2];
if (!archivePath) {
  console.error('usage: npm run restore-db -- <path-to-archive.gz.enc>');
  process.exit(1);
}

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const encrypted = archivePath.endsWith('.enc');
let source;
try {
  source = encrypted ? decryptFile(archivePath, backupKey()) : createReadStream(archivePath);
} catch (err) {
  console.error(`cannot open the backup: ${err.message}`);
  process.exit(1);
}

// The address goes in a temporary private file, not on the command line (see scripts/backupDb.js).
const secretDir = mkdtempSync(join(tmpdir(), 'restore-'));
const configPath = join(secretDir, 'mongo.yaml');
writeFileSync(configPath, `uri: ${JSON.stringify(uri)}\n`, { mode: 0o600 });

let failed = false;
try {
  // --drop replaces existing collections with the archive's contents rather than merging —
  // the standard "restore means restore," not an accretive import.
  const restore = spawn('mongorestore', [`--config=${configPath}`, '--archive', '--gzip', '--drop'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = new Promise((resolve, reject) => { restore.on('error', reject); restore.on('close', resolve); });
  await Promise.all([pipeline(source, restore.stdin), exited.then((code) => { if (code) throw new Error(`mongorestore exited with ${code}`); })]);
  console.log('restore finished');
} catch (err) {
  failed = true;
  console.error(err.code === 'ENOENT' ? 'mongorestore not found — install the MongoDB Database Tools: https://www.mongodb.com/docs/database-tools/' : `restore failed: ${err.message}`);
} finally {
  rmSync(secretDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
