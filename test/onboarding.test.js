// Pure logic, no MongoDB needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOnboardingStatus } from '../src/routes/onboarding.js';

const bareBusiness = { google_refresh_token: null, phone_number: null, faqs: [], voice_name: null, test_call_at: null, onboarding_completed_at: null };
const bareAdmin = { email_verified_at: null, phone_verified_at: null };

test('nothing done: all required steps outstanding, not ready to go live', () => {
  const { steps, requiredRemaining, readyForGoLive } = computeOnboardingStatus(bareBusiness, bareAdmin, { services: 0, staff: 0 });
  assert.equal(steps.every((s) => !s.done), true);
  assert.deepEqual(requiredRemaining, ['verify_contact', 'services', 'phone_number', 'test_call']);
  assert.equal(readyForGoLive, false);
});

test('skippable steps (staff, calendar, knowledge base) never block go-live readiness', () => {
  const business = { ...bareBusiness, phone_number: '+15551234567', test_call_at: new Date() };
  const admin = { email_verified_at: new Date(), phone_verified_at: new Date() };
  const { requiredRemaining, readyForGoLive } = computeOnboardingStatus(business, admin, { services: 1, staff: 0 });
  assert.deepEqual(requiredRemaining, []);
  assert.equal(readyForGoLive, true);
});

test('everything set: every step reads done', () => {
  const business = {
    google_refresh_token: 'x', phone_number: '+15551234567', faqs: [{ question: 'q', answer: 'a' }],
    voice_name: 'Kore', test_call_at: new Date(), onboarding_completed_at: new Date(),
  };
  const admin = { email_verified_at: new Date(), phone_verified_at: new Date() };
  const { steps } = computeOnboardingStatus(business, admin, { services: 2, staff: 1 });
  assert.equal(steps.every((s) => s.done), true);
});

// The dashboard needs this to show "email done, phone still needed" instead of looking
// like confirming a code did nothing when only one of the two channels is verified yet.
test('emailVerified/phoneVerified are reported individually, not just the combined step', () => {
  const emailOnly = computeOnboardingStatus(bareBusiness, { email_verified_at: new Date(), phone_verified_at: null }, { services: 0, staff: 0 });
  assert.equal(emailOnly.emailVerified, true);
  assert.equal(emailOnly.phoneVerified, false);
  assert.equal(emailOnly.steps.find((s) => s.key === 'verify_contact').done, false, 'the combined step still needs both');
});
