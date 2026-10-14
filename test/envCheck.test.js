import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingProductionSettings } from '../src/envCheck.js';

test('production lists every missing setting; other environments list none', () => {
  assert.deepEqual(missingProductionSettings({ NODE_ENV: 'development' }), []);
  const all = missingProductionSettings({ NODE_ENV: 'production' });
  assert.ok(all.includes('TWILIO_AUTH_TOKEN') && all.includes('PUBLIC_WSS_URL') && all.includes('STRIPE_WEBHOOK_SECRET'));
  const full = Object.fromEntries(all.map((n) => [n, 'x']));
  assert.deepEqual(missingProductionSettings({ NODE_ENV: 'production', ...full }), []);
  assert.deepEqual(missingProductionSettings({ NODE_ENV: 'production', ...full, TWILIO_AUTH_TOKEN: '' }), ['TWILIO_AUTH_TOKEN']);
});
