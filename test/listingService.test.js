// Pure logic, no MongoDB needed. Jira 16b/16c/16j — docs/plans/PLAN_1_CUSTOMER.md §1A.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isListingEligible, isListed } from '../src/services/listingService.js';

const readyBusiness = { onboarding_completed_at: new Date(), status: 'active', hours: [{ day_of_week: 1, open_time: '09:00', close_time: '17:00' }] };

test('a business with go-live, active status, a service and hours is eligible', () => {
  assert.equal(isListingEligible(readyBusiness, { serviceCount: 1 }), true);
});

test('missing go-live, no services, or no hours each block eligibility', () => {
  assert.equal(isListingEligible({ ...readyBusiness, onboarding_completed_at: null }, { serviceCount: 1 }), false);
  assert.equal(isListingEligible(readyBusiness, { serviceCount: 0 }), false);
  assert.equal(isListingEligible({ ...readyBusiness, hours: [] }, { serviceCount: 1 }), false);
});

test('a suspended business is never eligible even if otherwise ready', () => {
  assert.equal(isListingEligible({ ...readyBusiness, status: 'suspended' }, { serviceCount: 1 }), false);
});

test('isListed requires the owner opt-in on top of eligibility', () => {
  assert.equal(isListed({ ...readyBusiness, listing: { listed: false } }, { serviceCount: 1 }), false, 'opted out by default');
  assert.equal(isListed({ ...readyBusiness, listing: { listed: true } }, { serviceCount: 1 }), true);
  assert.equal(isListed({ ...readyBusiness }, { serviceCount: 1 }), false, 'no listing field at all = not listed');
});

test('a platform-hidden listing never shows even if opted in and eligible', () => {
  assert.equal(isListed({ ...readyBusiness, listing: { listed: true, hidden_by_platform: true } }, { serviceCount: 1 }), false);
});
