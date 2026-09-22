// Pure logic, no MongoDB needed — resolveTransferTarget is given already-resolved
// staff/location documents, not names, so no DB access of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTransferTarget } from '../src/voice/tools.js';

const business = {
  transfer_phone_number: '+15550000001',
  transfer_departments: [{ name: 'Billing', phoneNumber: '+15550000002' }],
};
const staff = { phone: '+15550000003' };
const location = { contact_phone: '+15550000004' };

test('department match wins over everything else', () => {
  const result = resolveTransferTarget(business, { department: 'billing', staff, location });
  assert.equal(result.phoneNumber, '+15550000002');
  assert.equal(result.matchedBy, 'department');
});

test('department name matching is case-insensitive', () => {
  const result = resolveTransferTarget(business, { department: 'BILLING' });
  assert.equal(result.phoneNumber, '+15550000002');
});

test('unmatched department falls through to staff', () => {
  const result = resolveTransferTarget(business, { department: 'Nonexistent', staff, location });
  assert.equal(result.phoneNumber, '+15550000003');
  assert.equal(result.matchedBy, 'staff');
});

test('staff phone wins over location when no department given', () => {
  const result = resolveTransferTarget(business, { staff, location });
  assert.equal(result.phoneNumber, '+15550000003');
  assert.equal(result.matchedBy, 'staff');
});

test('location contact phone wins over business default', () => {
  const result = resolveTransferTarget(business, { location });
  assert.equal(result.phoneNumber, '+15550000004');
  assert.equal(result.matchedBy, 'location');
});

test('falls back to business-wide transfer number when nothing else matches', () => {
  const result = resolveTransferTarget(business, {});
  assert.equal(result.phoneNumber, '+15550000001');
  assert.equal(result.matchedBy, 'business');
});

test('returns null when nothing is configured at all', () => {
  const result = resolveTransferTarget({}, {});
  assert.equal(result, null);
});
