// Backup files are encrypted (AES-256-GCM) so a copied or leaked archive is not a copy of every customer's data.
// File layout: 12 bytes IV, the encrypted archive, then the 16-byte authentication tag (a changed byte makes the restore fail).
// Key: BACKUP_ENCRYPTION_KEY, or ENCRYPTION_KEY when that one is not set (32 bytes, base64). Keep a copy of the key
// away from the backups: without it they cannot be opened.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, openSync, readSync, closeSync, statSync } from 'node:fs';
import { Transform } from 'node:stream';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function backupKey(env = process.env) {
  const raw = env.BACKUP_ENCRYPTION_KEY || env.ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== 32) throw new Error('set BACKUP_ENCRYPTION_KEY (or ENCRYPTION_KEY): 32 random bytes, base64');
  return key;
}

export function encryptStream(key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = new Transform({
    transform(chunk, _enc, cb) { cb(null, cipher.update(chunk)); },
    flush(cb) { cipher.final(); this.push(cipher.getAuthTag()); cb(); },
  });
  out.push(iv);
  return out;
}

// A readable stream of the decrypted archive; it errors at the end if the file was changed.
export function decryptFile(path, key) {
  const size = statSync(path).size;
  if (size < IV_BYTES + TAG_BYTES) throw new Error('not an encrypted backup (too short)');
  const fd = openSync(path, 'r');
  const iv = Buffer.alloc(IV_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    readSync(fd, iv, 0, IV_BYTES, 0);
    readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    closeSync(fd);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return createReadStream(path, { start: IV_BYTES, end: size - TAG_BYTES - 1 }).pipe(decipher);
}
