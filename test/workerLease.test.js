// AIN-555: only one instance at a time runs the calendar sync and billing workers.
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, getDb } from '../src/db.js';
import { claimLease } from '../src/workerLease.js';

after(() => client.close());
const skip = !process.env.MONGODB_URI && 'MONGODB_URI not set';

test('the first instance holds the lease, a second is refused, and takes over once it runs out', { skip }, async () => {
  const name = `test-lease-${Date.now()}`;
  const db = await getDb();
  try {
    assert.equal(await claimLease(name, 60_000, 'A'), true);
    assert.equal(await claimLease(name, 60_000, 'A'), true, 'the holder renews');
    assert.equal(await claimLease(name, 60_000, 'B'), false, 'a second instance is refused');
    await db.collection('worker_leases').updateOne({ _id: name }, { $set: { expires_at: new Date(Date.now() - 1000) } });
    assert.equal(await claimLease(name, 60_000, 'B'), true, 'B takes over after the lease expired');
    assert.equal(await claimLease(name, 60_000, 'A'), false, 'and A no longer holds it');
  } finally { await db.collection('worker_leases').deleteOne({ _id: name }); }
});

test('ten instances racing for one lease: exactly one wins', { skip }, async () => {
  const name = `test-lease-race-${Date.now()}`;
  const db = await getDb();
  try {
    const wins = (await Promise.all(Array.from({ length: 10 }, (_, i) => claimLease(name, 60_000, `I${i}`)))).filter(Boolean);
    assert.equal(wins.length, 1);
  } finally { await db.collection('worker_leases').deleteOne({ _id: name }); }
});
