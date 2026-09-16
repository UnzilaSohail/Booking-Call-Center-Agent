// Encrypts per-tenant Google OAuth refresh tokens at rest (plan.md §7 — they grant
// calendar access, so they're stored as ciphertext, not plaintext, in `businesses`).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Lazy: only resolved the first time a business actually connects Google Calendar, so
// the server can still boot (and every non-calendar feature still works) without
// ENCRYPTION_KEY set yet.
let cachedKey = null;
function loadKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set (32 bytes, base64)');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  return (cachedKey = key);
}

// AES-256-GCM, output as base64(iv || authTag || ciphertext).
export function encrypt(plaintext) {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decrypt(payload) {
  const key = loadKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
