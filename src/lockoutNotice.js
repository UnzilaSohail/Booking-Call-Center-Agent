// Tells a person their login was locked (Jira 36m) so they are not left wondering, and so they notice if the wrong
// passwords were not theirs. Best effort: a failed email never changes the answer the visitor gets.
import { getDb } from './db.js';
import { sendEmail } from './notifications/email.js';

export async function notifyLockout(email) {
  const db = await getDb();
  const admin = (await db.collection('admins').findOne({ email })) ?? (await db.collection('platform_admins').findOne({ email }));
  if (!admin) return;
  await sendEmail(
    admin.email,
    'Your login was locked for 15 minutes',
    'Someone typed the wrong password for your account 8 times in a row, so we locked the login for 15 minutes to keep it safe.\n\n'
    + 'If that was you, wait 15 minutes and try again, or ask your platform team to unlock it right away.\n'
    + 'If it was not you, nothing was accessed. Consider changing your password once you are back in.',
  ).catch((err) => console.error('lockout email failed:', err.message));
}
