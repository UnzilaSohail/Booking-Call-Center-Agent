// Public booking page + directory (docs/testing/TEST_CASES.md groups PB, DR, SL): real HTTP
// against the Express app, real Mongo. Customers find a business by slug or the directory,
// book without logging in, and must never see another business or any customer data.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { clearRateLimits } from '../src/rateLimit.js';
import { slugify, validateSlug, uniqueSlug, backfillSlugs } from '../src/services/slug.js';
import { upsertCustomer, setSmsOptIn } from '../src/services/customerService.js';

const tag = newId().slice(0, 8);
const HOURS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '18:00' }));
const at = (days, hh = 10) => DateTime.utc().plus({ days }).set({ hour: hh, minute: 0, second: 0, millisecond: 0 });
const date = (days) => at(days).toISODate();
const slot = (days, hh = 10) => at(days, hh).toISO();

describe('slugs', { skip }, () => {
  it('SL-01 slugify and validate', () => {
    assert.equal(slugify("  ABC Salon & Spa!! "), 'abc-salon-spa');
    assert.equal(slugify('Café Étoile'), 'cafe-etoile');
    assert.equal(validateSlug('abc-salon'), null);
    for (const bad of ['ab', 'Abc-Salon', 'abc--salon', '-abc', 'abc_salon', 'find', 'api', 'x'.repeat(41)]) assert.ok(validateSlug(bad), `${bad} should be rejected`);
  });

  it('SL-02 uniqueSlug adds the city, then a number, on collision', async () => {
    const db = await getDb();
    const name = `Slug Test ${tag}`;
    const base = slugify(name);
    const ids = [newId(), newId()];
    await db.collection('businesses').insertOne({ _id: ids[0], name, slug: base });
    assert.equal(await uniqueSlug(db, name, 'Tampa'), `${base}-tampa`);
    await db.collection('businesses').insertOne({ _id: ids[1], name, slug: `${base}-tampa` });
    assert.equal(await uniqueSlug(db, name, 'Tampa'), `${base}-2`);
    await db.collection('businesses').deleteMany({ _id: { $in: ids } });
  });

  it('SL-03 the unique index rejects a duplicate slug and backfill names slugless businesses', async () => {
    const db = await getDb();
    const a = newId();
    const b = newId();
    const slug = `dup-${tag}`;
    await db.collection('businesses').insertOne({ _id: a, name: 'A', slug });
    await assert.rejects(db.collection('businesses').insertOne({ _id: b, name: 'B', slug }), { code: 11000 });
    await db.collection('businesses').insertOne({ _id: b, name: `Old Business ${tag}` });
    await backfillSlugs(db);
    assert.equal((await db.collection('businesses').findOne({ _id: b })).slug, `old-business-${tag}`.slice(0, 40));
    await db.collection('businesses').deleteMany({ _id: { $in: [a, b] } });
  });
});

