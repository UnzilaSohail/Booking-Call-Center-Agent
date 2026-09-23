// Pure logic, no MongoDB needed — mirrors test/customerLink.test.js.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signInviteToken, verifyInviteToken } from '../src/teamInvite.js';

test('round-trips the admin id', () => {
  const token = signInviteToken('admin-1');
  assert.deepEqual(verifyInviteToken(token), { adminId: 'admin-1' });
});

test('rejects a tampered token', () => {
  const token = signInviteToken('admin-1');
  const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.equal(verifyInviteToken(tampered), null);
});

test('rejects garbage input instead of throwing', () => {
  assert.equal(verifyInviteToken('not-a-real-token'), null);
  assert.equal(verifyInviteToken(''), null);
});

test('rejects an already-expired token', () => {
  const expired = jwt.sign({ adminId: 'admin-1', purpose: 'team-invite' }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal(verifyInviteToken(expired), null);
});

test('rejects a token with the wrong purpose', () => {
  const wrongPurpose = jwt.sign({ adminId: 'admin-1', purpose: 'manage-booking' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  assert.equal(verifyInviteToken(wrongPurpose), null);
});
