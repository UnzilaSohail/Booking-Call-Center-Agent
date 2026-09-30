// Jira 29h: mint a team invite link by hand for an already-invited admin, for when the
// invite email never arrived (see docs/plans/README.md — Aiza's invite, SendGrid unset)
// and the dashboard isn't deployed yet to click "Resend" (Jira 29f) from.
//
// Usage: node scripts/makeInviteLink.mjs <email>
import 'dotenv/config';
import { withSystemAccess, client } from '../src/db.js';
import { signInviteToken } from '../src/teamInvite.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/makeInviteLink.mjs <email>');
  process.exit(1);
}

const admin = await withSystemAccess((c) => c('admins').findOne({ email: email.toLowerCase() }));
if (!admin) {
  console.error(`no admin found with email ${email}`);
  process.exit(1);
}
if (admin.status !== 'invited') {
  console.error(`${email} has status "${admin.status ?? 'active'}", not "invited" — they may have already accepted, or this is not an invite-flow account.`);
  process.exit(1);
}

const link = `${process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002'}/accept-invite/${signInviteToken(admin._id)}`;
console.log(link);
await client.close();
