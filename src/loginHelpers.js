// Shared credential-verification logic for both role-specific login routes
// (src/auth.js, src/platformAuth.js) and the unified one (src/routes/unifiedLogin.js)
// that tries both without the caller having to know which role they are up front.
import bcrypt from 'bcryptjs';
import { getDb } from './db.js';
import { sendEmail } from './notifications/email.js';
import { fakeVerify } from './verification.js';

class LoginError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export { LoginError };

// Suspicious-login alerts (ROADMAP.md §12, plan.md §11 item 12) — two signals, both
// cheap: too many recent wrong passwords, or a successful login from an IP the account
// hasn't used before. No geo-IP lookup/dependency; a raw IP-change is the whole "new
// location" signal here.
// ponytail: IP-change alone (no geo-IP, no device fingerprint) is a coarse signal — real
// geo-IP if these alerts turn out too noisy or too quiet in practice.
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
const FAILED_LOGIN_THRESHOLD = 5;
const ALERT_COOLDOWN_MS = 30 * 60_000;

async function flagSuspiciousActivity(db, admin, business, reason) {
  const lastAlertAt = admin.suspicious_alert_sent_at ? new Date(admin.suspicious_alert_sent_at).getTime() : 0;
  if (Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) return; // avoid emailing on every single attempt
  await db.collection('admins').updateOne({ _id: admin._id }, { $set: { suspicious_alert_sent_at: new Date() } });
  const to = business?.contact_email || admin.email;
  await sendEmail(
    to,
    `Security alert — ${business?.name ?? 'your account'}`,
    `${reason} for ${admin.email}. If this wasn't you, change your password immediately from Settings.`
  ).catch((err) => console.error('suspicious-login alert email failed:', err.message));
}

// Returns { adminId, businessId, mfaEnabled } on a credential match, or null if the
// email/password doesn't match a company admin at all (as opposed to matching but being
// suspended, which throws). `ip` is optional — pass req.ip so failed/new-IP logins can be
// tracked; omitted callers just skip the suspicious-login checks.
export async function verifyCompanyAdmin(email, password, ip = null) {
  const db = await getDb();
  const admin = await db.collection('admins').findOne({ email });
  // An invited-but-not-yet-accepted admin has no password_hash yet — bcrypt.compare
  // against a missing hash throws rather than just failing, so this checks first.
  if (!admin || !admin.password_hash) { await fakeVerify(password); return null; } // same time as a wrong password

  if (!(await bcrypt.compare(password, admin.password_hash))) {
    const recentFailures = (admin.failed_logins ?? []).filter((f) => Date.now() - new Date(f.at).getTime() < FAILED_LOGIN_WINDOW_MS);
    recentFailures.push({ ip, at: new Date() });
    await db.collection('admins').updateOne({ _id: admin._id }, { $set: { failed_logins: recentFailures.slice(-20) } });
    if (recentFailures.length >= FAILED_LOGIN_THRESHOLD) {
      const business = await db.collection('businesses').findOne({ _id: admin.business_id }, { projection: { name: 1, contact_email: 1 } });
      await flagSuspiciousActivity(db, admin, business, `${recentFailures.length} failed login attempts in the last 15 minutes`);
    }
    return null;
  }

  if (admin.status === 'suspended') {
    throw new LoginError(403, 'your access has been suspended — contact your business owner');
  }
  const business = await db.collection('businesses').findOne({ _id: admin.business_id }, { projection: { status: 1, name: 1, contact_email: 1 } });
  if (business?.status === 'suspended') {
    throw new LoginError(403, 'this account has been suspended — contact the platform');
  }

  if (ip && admin.last_login_ip && admin.last_login_ip !== ip) {
    await flagSuspiciousActivity(db, admin, business, `New sign-in from a different location (${ip})`);
  }
  await db.collection('admins').updateOne({ _id: admin._id }, { $set: { last_login_ip: ip, last_login_at: new Date() }, $unset: { failed_logins: '' } });

  return { adminId: admin._id, businessId: admin.business_id, mfaEnabled: !!admin.mfa_enabled };
}

export async function verifyPlatformAdmin(email, password) {
  const db = await getDb();
  const admin = await db.collection('platform_admins').findOne({ email });
  if (!admin) { await fakeVerify(password); return null; }
  if (!(await bcrypt.compare(password, admin.password_hash))) return null;
  return { platformAdminId: admin._id };
}
