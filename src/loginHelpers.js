// Shared credential-verification logic for both role-specific login routes
// (src/auth.js, src/platformAuth.js) and the unified one (src/routes/unifiedLogin.js)
// that tries both without the caller having to know which role they are up front.
import bcrypt from 'bcryptjs';
import { getDb } from './db.js';

class LoginError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export { LoginError };

// Returns { adminId, businessId } on a match, or null if the email/password doesn't
// match a company admin at all (as opposed to matching but being suspended, which throws).
export async function verifyCompanyAdmin(email, password) {
  const db = await getDb();
  const admin = await db.collection('admins').findOne({ email });
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return null;

  const business = await db.collection('businesses').findOne({ _id: admin.business_id }, { projection: { status: 1 } });
  if (business?.status === 'suspended') {
    throw new LoginError(403, 'this account has been suspended — contact the platform');
  }
  return { adminId: admin._id, businessId: admin.business_id };
}

export async function verifyPlatformAdmin(email, password) {
  const db = await getDb();
  const admin = await db.collection('platform_admins').findOne({ email });
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return null;
  return { platformAdminId: admin._id };
}
