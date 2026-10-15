// AIN-512: crypto.js had no test at all. It guards the Google tokens and the authenticator secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { encrypt, decrypt } = await import('../src/crypto.js');

test('encrypt then decrypt returns the text, and the same text encrypts differently each time', () => {
  const text = 'refresh-token-1/abc DEF_ghi ünïcödé';
  const a = encrypt(text);
  const b = encrypt(text);
  assert.notEqual(a, b, 'a fresh IV every time');
  assert.ok(!a.includes('refresh-token'));
  assert.equal(decrypt(a), text);
  assert.equal(decrypt(b), text);
});

test('a changed or truncated value is refused, not decrypted to garbage', () => {
  const sealed = Buffer.from(encrypt('secret'), 'base64');
  const flipped = Buffer.from(sealed); flipped[flipped.length - 1] ^= 1;
  assert.throws(() => decrypt(flipped.toString('base64')));
  assert.throws(() => decrypt(sealed.subarray(0, 20).toString('base64')));
  assert.throws(() => decrypt(''));
});
