// Pure logic, no MongoDB needed.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signManageToken, verifyManageToken } from '../src/customerLink.js';

test('round-trips businessId/bookingId', () => {
  const futureStart = new Date(Date.now() + 60 * 60_000).toISOString();
  const token = signManageToken('biz-1', 'booking-1', futureStart);
  const claims = verifyManageToken(token);
  assert.deepEqual(claims, { businessId: 'biz-1', bookingId: 'booking-1' });
});

test('rejects a tampered token', () => {
  const futureStart = new Date(Date.now() + 60 * 60_000).toISOString();
  const token = signManageToken('biz-1', 'booking-1', futureStart);
  const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.equal(verifyManageToken(tampered), null);
});

test('rejects garbage input instead of throwing', () => {
  assert.equal(verifyManageToken('not-a-real-token'), null);
  assert.equal(verifyManageToken(''), null);
});

test('rejects an already-expired token', () => {
  const expired = jwt.sign({ businessId: 'biz-1', bookingId: 'booking-1', purpose: 'manage-booking' }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal(verifyManageToken(expired), null);
});

test('rejects a token with the wrong purpose (e.g. a different signed token in this app)', () => {
  const wrongPurpose = jwt.sign({ businessId: 'biz-1', bookingId: 'booking-1', purpose: 'calendar-connect' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  assert.equal(verifyManageToken(wrongPurpose), null);
});

test('a booking starting soon gets a short-lived token, not the full 30-day max', () => {
  const soon = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 minutes out
  const token = signManageToken('biz-1', 'booking-1', soon);
  const decoded = jwt.decode(token);
  const lifetimeSeconds = decoded.exp - decoded.iat;
  assert.ok(lifetimeSeconds < 10 * 60, `expected a short lifetime, got ${lifetimeSeconds}s`);
});
