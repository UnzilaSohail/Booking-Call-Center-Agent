// TOTP (RFC 6238), the same algorithm every authenticator app (Google Authenticator,
// Authy, 1Password, ...) already implements — node:crypto's HMAC is enough to generate
// and verify codes, no otplib/speakeasy dependency needed. Pure functions, no DB access,
// so they're unit-testable without MongoDB (test/mfa.test.js).
import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160-bit, the size every TOTP spec assumes
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function totp(secret, time = Date.now()) {
  return hotp(secret, Math.floor(time / STEP_MS));
}

// window=1 tolerates the caller's clock (or the 30s step boundary) being one tick off
// either way — the standard tolerance, otherwise a code typed a second too late fails.
export function verifyTotp(secret, token, window = 1) {
  if (!/^\d{6}$/.test(token || '')) return false;
  const counter = Math.floor(Date.now() / STEP_MS);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i) === token) return true;
  }
  return false;
}

// otpauth:// URI — every authenticator app can add an account from this string (typed
// manually or via a QR code generated from it elsewhere); no QR image rendered here.
export function otpauthUrl(email, issuer, secret) {
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