describe('public booking page and directory', { skip }, () => {
  let db;
  let server;
  let base;
  let salon; // ABC Salon, Tampa: Jessica (haircut+facial), Sam (haircut only)
  let salon2; // ABC Salon, Miami: same name, different city
  let dentist;
  let bare; // listed but no services: must stay out of the directory
  let ownerToken;
  const slugs = {};
  const get = async (path) => fetch(`${base}/api/public${path}`);
  const post = (slug, body) => fetch(`${base}/api/public/${slug}/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const book = (overrides = {}) => post(slugs.salon, {
    serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: slot(3), name: 'Sara', phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
    consent: { sms: true, email: true }, ...overrides,
  });
  const publish = async (t, slug, listing) => {
    await db.collection('businesses').updateOne({ _id: t.businessId }, {
      $set: { slug, onboarding_completed_at: new Date(), address: `1 Main St, ${listing.city}`, contact_phone: '+15550009999', listing: { listed: true, ...listing } },
    });
  };

  before(async () => {
    db = await getDb();
    salon = await createTenant({ name: `ABC Salon ${tag}`, services: [{ name: 'haircut', duration: 30 }, { name: 'facial', duration: 60 }] });
    salon2 = await createTenant({ name: `ABC Salon ${tag}`, services: [{ name: 'haircut', duration: 30 }], staff: ['Mia'] });
    dentist = await createTenant({ name: `ABC Dentist ${tag}`, services: [{ name: 'teeth cleaning', duration: 45 }], staff: ['Dr Khan'] });
    bare = await createTenant({ name: `Bare ${tag}`, services: [], staff: [] });
    Object.assign(slugs, { salon: `abc-salon-tampa-${tag}`, salon2: `abc-salon-miami-${tag}`, dentist: `abc-dentist-${tag}`, bare: `bare-${tag}` });
    await publish(salon, slugs.salon, { city: 'Tampa', categories: ['hair-salon'] });
    await publish(salon2, slugs.salon2, { city: 'Miami', categories: ['hair-salon'] });
    await publish(dentist, slugs.dentist, { city: 'Tampa', categories: ['dentist'] });
    await publish(bare, slugs.bare, { city: 'Tampa', categories: ['dentist'] });
    await db.collection('services').updateOne({ business_id: salon.businessId, name: 'haircut' }, { $set: { price: 40 } });
    await db.collection('staff').updateOne({ _id: salon.staffIds.Sam }, { $set: { service_ids: [salon.serviceIds.haircut] } }); // Sam: haircut only
    await db.collection('staff').updateOne({ _id: salon.staffIds.Jessica }, { $set: { service_ids: [salon.serviceIds.haircut, salon.serviceIds.facial] } });
    await db.collection('admins').insertOne({ _id: newId(), business_id: salon.businessId, email: `owner-${tag}@example.test`, name: 'Owner', role: 'owner', status: 'active', password_hash: 'x' });
    const owner = await db.collection('admins').findOne({ business_id: salon.businessId });
    ownerToken = jwt.sign({ role: 'business', adminId: owner._id, businessId: salon.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(() => clearRateLimits());

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.collection('admins').deleteMany({ business_id: salon.businessId });
    await dropTenants(salon.businessId, salon2.businessId, dentist.businessId, bare.businessId);
  });

  // ---- booking page ----

  it('PB-01 a guest books end to end and gets the confirmation and manage link', async () => {
    const info = await (await get(`/${slugs.salon}`)).json();
    assert.equal(info.name, `ABC Salon ${tag}`);
    assert.match(info.address, /Tampa/);
    const services = await (await get(`/${slugs.salon}/services`)).json();
    assert.deepEqual(services.map((s) => s.name).sort(), ['facial', 'haircut']);
    assert.equal(services.find((s) => s.name === 'haircut').price, 40);
    const avail = await (await get(`/${slugs.salon}/availability?serviceId=${salon.serviceIds.haircut}&date=${date(3)}&staffId=${salon.staffIds.Jessica}`)).json();
    assert.ok(avail.slots.includes(slot(3)), 'the 10:00 slot is offered');

    const res = await book({ email: 'sara@example.test', phone: '+15550110001' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.booking.serviceName, 'haircut');
    assert.equal(body.booking.staffName, 'Jessica');
    assert.equal(body.business.name, `ABC Salon ${tag}`);
    assert.match(body.manageUrl, /\/manage\/.+/);
    const row = await db.collection('bookings').findOne({ _id: body.booking.id });
    assert.equal(row.created_via, 'web');
    assert.equal(row.business_id, salon.businessId);
    await new Promise((r) => setTimeout(r, 200));
    const customer = await db.collection('customers').findOne({ business_id: salon.businessId, phone: '+15550110001' });
    assert.equal(customer.name, 'Sara');
    assert.equal(customer.consent.lastWeb.sms, true);
    assert.match(customer.consent.lastWeb.text, /SMS and email/);
  });

  it('PB-02 a returning phone customer books on the web and stays one customer', async () => {
    await upsertCustomer(salon.businessId, { phone: '+15550110002', name: 'Old Customer' });
    const res = await book({ phone: '(555) 011-0002', name: 'Old C', startTime: slot(3, 12) });
    assert.equal(res.status, 201);
    await new Promise((r) => setTimeout(r, 200));
    const all = await db.collection('customers').find({ business_id: salon.businessId, phone: '+15550110002' }).toArray();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, 'Old Customer', 'an existing name is never overwritten');
  });

  it('PB-03 only staff who do the service are listed or bookable', async () => {
    const forFacial = await (await get(`/${slugs.salon}/staff?serviceId=${salon.serviceIds.facial}`)).json();
    assert.deepEqual(forFacial.map((s) => s.name), ['Jessica']);
    const forHaircut = await (await get(`/${slugs.salon}/staff?serviceId=${salon.serviceIds.haircut}`)).json();
    assert.deepEqual(forHaircut.map((s) => s.name).sort(), ['Jessica', 'Sam']);
    const res = await book({ serviceId: salon.serviceIds.facial, staffId: salon.staffIds.Sam, startTime: slot(4) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /does not offer/);
  });

  it('PB-04 "any available" takes a free stylist when the first is busy', async () => {
    const startTime = slot(5);
    assert.equal((await book({ staffId: salon.staffIds.Jessica, startTime })).status, 201);
    const any = await book({ staffId: 'any', startTime });
    assert.equal(any.status, 201);
    assert.equal((await any.json()).booking.staffName, 'Sam');
    const both = await (await get(`/${slugs.salon}/availability?serviceId=${salon.serviceIds.haircut}&date=${date(5)}&staffId=any`)).json();
    assert.ok(!both.slots.includes(startTime), 'the slot is gone once every stylist is booked');
  });

  it('PB-05 "any available" with everyone busy answers 409', async () => {
    const startTime = slot(6);
    await book({ staffId: salon.staffIds.Jessica, startTime });
    await book({ staffId: salon.staffIds.Sam, startTime });
    const res = await book({ staffId: 'any', startTime });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /no longer available/);
  });

  it('PB-06 eight people book the same slot at once: exactly one wins', async () => {
    const startTime = slot(7);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => book({ startTime, phone: `+1555012000${i}`, name: `P${i}` })));
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 201).length, 1);
    assert.equal(statuses.filter((s) => s === 409).length, 7);
    assert.equal(await db.collection('bookings').countDocuments({ business_id: salon.businessId, start_time: new Date(startTime), staff_id: salon.staffIds.Jessica }), 1);
  });

  it('PB-07 the same idempotency key twice makes one booking', async () => {
    const args = { phone: '+15550130001', startTime: slot(8), idempotencyKey: `key-${tag}` };
    const first = await (await book(args)).json();
    const second = await (await book(args)).json();
    assert.equal(first.booking.id, second.booking.id);
    assert.equal(await db.collection('bookings').countDocuments({ business_id: salon.businessId, phone: '+15550130001' }), 1);
  });

  it('PB-08 a time outside opening hours is refused', async () => {
    assert.equal((await book({ startTime: slot(9, 3) })).status, 409);
    assert.equal((await book({ startTime: 'not-a-date' })).status, 400);
  });

  it('PB-09 unknown, suspended, deleted and switched-off pages all answer the same 404', async () => {
    const same = async (slug) => { const r = await get(`/${slug}`); return [r.status, await r.json()]; };
    assert.deepEqual(await same('no-such-business'), [404, { error: 'not found' }]);
    for (const [patch, label] of [[{ status: 'suspended' }, 'suspended'], [{ status: 'deleted' }, 'deleted'], [{ booking_page_enabled: false }, 'switched off']]) {
      await db.collection('businesses').updateOne({ _id: bare.businessId }, { $set: patch });
      assert.deepEqual(await same(slugs.bare), [404, { error: 'not found' }], label);
      assert.equal((await get(`/${slugs.bare}/services`)).status, 404, label);
      assert.equal((await post(slugs.bare, { name: 'x' })).status, 404, label);
      await db.collection('businesses').updateOne({ _id: bare.businessId }, { $set: { status: 'active', booking_page_enabled: true } });
    }
  });

  it('PB-10 a filled honeypot looks like success but books nothing', async () => {
    const res = await book({ website: 'http://spam.example', phone: '+15550140001', startTime: slot(10) });
    assert.equal(res.status, 201);
    assert.equal(await db.collection('bookings').countDocuments({ business_id: salon.businessId, phone: '+15550140001' }), 0);
  });

  it('PB-11 booking attempts are rate limited per IP', async () => {
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await book({ phone: '+1555015000' + (i % 10), startTime: slot(11), staffId: salon.staffIds.Sam })).status);
    assert.equal(codes.at(-1), 429);
  });

  it('PB-12 consent: an unticked box opts that channel out; a ticked box never undoes a STOP', async () => {
    await book({ phone: '+15550160001', startTime: slot(12), consent: { sms: false, email: true } });
    await new Promise((r) => setTimeout(r, 200));
    let c = await db.collection('customers').findOne({ business_id: salon.businessId, phone: '+15550160001' });
    assert.equal(c.consent.smsOptIn, false);
    assert.equal(c.consent.emailOptIn, true);

    await upsertCustomer(salon.businessId, { phone: '+15550160002', name: 'Stopper' });
    await setSmsOptIn(salon.businessId, '+15550160002', false);
    await book({ phone: '+15550160002', startTime: slot(12, 12), consent: { sms: true, email: true } });
    await new Promise((r) => setTimeout(r, 200));
    c = await db.collection('customers').findOne({ business_id: salon.businessId, phone: '+15550160002' });
    assert.equal(c.consent.smsOptIn, false, 'STOP survives a ticked checkbox');
  });

  it('PB-13 bad input is rejected', async () => {
    assert.equal((await book({ phone: '12345' })).status, 400);
    assert.equal((await book({ name: '  ' })).status, 400);
    assert.equal((await book({ email: 'nope' })).status, 400);
    assert.equal((await book({ serviceId: undefined })).status, 400);
  });

  it('PB-14 a service of another business cannot be booked through this page', async () => {
    const res = await book({ serviceId: dentist.serviceIds['teeth cleaning'], staffId: undefined, startTime: slot(13) });
    assert.notEqual(res.status, 201);
    assert.equal(await db.collection('bookings').countDocuments({ business_id: salon.businessId, service_id: dentist.serviceIds['teeth cleaning'] }), 0);
  });

  // ---- directory ----

  const search = async (qs) => (await get(`/directory?${qs}`)).json();
  const mine = (results) => results.filter((r) => Object.values(slugs).includes(r.slug));

  it('DR-01 a listed, ready business appears; one with no services does not', async () => {
    const { results } = await search(`q=${tag}`);
    const found = mine(results).map((r) => r.slug).sort();
    assert.deepEqual(found, [slugs.dentist, slugs.salon, slugs.salon2].sort());
  });

  it('DR-02 two "ABC Salon"s are told apart by city and address', async () => {
    const { results } = await search(`q=ABC Salon ${tag}`);
    const cards = mine(results);
    assert.equal(cards.length, 2);
    assert.deepEqual(cards.map((c) => c.city).sort(), ['Miami', 'Tampa']);
    assert.ok(cards.every((c) => /Main St/.test(c.address)));
  });

  it('DR-03 search by service word and filter by category and city', async () => {
    assert.deepEqual(mine((await search('q=teeth')).results).map((r) => r.slug), [slugs.dentist]);
    assert.deepEqual(mine((await search('category=dentist')).results).map((r) => r.slug), [slugs.dentist]);
    assert.deepEqual(mine((await search(`q=${tag}&city=miami`)).results).map((r) => r.slug), [slugs.salon2], 'city is case-insensitive');
    assert.deepEqual(mine((await search(`q=${tag}&category=barber`)).results), []);
  });

  it('DR-04 unlisted, platform-hidden, suspended and not-live businesses are hidden, but the direct link still works', async () => {
    const off = [
      [{ 'listing.listed': false }, { 'listing.listed': true }],
      [{ 'listing.hidden_by_platform': true }, { 'listing.hidden_by_platform': false }],
      [{ status: 'suspended' }, { status: 'active' }],
      [{ onboarding_completed_at: null }, { onboarding_completed_at: new Date() }],
    ];
    for (const [hide, restore] of off) {
      await db.collection('businesses').updateOne({ _id: dentist.businessId }, { $set: hide });
      assert.deepEqual(mine((await search(`q=${tag}&category=dentist`)).results), [], JSON.stringify(hide));
      if (!hide.status) assert.equal((await get(`/${slugs.dentist}`)).status, 200, `direct link works for ${JSON.stringify(hide)}`);
      await db.collection('businesses').updateOne({ _id: dentist.businessId }, { $set: restore });
    }
  });

  it('DR-05 categories and cities endpoints count live businesses only', async () => {
    const cities = await (await get('/directory/cities')).json();
    assert.ok(cities.find((c) => c.name === 'Tampa').count >= 2);
    assert.ok(cities.find((c) => c.name === 'Miami'));
    const cats = await (await get('/directory/categories')).json();
    assert.ok(cats.find((c) => c.name === 'hair-salon').count >= 2);
  });

  it('DR-06 public responses never include customer data or internal ids', async () => {
    const all = JSON.stringify([
      await (await get('/directory')).json(), await (await get(`/${slugs.salon}`)).json(),
      await (await get(`/${slugs.salon}/staff`)).json(),
    ]);
    assert.ok(!/customer|password|@example\.test|contact_email|_id/.test(all), 'no customer, email or raw id fields');
  });

  // ---- owner settings ----

  const put = (body) => fetch(`${base}/api/business/listing`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify(body) });

  it('SL-04 the owner can change the booking link, but not to a taken or reserved one', async () => {
    assert.equal((await put({ slug: slugs.dentist })).status, 409);
    assert.equal((await put({ slug: 'find' })).status, 400);
    assert.equal((await put({ slug: 'Bad Slug' })).status, 400);
    const fresh = `abc-salon-new-${tag}`;
    assert.equal((await put({ slug: fresh })).status, 200);
    assert.equal((await get(`/${fresh}`)).status, 200);
    assert.equal((await get(`/${slugs.salon}`)).status, 404);
    await put({ slug: slugs.salon });
    const settings = await (await fetch(`${base}/api/business/listing`, { headers: { Authorization: `Bearer ${ownerToken}` } })).json();
    assert.equal(settings.slug, slugs.salon);
  });

  it('SL-05 listing categories must come from the fixed list', async () => {
    assert.equal((await put({ categories: ['dentist', 'made-up'] })).status, 400);
    assert.equal((await put({ categories: ['a', 'b', 'c', 'd'].map(() => 'dentist') })).status, 400);
    assert.equal((await put({ categories: ['hair-salon'], bookingPageEnabled: true })).status, 200);
  });
});
