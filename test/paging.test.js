// AIN-566: customers are paged (and the CSV export is no longer cut at 500); exceptions are paged on request.
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { listCustomers, countCustomers } from '../src/services/customerService.js';

describe('paging', { skip }, () => {
  let db; let server; let base; let t; let token;
  const adminId = newId();
  const get = (path) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__paging__' });
    await db.collection('admins').insertOne({ _id: adminId, business_id: t.businessId, name: 'Owner', email: `pg-${adminId.slice(0, 8)}@example.test`, password_hash: 'x', role: 'owner', status: 'active', created_at: new Date() });
    // 620 customers: more than one page of 500, and a clash of updated_at to prove the order is stable
    const when = new Date();
    await db.collection('customers').insertMany(Array.from({ length: 620 }, (_, i) => ({ _id: newId(), business_id: t.businessId, phone: `+1555${String(i).padStart(7, '0')}`, name: `Cust ${i}`, updated_at: when, created_at: when, consent: {} })));
    await db.collection('failed_bookings').insertMany(Array.from({ length: 7 }, (_, i) => ({ _id: newId(), business_id: t.businessId, customer_name: `F${i}`, phone: '+15550000000', error_message: 'x', created_at: new Date(Date.now() - i * 1000), resolved_at: null })));
    token = jwt.sign({ role: 'business', adminId, businessId: t.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('admins').deleteMany({ _id: adminId });
    await db.collection('failed_bookings').deleteMany({ business_id: t.businessId });
    await dropTenants(t.businessId);
  });

  it('PG-01 pages of customers never repeat or skip a row, and the total is right', async () => {
    const first = await (await get('/api/customers?paged=1')).json();
    assert.equal(first.total, 620);
    assert.equal(first.items.length, 500);
    const second = await (await get('/api/customers?paged=1&skip=500')).json();
    assert.equal(second.items.length, 120);
    const ids = [...first.items, ...second.items].map((c) => c.id);
    assert.equal(new Set(ids).size, 620, 'no row twice, none missing');
    assert.equal((await countCustomers(t.businessId, 'Cust 61')), 11, 'Cust 61, 610-619');
  });

  it('PG-02 the plain list still works as before, and the CSV export holds every customer', async () => {
    const plain = await (await get('/api/customers')).json();
    assert.ok(Array.isArray(plain) && plain.length === 500);
    const csv = await (await get('/api/customers/export')).text();
    assert.equal(csv.trim().split('\n').length, 621, 'header plus all 620 customers');
    assert.equal((await listCustomers(t.businessId, { all: true })).length, 620);
  });

  it('PG-03 exceptions can be fetched a page at a time', async () => {
    const page = await (await get('/api/exceptions?status=open&paged=1&limit=3')).json();
    assert.equal(page.total, 7);
    assert.equal(page.items.length, 3);
    const rest = await (await get('/api/exceptions?status=open&paged=1&limit=3&skip=3')).json();
    assert.equal(rest.items.length, 3);
    assert.equal((await (await get('/api/exceptions?status=open&paged=1&limit=3&skip=6')).json()).items.length, 1);
    assert.ok(Array.isArray(await (await get('/api/exceptions?status=open')).json()), 'unpaged callers still get the list');
  });
});
