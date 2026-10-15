// One instance runs each background worker (calendar sync, billing) at a time. Without this a second backend process
// would double-charge a period and push every booking to Google twice. The holder renews its lease on every tick; if it
// dies, another instance takes over once the lease runs out. (ecosystem.config.cjs still says: run one process.)
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

const INSTANCE_ID = randomUUID();

// true when this instance (owner) holds the lease for `name` for the next ttlMs, false when another live one does.
export async function claimLease(name, ttlMs, owner = INSTANCE_ID) {
  const col = (await getDb()).collection('worker_leases');
  const now = new Date();
  try {
    const row = await col.findOneAndUpdate(
      { _id: name, $or: [{ owner }, { expires_at: { $lt: now } }] },
      { $set: { owner, expires_at: new Date(now.getTime() + ttlMs) } },
      { upsert: true, returnDocument: 'after' }
    );
    return row?.owner === owner;
  } catch (err) {
    if (err.code === 11000) return false; // the row exists, belongs to someone else and has not expired
    throw err;
  }
}
