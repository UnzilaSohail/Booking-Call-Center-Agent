// Tenant separation and customer identity (docs/testing/TEST_CASES.md group MT): the same
// person at a salon and a dentist, cross-tenant reads, and how a returning customer is matched.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb } from './support/tenantFixture.js';
import { createBooking } from '../src/services/bookingService.js';
import { upsertCustomer, listCustomers, normalizePhone } from '../src/services/customerService.js';
import { withTenant } from '../src/db.js';

const settle = () => new Promise((r) => setTimeout(r, 400)); // createBooking upserts the customer in the background

describe('multi-tenant separation and customer identity', { skip }, () => {
  let salon;
  let dentist;
  let db;

  before(async () => {
    db = await getDb();
    salon = await createTenant({ name: '__salon__', services: [{ name: 'haircut', duration: 30 }], staff: ['Jessica'] });
    dentist = await createTenant({ name: '__dentist__', services: [{ name: 'cleaning', duration: 45 }], staff: ['Dr Khan'] });
  });
  after(() => dropTenants(salon.businessId, dentist.businessId));

  it('MT-01 the same phone booking at a salon and a dentist creates two independent customers', async () => {
    const phone = '+15550200001';
    const s = await createBooking(salon.businessId, { customerName: 'Sara', phone, serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: '2030-05-01T10:00:00.000Z' });
    const d = await createBooking(dentist.businessId, { customerName: 'Sara Ahmed', phone, serviceId: dentist.serviceIds.cleaning, staffId: dentist.staffIds['Dr Khan'], startTime: '2030-05-01T10:00:00.000Z' });
    await settle();
    const rows = await db.collection('customers').find({ phone }).toArray();
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]._id, rows[1]._id);
    assert.deepEqual(rows.map((r) => r.business_id).sort(), [salon.businessId, dentist.businessId].sort());
    assert.deepEqual((await listCustomers(salon.businessId)).map((c) => c.name), ['Sara'], 'salon sees only its own customer record');
    assert.notEqual(s.booking.id, d.booking.id);
  });

  it('MT-02 a tenant-scoped read cannot see another tenant\'s booking, even by id', async () => {
    const d = await createBooking(dentist.businessId, { customerName: 'Only Dentist', phone: '+15550200002', serviceId: dentist.serviceIds.cleaning, staffId: dentist.staffIds['Dr Khan'], startTime: '2030-05-02T10:00:00.000Z' });
    const seenFromSalon = await withTenant(salon.businessId, (c) => c('bookings').findOne({ _id: d.booking.id }));
    assert.equal(seenFromSalon, null);
  });

  it('MT-03 an old customer (from a phone call) booking again is matched to the same customer record', async () => {
    const phone = '+15550200003';
    const first = await upsertCustomer(salon.businessId, { phone, name: 'Returning' }); // what an inbound call does
    await createBooking(salon.businessId, { customerName: 'Returning', phone, serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: '2030-05-03T10:00:00.000Z' });
    await settle();
    const rows = await db.collection('customers').find({ business_id: salon.businessId, phone }).toArray();
    assert.equal(rows.length, 1, 'no duplicate customer created');
    assert.equal(rows[0]._id, first.id);
  });

  it('MT-04 formatting differences in the same number match one customer', () => {
    assert.equal(normalizePhone('+1 (555) 020-0004'), normalizePhone('+15550200004'));
  });

  it('MT-05 a number typed without country code matches the stored +1 number', () => {
    assert.equal(normalizePhone('5550200005'), normalizePhone('+15550200005'));
  });

  it('MT-06 ten simultaneous first-time upserts for one phone create one customer and none of them throw', { todo: 'KG-09: upsertCustomer is find-then-insert, losers hit a duplicate-key error' }, async () => {
    const phone = '+15550200006';
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => upsertCustomer(salon.businessId, { phone, name: 'Racer' })));
    assert.equal(await db.collection('customers').countDocuments({ business_id: salon.businessId, phone }), 1, 'still exactly one record');
    assert.equal(results.filter((r) => r.status === 'rejected').length, 0, 'no caller should see an error');
  });
});
