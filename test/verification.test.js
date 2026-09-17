// Pure logic, no MongoDB needed — unlike test/booking.test.js this never skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, verifyCode } from '../src/verification.js';

test('generateCode produces a 6-digit numeric string', () => {
  const code = generateCode();
  assert.match(code, /^\d{6}$/);
});

test('verifyCode round-trips a matching code', async () => {
  const code = generateCode();
  const hash = await hashCode(code);
  const future = new Date(Date.now() + 60_000);
  assert.equal(await verifyCode(code, hash, future), true);
});

test('verifyCode rejects a wrong code', async () => {
  const hash = await hashCode('123456');
  const future = new Date(Date.now() + 60_000);
  assert.equal(await verifyCode('000000', hash, future), false);
});

test('verifyCode rejects an expired code', async () => {
  const code = '123456';
  const hash = await hashCode(code);
  const past = new Date(Date.now() - 1000);
  assert.equal(await verifyCode(code, hash, past), false);
});
