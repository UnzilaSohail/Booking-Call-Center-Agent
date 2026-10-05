// `npm test`: runs the suite against a SEPARATE database (<name>_test) so it can never touch
// dev or production data (Jira 23e), makes sure its indexes exist, then runs `node --test`.
// Extra arguments are passed through: npm test -- test/publicBooking.test.js
// Without MONGODB_URI the database tests skip themselves and only the pure tests run.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const base = (process.env.MONGODB_DB_NAME || 'booking_call_center').replace(/_test$/, '');
const env = { ...process.env, MONGODB_DB_NAME: `${base}_test`, DIRECTORY_CACHE_MS: '0' };

if (env.MONGODB_URI) {
  console.log(`tests use database "${env.MONGODB_DB_NAME}" (your "${base}" data is not touched)`);
  const migrate = spawnSync(process.execPath, ['db/migrate.js'], { env, stdio: 'inherit' });
  if (migrate.status !== 0) {
    console.error('could not prepare the test database (is MongoDB, as a replica set, running? see: npm run local-db)');
    process.exit(migrate.status ?? 1);
  }
}

const run = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], { env, stdio: 'inherit' });
process.exit(run.status ?? 1);
