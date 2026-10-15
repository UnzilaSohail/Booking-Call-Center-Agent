// AIN-479: backup archives are encrypted and a changed or wrongly-keyed file is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, createWriteStream, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { backupKey, encryptStream, decryptFile } from '../scripts/backupCrypto.js';

const read = async (stream) => { const parts = []; for await (const c of stream) parts.push(c); return Buffer.concat(parts); };

async function makeBackup(key, data) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const path = join(dir, 'a.gz.enc');
  await pipeline(Readable.from([data.subarray(0, 1000), data.subarray(1000)]), encryptStream(key), createWriteStream(path));
  return { dir, path };
}

test('an encrypted backup opens with the key, is not readable without it, and a changed byte is refused', async () => {
  const key = randomBytes(32);
  const data = randomBytes(5000);
  const { dir, path } = await makeBackup(key, data);
  try {
    const onDisk = readFileSync(path);
    assert.ok(!onDisk.includes(data.subarray(100, 140)), 'the archive text is not on disk in the clear');
    assert.deepEqual(await read(decryptFile(path, key)), data);
    await assert.rejects(read(decryptFile(path, randomBytes(32))), 'wrong key');
    onDisk[500] ^= 1;
    writeFileSync(path, onDisk);
    await assert.rejects(read(decryptFile(path, key)), 'tampered file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a backup refuses to run without a usable key', () => {
  assert.throws(() => backupKey({}), /BACKUP_ENCRYPTION_KEY/);
  assert.throws(() => backupKey({ ENCRYPTION_KEY: Buffer.alloc(8).toString('base64') }), /32 random bytes/);
  assert.equal(backupKey({ ENCRYPTION_KEY: randomBytes(32).toString('base64') }).length, 32);
});
