// Pure logic, no MongoDB needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, areasFor, hasArea } from '../src/permissions.js';

test('owner and manager get every area', () => {
  assert.deepEqual(areasFor({ role: 'owner' }), AREAS);
  assert.deepEqual(areasFor({ role: 'manager' }), AREAS);
});

test('receptionist gets front-desk areas only', () => {
  const areas = areasFor({ role: 'receptionist' });
  assert.deepEqual([...areas].sort(), ['bookings', 'calls', 'customers', 'exceptions'].sort());
  assert.equal(hasArea({ role: 'receptionist' }, 'settings'), false);
});

test('staff gets bookings and calls only', () => {
  assert.deepEqual([...areasFor({ role: 'staff' })].sort(), ['bookings', 'calls'].sort());
  assert.equal(hasArea({ role: 'staff' }, 'team'), false);
});

test('billing role grants nothing yet (§11 not built)', () => {
  assert.deepEqual(areasFor({ role: 'billing' }), []);
});

test('custom role uses its own permissions array, not a fixed set', () => {
  const admin = { role: 'custom', permissions: ['bookings', 'exceptions'] };
  assert.deepEqual(areasFor(admin), ['bookings', 'exceptions']);
  assert.equal(hasArea(admin, 'settings'), false);
  assert.equal(hasArea(admin, 'bookings'), true);
});

test('a role-less admin (pre-migration doc) resolves to full owner access', () => {
  assert.deepEqual(areasFor({}), AREAS);
});
