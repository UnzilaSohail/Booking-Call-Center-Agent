// Duplicate detection, customer merge, and platform-admin directory moderation
// (docs/testing/TEST_CASES.md groups DU and PH). Real HTTP against the Express app.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { clearRateLimits } from '../src/rateLimit.js';
import { createBooking } from '../src/services/bookingService.js';
import { upsertCustomer, setSmsOptIn } from '../src/services/customerService.js';

const at = (days, hh = 10) => new Date(Date.UTC(2031, 0, 1 + days, hh)).toISOString();

describe('duplicates, merge and moderation', { skip }, () => {
  let db;
  let server;
  let base;
  let salon;
  let dentist;
  let ownerToken;
  let platformToken;
  const call = (path, { method = 'GET', body, token = ownerToken } = {}) => fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
  });
  const customer = (t, phone) => db.collection('customers').findOne({ business_id: t.businessId, phone });

  before(async () => {
    await clearRateLimits();
    db = await getDb();
    salon = await createTenant({ name: '__merge_salon__', staff: ['Jessica'] });
    dentist = await createTenant({ name: '__merge_dentist__', staff: ['Dr Khan'] });
    const adminId = newId();
    await db.collection('admins').insertOne({ _id: adminId, business_id: salon.businessId, email: `o-${adminId}@example.test`, name: 'Owner', role: 'owner', status: 'active', password_hash: 'x' });
    ownerToken = jwt.sign({ role: 'business', adminId, businessId: salon.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    platformToken = jwt.sign({ role: 'platform', platformAdminId: 'p1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.collection('admins').deleteMany({ business_id: salon.businessId });
    await dropTenants(salon.businessId, dentist.businessId);
  });

  it('DU-01 the same person on a new phone is found by email; same name alone is flagged as weak', async () => {
    await upsertCustomer(salon.businessId, { phone: '+15550500001', name: 'Amna Khan', email: 'amna@example.test' });
    await upsertCustomer(salon.businessId, { phone: '+15550500002', name: 'A. Khan', email: 'AMNA@example.test' });
    await upsertCustomer(salon.businessId, { phone: '+15550500003', name: 'amna khan' });
    await upsertCustomer(salon.businessId, { phone: '+15550500004', name: 'Totally Different' });
    await upsertCustomer(dentist.businessId, { phone: '+15550500005', name: 'Amna Khan', email: 'amna@example.test' });
    const main = await customer(salon, '+15550500001');
    const found = await (await call(`/customers/${main._id}/duplicates`)).json();
    const byPhone = Object.fromEntries(found.map((d) => [d.phone, d.matchedOn]));
    assert.deepEqual(byPhone, { '+15550500002': 'email', '+15550500003': 'name' });
  });

  it('DU-02 merge moves bookings and calls, fills gaps, unions tags and keeps the stricter consent', async () => {
    const keep = await customer(salon, '+15550500001');
    const dup = await customer(salon, '+15550500002');
    await db.collection('customers').updateOne({ _id: keep._id }, { $set: { tags: ['vip'], name: null } });
    await db.collection('customers').updateOne({ _id: dup._id }, { $set: { tags: ['vip', 'late'], notes: 'allergic to latex' } });
    await setSmsOptIn(salon.businessId, '+15550500002', false); // the duplicate had sent STOP
    const b = await createBooking(salon.businessId, { customerName: 'A. Khan', phone: '+15550500002', serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: at(1) });
    await db.collection('call_logs').insertOne({ _id: newId(), business_id: salon.businessId, phone: '+15550500002', created_at: new Date() });

    const res = await call(`/customers/${keep._id}/merge`, { method: 'POST', body: { fromId: dup._id } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, bookings: 1, calls: 1 });

    assert.equal(await customer(salon, '+15550500002'), null, 'the duplicate is gone');
    assert.equal((await db.collection('bookings').findOne({ _id: b.booking.id })).phone, '+15550500001');
    assert.equal(await db.collection('call_logs').countDocuments({ business_id: salon.businessId, phone: '+15550500001' }), 1);
    const merged = await customer(salon, '+15550500001');
    assert.equal(merged.name, 'A. Khan');
    assert.equal(merged.notes, 'allergic to latex');
    assert.deepEqual([...merged.tags].sort(), ['late', 'vip']);
    assert.equal(merged.consent.smsOptIn, false, 'a STOP on either record survives the merge');
    const detail = await (await call(`/customers/${merged._id}`)).json();
    assert.equal(detail.bookings.length, 1);
    assert.equal(detail.bookings[0].createdVia, 'dashboard');
    assert.match(detail.bookings[0].reference, /^[A-Z2-9]{6}$/);
  });

  it('DU-03 bad merges are refused: itself, unknown, or a customer of another business', async () => {
    const keep = await customer(salon, '+15550500001');
    const other = await customer(dentist, '+15550500005');
    assert.equal((await call(`/customers/${keep._id}/merge`, { method: 'POST', body: { fromId: keep._id } })).status, 400);
    assert.equal((await call(`/customers/${keep._id}/merge`, { method: 'POST', body: { fromId: 'nope' } })).status, 404);
    assert.equal((await call(`/customers/${keep._id}/merge`, { method: 'POST', body: { fromId: other._id } })).status, 404);
    assert.equal((await call(`/customers/${other._id}/duplicates`)).status, 404, 'cannot look at another business\'s customer');
    assert.ok(await customer(dentist, '+15550500005'), 'the other business is untouched');
  });

  it('PH-01 platform admin hides and restores a listing; the owner cannot', async () => {
    const id = salon.businessId;
    const hide = (token, hidden) => call(`/platform/businesses/${id}/listing`, { method: 'PATCH', body: { hidden }, token });
    assert.equal((await hide(ownerToken, true)).status, 401, 'a company token is not a platform token');
    assert.equal((await hide(platformToken, 'yes')).status, 400);
    assert.equal((await hide(platformToken, true)).status, 200);
    let detail = await (await call(`/platform/businesses/${id}`, { token: platformToken })).json();
    assert.equal(detail.listing.hiddenByPlatform, true);
    assert.equal((await db.collection('businesses').findOne({ _id: id })).listing.hidden_by_platform, true);
    assert.equal((await hide(platformToken, false)).status, 200);
    detail = await (await call(`/platform/businesses/${id}`, { token: platformToken })).json();
    assert.equal(detail.listing.hiddenByPlatform, false);
    assert.equal((await call('/platform/businesses/does-not-exist/listing', { method: 'PATCH', body: { hidden: true }, token: platformToken })).status, 404);
  });
});
