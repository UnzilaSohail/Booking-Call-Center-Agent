import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyStripeSignature } from '../src/webhooks/stripe.js';

function sign(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

test('verifyStripeSignature accepts a correctly signed payload', () => {
  const secret = 'whsec_test';
  const payload = JSON.stringify({ type: 'payment_intent.payment_failed' });
  assert.equal(verifyStripeSignature(payload, sign(payload, secret), secret), true);
});

test('verifyStripeSignature rejects a tampered payload', () => {
  const secret = 'whsec_test';
  const payload = JSON.stringify({ type: 'payment_intent.payment_failed' });
  const header = sign(payload, secret);
  assert.equal(verifyStripeSignature(payload + 'x', header, secret), false);
});

test('verifyStripeSignature rejects the wrong secret', () => {
  const payload = JSON.stringify({ type: 'payment_intent.payment_failed' });
  const header = sign(payload, 'whsec_real');
  assert.equal(verifyStripeSignature(payload, header, 'whsec_other'), false);
});

test('verifyStripeSignature rejects a stale timestamp', () => {
  const secret = 'whsec_test';
  const payload = JSON.stringify({ type: 'payment_intent.payment_failed' });
  const staleHeader = sign(payload, secret, Math.floor(Date.now() / 1000) - 3600);
  assert.equal(verifyStripeSignature(payload, staleHeader, secret), false);
});

test('verifyStripeSignature rejects missing header or secret', () => {
  assert.equal(verifyStripeSignature('{}', null, 'whsec_test'), false);
  assert.equal(verifyStripeSignature('{}', 't=1,v1=abc', null), false);
});
