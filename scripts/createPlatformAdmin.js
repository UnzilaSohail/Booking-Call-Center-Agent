// There is no public endpoint to create a platform admin — that would let anyone become
// one, defeating the point of gating company registration behind this role (see
// src/platformAuth.js). Run this once by hand to bootstrap yourself:
//
//   node scripts/createPlatformAdmin.js you@example.com "a strong password"
//
// Safe to re-run with the same email: it updates the password instead of erroring.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { client, getDb, newId } from '../src/db.js';

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('usage: node scripts/createPlatformAdmin.js <email> <password>');
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
