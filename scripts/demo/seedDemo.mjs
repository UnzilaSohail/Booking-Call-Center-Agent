// Demo data for the recorded walkthrough (scripts/demo/record.mjs), the screenshot checks and `npm run demo:seed`.
// The data itself lives in src/services/demoData.js (the platform console's "Add demo data" button uses the same
// code); this file only adds what a local script needs: a fixed password, a platform admin to log in as, and a
// customer session for Sara.
//
// Needs the same MONGODB_URI / MONGODB_DB_NAME as the backend it will be shown against.
//   npm run demo:seed [-- --listed] [-- --walkthrough]   add demo data (random password unless --walkthrough)
//   npm run demo:remove                                  remove every demo business and its data
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getDb, newId } from '../../src/db.js';
import { signCustomerToken } from '../../src/customerAuth.js';
import { addDemoData, removeDemoData, generatePassword, DEMO_ACCOUNTS, DEMO_SLUGS } from '../../src/services/demoData.js';

export const DEMO_PASSWORD = 'DemoPass123!';
export const DEMO = {
  owner: DEMO_ACCOUNTS.owner, newOwner: DEMO_ACCOUNTS.newOwner, platform: DEMO_ACCOUNTS.platform,
  slug: DEMO_SLUGS.glow, miamiSlug: DEMO_SLUGS.miami, dentistSlug: DEMO_SLUGS.dentist, repeatCustomerPhone: '+15550100001',
};

export const cleanupDemo = removeDemoData;

export async function seedDemo({ password = DEMO_PASSWORD, listed = true } = {}) {
  const r = await addDemoData({ listed, password });
  const db = await getDb();
  await db.collection('platform_admins').insertOne({ _id: newId(), email: DEMO.platform, password_hash: await bcrypt.hash(password, 10), created_at: new Date(), demo: true });
  const { glow, miami, dentist, sunrise, svc, staff, north, south, saraId } = r.ids;
  return { glow, miami, dentist, sunrise, svc, staff, north, south, jessicaBookedAt: r.jessicaBookedAt, saraToken: signCustomerToken(glow, saraId), password, counts: r.counts };
}

// node scripts/demo/seedDemo.mjs [--clean] [--listed] [--walkthrough]
if (process.argv[1]?.replace(/\\/g, '/').endsWith('demo/seedDemo.mjs')) {
  const { client } = await import('../../src/db.js');
  const has = (f) => process.argv.includes(f);
  if (has('--clean')) console.log('removed', await removeDemoData(), 'demo businesses');
  else {
    const d = await seedDemo(has('--walkthrough') ? { listed: true } : { listed: has('--listed'), password: generatePassword() });
    console.log(`Demo data added: ${d.counts.bookings} bookings, ${d.counts.calls} calls, ${d.counts.customers} customers.`);
    console.log(`Log in as ${DEMO.owner} (company) or ${DEMO.newOwner} (new business) with password: ${d.password}`);
    console.log(has('--walkthrough') || has('--listed') ? 'The demo businesses are listed in the public directory.' : 'Not listed in the public directory (add --listed to list them).');
    console.log('Remove it all later with: npm run demo:remove');
  }
  await client.close();
}
