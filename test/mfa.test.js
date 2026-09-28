import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecret, totp, verifyTotp, otpauthUrl } from '../src/mfa.js';

test('generateSecret produces a base32 string', () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
});

test('verifyTotp accepts the code totp() just generated', () => {
  const secret = generateSecret();
  const code = totp(secret);
  assert.equal(verifyTotp(secret, code), true);
});

test('verifyTotp rejects a wrong code', () => {
  const secret = generateSecret();
  assert.equal(verifyTotp(secret, '000000'), false);
});

test('verifyTotp rejects malformed input instead of throwing', () => {
  const secret = generateSecret();
  assert.equal(verifyTotp(secret, 'abcdef'), false);
  assert.equal(verifyTotp(secret, ''), false);
  assert.equal(verifyTotp(secret, undefined), false);
});

test('verifyTotp tolerates the adjacent time step', () => {
  const secret = generateSecret();
  const code = totp(secret, Date.now() - 30_000);
  assert.equal(verifyTotp(secret, code), true);
});

test('otpauthUrl embeds the issuer and secret', () => {
  const url = otpauthUrl('owner@example.com', 'Booking', 'ABCDEFGH');
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.match(url, /secret=ABCDEFGH/);
});
