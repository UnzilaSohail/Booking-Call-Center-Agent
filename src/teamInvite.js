// Signed, unauthenticated links a newly-invited team member uses to set their own
// password (ROADMAP.md §10). Same short-lived-signed-JWT pattern src/customerLink.js
// already uses for manage-booking links.
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const INVITE_LIFETIME_DAYS = 7;

export function signInviteToken(adminId) {
  return jwt.sign({ adminId, purpose: 'team-invite' }, JWT_SECRET, { expiresIn: `${INVITE_LIFETIME_DAYS}d` });
}

// Returns { adminId } or null (invalid/expired/tampered) — never throws, so route
// handlers can treat every failure mode the same way.
export function verifyInviteToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.purpose !== 'team-invite') return null;
    return { adminId: payload.adminId };
  } catch {
    return null;
  }
}
