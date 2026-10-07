// Bot check on the doors anyone can use (Jira AIN-433): Cloudflare Turnstile, the free "are you a person" check.
// The page shows a small widget; the visitor's browser gets a one-time token; here we ask Cloudflare whether it is real.
//
//   TURNSTILE_SECRET_KEY            (backend .env)         the private key. Unset = check switched off (local dev, tests).
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY  (dashboard env, build) the public key. Both must be set together.
//
// If Cloudflare itself cannot be reached we let the visitor through (and log it): a short Cloudflare outage must not stop
// real customers booking. The other limits (per address, per phone, honeypot) still apply.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const turnstileEnabled = () => Boolean(process.env.TURNSTILE_SECRET_KEY);

export async function verifyTurnstile(token, ip, { fetchImpl = fetch } = {}) {
  if (!turnstileEnabled()) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    return (await res.json()).success === true;
  } catch (err) {
    console.error('Turnstile check could not reach Cloudflare, letting the visitor through:', err.message);
    return true;
  }
}

// Express helper: answers 400 and returns false when the check fails.
export async function requireHuman(req, res) {
  if (await verifyTurnstile(req.body?.turnstileToken, req.ip)) return true;
  res.status(400).json({ error: 'Please tick the "I am human" box and try again.', captcha: true });
  return false;
}
