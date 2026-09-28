import 'dotenv/config';
import { MongoClient } from 'mongodb';
import dns from 'node:dns';
import { ensureIndexes } from './schema.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');

// See the matching comment in src/db.js — same Node-vs-OS DNS SRV resolution mismatch,
// this file just isn't able to import that fix since it opens its own separate MongoClient.
if (uri.startsWith('mongodb+srv://')) dns.setServers(['8.8.8.8', '1.1.1.1']);

const client = new MongoClient(uri);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB_NAME || 'booking_call_center');
  await ensureIndexes(db);
  console.log('indexes ensured');

  // Booking creation relies on multi-document transactions (src/services/bookingService.js
  // — the booking + its slot locks must commit atomically) — those only work against a
  // replica set, not a standalone mongod. Fail loudly here rather than have the first
  // real booking attempt mysteriously error.
  const session = client.startSession();
  try {
    session.startTransaction();
    await db.collection('businesses').findOne({}, { session });
    await session.commitTransaction();
    console.log('transactions supported (replica set confirmed)');
  } catch (err) {
    console.error(
      '\nWARNING: this MongoDB deployment does not support transactions — bookings will fail.\n' +
      'MongoDB Atlas (even the free tier) is a replica set by default. Running locally, start\n' +
      'mongod with --replSet and run rs.initiate() once.\n' +
      `(${err.message})\n`
    );
  } finally {
    await session.endSession();
  }
} finally {
  await client.close();
}
