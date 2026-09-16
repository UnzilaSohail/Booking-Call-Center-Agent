import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from './schema.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');

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
