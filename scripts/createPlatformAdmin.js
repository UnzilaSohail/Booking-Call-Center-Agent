// There is no public endpoint to create a platform admin — that would let anyone become
// one, defeating the point of gating company registration behind this role (see
// src/platformAuth.js). Run this once by hand to bootstrap yourself:
//
//   node scripts/createPlatformAdmin.js you@example.com        (asks for the password)
//   PLATFORM_ADMIN_PASSWORD=... node scripts/createPlatformAdmin.js you@example.com
//
// The password is not taken from the command line: that lands in shell history and the process list.
// It must pass the same rules as every other password (src/passwordPolicy.js).
// Safe to re-run with the same email: it updates the password instead of erroring.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';
import { client, getDb, newId } from '../src/db.js';
import { checkPassword } from '../src/passwordPolicy.js';

const email = process.argv[2];
if (!email || process.argv[3]) {
  console.error('usage: node scripts/createPlatformAdmin.js <email>   (password via prompt or PLATFORM_ADMIN_PASSWORD, never as an argument)');
  process.exit(1);
}
let password = process.env.PLATFORM_ADMIN_PASSWORD;
if (!password) {
  // shortcut: the typed password is visible on screen; use the env var when someone is watching
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Password for the platform admin: ');
  rl.close();
}
const problem = checkPassword(password, email);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const db = await getDb();
const passwordHash = await bcrypt.hash(password, 10);

const existing = await db.collection('platform_admins').findOne({ email: email.toLowerCase() });
if (existing) {
  await db.collection('platform_admins').updateOne({ _id: existing._id }, { $set: { password_hash: passwordHash } });
  console.log(`updated password for existing platform admin ${email}`);
} else {
  await db.collection('platform_admins').insertOne({
    _id: newId(),
    email: email.toLowerCase(),
    password_hash: passwordHash,
    created_at: new Date(),
  });
  console.log(`created platform admin ${email}`);
}

await client.close();
