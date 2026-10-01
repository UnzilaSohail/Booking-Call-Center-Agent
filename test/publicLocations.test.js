// Multi-location booking (Jira 17z), customer language preference (18o) and the portal link in
// the confirmation SMS (19t). Docs: docs/testing/TEST_CASES.md groups LC, LG, SM.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { clearRateLimits } from '../src/rateLimit.js';
import { getBusiness } from '../src/services/bookingService.js';
import { sendBookingConfirmation } from '../src/notifications/notify.js';
import { upsertCustomer, updateCustomer } from '../src/services/customerService.js';

const slot = (days, hh = 10) => DateTime.utc().plus({ days }).set({ hour: hh, minute: 0, second: 0, millisecond: 0 }).toISO();
const date = (days) => slot(days).slice(0, 10);
const tag = newId().slice(0, 8);

describe('locations, language and sms link', { skip }, () => {
  let db;
  let server;
  let base;
  let t;
  let solo; // a one-location business
  let slug;
  let north;
  let south;
  let staffNorth;
  let staffSouth;
  let staffAny;

  const get = (path) => fetch(`${base}/api/public/${slug}${path}`);
  const post = (body) => fetch(`${base}/api/public/${slug}/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const book = (over = {}) => post({ serviceId: t.serviceIds.haircut, staffId: 'any', startTime: slot(3), name: 'Sara', phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, consent: { sms: true, email: true }, ...over });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: `Multi ${tag}`, staff: [] });
    solo = await createTenant({ name: `Solo ${tag}`, staff: ['Only'] });
    slug = `multi-${tag}`;
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { slug, address: 'Head Office 1', onboarding_completed_at: new Date() } });
    await db.collection('businesses').updateOne({ _id: solo.businessId }, { $set: { slug: `solo-${tag}`, onboarding_completed_at: new Date() } });
    north = newId(); south = newId();
    await db.collection('locations').insertMany([
      { _id: north, business_id: t.businessId, name: 'North Branch', address: '1 North St', is_primary: true },
      { _id: south, business_id: t.businessId, name: 'South Branch', address: '2 South Rd', is_primary: false },
    ]);
    staffNorth = newId(); staffSouth = newId(); staffAny = newId();
    await db.collection('staff').insertMany([
      { _id: staffNorth, business_id: t.businessId, name: 'Nora', location_id: north },
      { _id: staffSouth, business_id: t.businessId, name: 'Sam', location_id: south },
      { _id: staffAny, business_id: t.businessId, name: 'Flo' }, // no location: works everywhere
    ]);
    server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(() => clearRateLimits());

  after(async () => {
    await new Promise((r) => server.close(r));
    await db.collection('locations').deleteMany({ business_id: t.businessId });
    await dropTenants(t.businessId, solo.businessId);
  });

  it('LC-01 the business info lists its locations; staff are filtered to the chosen one', async () => {
    const info = await (await get('')).json();
    assert.deepEqual(info.locations.map((l) => l.name).sort(), ['North Branch', 'South Branch']);
    const names = async (qs) => (await (await get(`/staff?serviceId=${t.serviceIds.haircut}${qs}`)).json()).map((s) => s.name).sort();
    assert.deepEqual(await names(''), ['Flo', 'Nora', 'Sam']);
    assert.deepEqual(await names(`&locationId=${north}`), ['Flo', 'Nora'], 'Sam works at the other branch');
    assert.deepEqual(await names(`&locationId=${south}`), ['Flo', 'Sam']);
  });

  it('LC-02 availability for "any" only counts staff at that location', async () => {
    const startTime = slot(3);
    // Fill Nora and Flo at 10:00; only Sam (south) is free then.
    assert.equal((await book({ staffId: staffNorth, locationId: north, startTime })).status, 201);
    assert.equal((await book({ staffId: staffAny, locationId: north, startTime })).status, 201);
    const slotsAt = async (loc) => (await (await get(`/availability?serviceId=${t.serviceIds.haircut}&date=${date(3)}&staffId=any&locationId=${loc}`)).json()).slots;
    assert.ok(!(await slotsAt(north)).includes(startTime), 'north is full at 10:00');
    assert.ok((await slotsAt(south)).includes(startTime), 'south still has Sam');
  });

  it('LC-03 a booking at a location gets a staff member from there, stores the location and shows its address', async () => {
    const res = await book({ staffId: 'any', locationId: south, startTime: slot(4) });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.business.address, '2 South Rd');
    assert.equal(body.business.locationName, 'South Branch');
    assert.ok(['Sam', 'Flo'].includes(body.booking.staffName), `got ${body.booking.staffName}`);
    const row = await db.collection('bookings').findOne({ _id: body.booking.id });
    assert.equal(row.location_id, south);
  });

  it('LC-04 staff from another location is refused; an unknown or foreign location is refused', async () => {
    const wrongStaff = await book({ staffId: staffSouth, locationId: north, startTime: slot(5) });
    assert.equal(wrongStaff.status, 400);
    assert.match((await wrongStaff.json()).error, /does not work at that location/);
    assert.equal((await book({ locationId: 'nope', startTime: slot(5) })).status, 400);
    const foreign = newId();
    await db.collection('locations').insertOne({ _id: foreign, business_id: solo.businessId, name: 'Elsewhere' });
    assert.equal((await book({ locationId: foreign, startTime: slot(5) })).status, 400, 'a location of another business');
    await db.collection('locations').deleteOne({ _id: foreign });
  });

  it('LC-05 a booking without a location still works (single-location businesses)', async () => {
    const res = await book({ startTime: slot(6) });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).business.address, 'Head Office 1');
  });

  it('LG-01 language preference: staff can set it, bad values are ignored, the customer can set it in the portal', async () => {
    const c = await upsertCustomer(t.businessId, { phone: '+15550900001', name: 'Lang' });
    assert.equal((await db.collection('customers').findOne({ _id: c.id })).preferences.language, null);
    await updateCustomer(t.businessId, c.id, { preferences: { language: 'es' } });
    assert.equal((await db.collection('customers').findOne({ _id: c.id })).preferences.language, 'es');
    await updateCustomer(t.businessId, c.id, { preferences: { language: 'klingon' } });
    assert.equal((await db.collection('customers').findOne({ _id: c.id })).preferences.language, null, 'unknown languages are dropped');

    const token = jwt.sign({ role: 'customer', purpose: 'customer-session', businessId: t.businessId, customerId: c.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const patch = (body) => fetch(`${base}/api/customer/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const ok = await (await patch({ language: 'ur' })).json();
    assert.equal(ok.language, 'ur');
    assert.equal((await patch({ language: 'klingon' })).status, 400);
    assert.equal((await (await patch({ language: '' })).json()).language, null, 'cleared');
  });

  it('SM-01 the confirmation SMS carries a link to the customer\'s own appointments page', async () => {
    const lines = [];
    const warn = console.warn;
    console.warn = (...a) => lines.push(a.join(' '));
    try {
      const business = await getBusiness(t.businessId);
      const service = await db.collection('services').findOne({ _id: t.serviceIds.haircut });
      await sendBookingConfirmation(business, { _id: newId(), phone: '+15550900002', customer_email: null, start_time: new Date(slot(7)), staff_id: null, location_id: null }, service);
      const soloBiz = await getBusiness(solo.businessId);
      await db.collection('businesses').updateOne({ _id: solo.businessId }, { $unset: { slug: '' } });
      const noSlug = await getBusiness(solo.businessId);
      await sendBookingConfirmation(noSlug, { _id: newId(), phone: '+15550900003', customer_email: null, start_time: new Date(slot(7)), staff_id: null, location_id: null }, service);
      assert.ok(soloBiz.slug);
    } finally {
      console.warn = warn;
    }
    const withSlug = lines.find((l) => l.includes('+15550900002'));
    assert.match(withSlug, new RegExp(`All your appointments: .*/my/${slug}`));
    assert.match(withSlug, /Reschedule or cancel: .*\/manage\//);
    const without = lines.find((l) => l.includes('+15550900003'));
    assert.ok(!without.includes('All your appointments'), 'no link when the business has no booking link');
  });
});
