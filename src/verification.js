// OTP codes for email/phone verification during signup and onboarding
// (src/routes/signup.js, src/routes/onboarding.js). Pure functions, no DB access, so
// they're unit-testable without a running MongoDB (test/verification.test.js).
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs'; // already a dependency — no new hashing library for this

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(code) {
  return bcrypt.hash(code, 10);
}

export async function verifyCode(code, hash, expiresAt) {
  if (!hash || !expiresAt || new Date(expiresAt) < new Date()) return false;
  return bcrypt.compare(code, hash);
}

// Costs the same as a real check; call it when there is nobody to check against, so "no such person" and "wrong
// code" take equally long and the response time does not reveal who is on file.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);
export const fakeVerify = (code) => bcrypt.compare(String(code), DUMMY_HASH).then(() => false);
