// Requires MONGODB_URI pointing at a migrated, replica-set-enabled deployment — skips
// cleanly if unset, same convention as test/booking.test.js.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, getDb, newId } from '../src/db.js';
import { normalizePhone, upsertCustomer, listCustomers, toCsv, importCsv } from '../src/services/customerService.js';

test('normalizePhone strips formatting but keeps a leading +', () => {
  assert.equal(normalizePhone('+1 (555) 123-4567'), '+15551234567');
  assert.equal(normalizePhone('555.123.4567'), '5551234567');
  assert.equal(normalizePhone(''), '');
});

test('customer upsert/dedupe/CSV', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const db = await getDb();
  const businessId = newId();
  await db.collection('businesses').insertOne({ _id: businessId, name: '__test__' });

  try {
    const first = await upsertCustomer(businessId, { phone: '+1 (555) 000-1111', name: 'Alice', email: 'alice@example.com' });
    // Same person, same digits, just typed differently (cosmetic formatting only) —
    // must dedupe to the same record, not create a second.
    const second = await upsertCustomer(businessId, { phone: '+15550001111', name: '', email: '' });
    assert.equal(second.id, first.id);
    assert.equal(second.name, 'Alice', 'a blank name on a later call must not clobber the existing one');
    assert.equal(second.email, 'alice@example.com');

    const all = await listCustomers(businessId, {});
    assert.equal(all.length, 1);

    const csv = toCsv(all);
    assert.match(csv, /Alice/);
    assert.match(csv, /\+15550001111/);

    const importResult = await importCsv(businessId, `name,phone,email,tags\nBob,+15559998888,bob@example.com,vip|regular`);
    assert.equal(importResult.imported, 1);
    const afterImport = await listCustomers(businessId, { q: 'Bob' });
    assert.equal(afterImport.length, 1);
    assert.deepEqual(afterImport[0].tags, ['vip', 'regular']);

    // Re-importing the same row updates rather than duplicating.
    const reImport = await importCsv(businessId, `name,phone,email,tags\nBob,+15559998888,bob@example.com,vip|regular`);
    assert.equal(reImport.updated, 1);
    assert.equal(reImport.imported, 0);
  } finally {
    await db.collection('businesses').deleteOne({ _id: businessId });
    await db.collection('customers').deleteMany({ business_id: businessId });
    await client.close();
  }
});
