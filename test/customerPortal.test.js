// Customer sign-in and "My appointments" (docs/testing/TEST_CASES.md group CP): real HTTP
// against the Express app. A customer proves their phone/email with a code, gets a token that
// works only on /api/customer/*, and can see and change only their own appointments at that
// one business. Delivery is faked by toggling the provider env vars on (the send itself then
// logs "not sent"), and the stored code hash is swapped for a known one to sign in.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { clearRateLimits } from '../src/rateLimit.js';
import { hashCode } from '../src/verification.js';
import { createBooking, listBookings } from '../src/services/bookingService.js';
import { upsertCustomer } from '../src/services/customerService.js';
import { signCustomerToken } from '../src/customerAuth.js';

const tag = newId().slice(0, 8);
const slot = (days, hh = 10) => DateTime.utc().plus({ days }).set({ hour: hh, minute: 0, second: 0, millisecond: 0 }).toISO();
const date = (days) => slot(days).slice(0, 10);
const PHONE = '+15550400001';
const OTHER = '+15550400002';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The code is written after the reply (two password hashes), so wait for the row instead of guessing how long.
const row = async (find) => { for (let i = 0; i < 40; i++) { const r = await find(); if (r) return r; await wait(100); } return null; };
const realProvider = process.env.TWILIO_ACCOUNT_SID || process.env.GMAIL_USER || process.env.SENDGRID_API_KEY;

describe('customer portal', { skip: skip || (realProvider ? 'a real SMS/email provider is configured; this file fakes one' : false) }, () => {
  let db;
  let server;
  let base;
  let salon;
  let dentist;
  let slug;
  let token; // signed-in customer of salon
  const api = (path, { method = 'GET', body, auth } = {}) => fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const requestCode = (body) => api(`/public/${slug}/portal/code`, { method: 'POST', body });
  const signIn = async (phone = PHONE, code = '123456') => {
    await db.collection('customer_login_codes').replaceOne(
      { _id: `${salon.businessId}:${(await db.collection('customers').findOne({ business_id: salon.businessId, phone }))._id}` },
      { business_id: salon.businessId, customer_id: (await db.collection('customers').findOne({ business_id: salon.businessId, phone }))._id, code_hash: await hashCode(code), attempts: 0, created_at: new Date(0), expires_at: new Date(Date.now() + 600_000) },
      { upsert: true }
    );
    return api(`/public/${slug}/portal/verify`, { method: 'POST', body: { phone, code } });
  };
  const fakeProvider = (on) => {
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM', 'GMAIL_USER', 'GMAIL_APP_PASSWORD']) {
      if (on) process.env[k] = 'fake'; else delete process.env[k];
    }
  };

  before(async () => {
    db = await getDb();
    salon = await createTenant({ name: `Portal Salon ${tag}`, staff: ['Jessica'] });
    dentist = await createTenant({ name: `Portal Dentist ${tag}`, staff: ['Dr Khan'] });
    slug = `portal-salon-${tag}`;
    await db.collection('businesses').updateOne({ _id: salon.businessId }, { $set: { slug } });
    await db.collection('businesses').updateOne({ _id: dentist.businessId }, { $set: { slug: `portal-dentist-${tag}` } });
    await upsertCustomer(salon.businessId, { phone: PHONE, name: 'Sara Portal', email: `Sara-${tag}@Example.test` });
    await upsertCustomer(salon.businessId, { phone: OTHER, name: 'Someone Else' });
    await upsertCustomer(dentist.businessId, { phone: PHONE, name: 'Sara At Dentist' });
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(() => clearRateLimits());

  after(async () => {
    fakeProvider(false);
    await new Promise((resolve) => server.close(resolve));
    await db.collection('customer_login_codes').deleteMany({ business_id: { $in: [salon.businessId, dentist.businessId] } });
    await db.collection('callback_requests').deleteMany({ business_id: { $in: [salon.businessId, dentist.businessId] } });
    await dropTenants(salon.businessId, dentist.businessId);
  });

  it('CP-01 with no SMS/email provider the code request says so instead of pretending', async () => {
    fakeProvider(false);
    const res = await requestCode({ phone: PHONE });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not available right now/);
  });

  it('CP-02 a known and an unknown number get the same answer; only the known one gets a code', async () => {
    fakeProvider(true);
    const known = await requestCode({ phone: PHONE });
    const unknown = await requestCode({ phone: '+15559990000' });
    assert.equal(known.status, unknown.status);
    assert.deepEqual(await known.json(), await unknown.json());
    await row(() => db.collection('customer_login_codes').findOne({ business_id: salon.businessId })); // the code is written after the reply
    await wait(300); // time for a (wrongly) created second row to show up
    const rows = await db.collection('customer_login_codes').find({ business_id: salon.businessId }).toArray();
    assert.equal(rows.length, 1, 'only the real customer has a code');
    assert.ok(rows[0].code_hash && rows[0].expires_at > new Date());
  });

  it('CP-03 a resend within a minute does not replace the code', async () => {
    const before1 = await db.collection('customer_login_codes').findOne({ business_id: salon.businessId });
    await requestCode({ phone: PHONE });
    await wait(800);
    const after1 = await db.collection('customer_login_codes').findOne({ business_id: salon.businessId });
    assert.equal(String(after1.created_at), String(before1.created_at));
  });

  it('CP-04 the right code signs in, exactly once', async () => {
    const res = await signIn();
    assert.equal(res.status, 200);
    token = (await res.json()).token;
    const reused = await api(`/public/${slug}/portal/verify`, { method: 'POST', body: { phone: PHONE, code: '123456' } });
    assert.equal(reused.status, 401, 'a used code is gone');
    const me = await (await api('/customer/me', { auth: token })).json();
    assert.equal(me.name, 'Sara Portal');
    assert.equal(me.business.name, `Portal Salon ${tag}`);
  });

  it('CP-05 five wrong guesses lock the code, even for the right one', async () => {
    await signIn(OTHER, '654321'); // creates the row, then we burn it (consumes the valid sign-in)
    const bad = [];
    for (let i = 0; i < 6; i++) bad.push((await api(`/public/${slug}/portal/verify`, { method: 'POST', body: { phone: OTHER, code: '000000' } })).status);
    assert.ok(bad.every((s) => s === 401));
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: OTHER });
    await db.collection('customer_login_codes').replaceOne({ _id: `${salon.businessId}:${cust._id}` }, { business_id: salon.businessId, customer_id: cust._id, code_hash: await hashCode('654321'), attempts: 5, created_at: new Date(0), expires_at: new Date(Date.now() + 600_000) }, { upsert: true });
    const right = await api(`/public/${slug}/portal/verify`, { method: 'POST', body: { phone: OTHER, code: '654321' } });
    assert.equal(right.status, 401, 'locked after too many attempts');
  });

  it('CP-06 an expired code is refused', async () => {
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: OTHER });
    await db.collection('customer_login_codes').replaceOne({ _id: `${salon.businessId}:${cust._id}` }, { business_id: salon.businessId, customer_id: cust._id, code_hash: await hashCode('111111'), attempts: 0, created_at: new Date(0), expires_at: new Date(Date.now() - 1000) }, { upsert: true });
    assert.equal((await api(`/public/${slug}/portal/verify`, { method: 'POST', body: { phone: OTHER, code: '111111' } })).status, 401);
  });

  it('CP-07 sign-in also works by email, case-insensitively', async () => {
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: PHONE });
    await db.collection('customer_login_codes').replaceOne({ _id: `${salon.businessId}:${cust._id}` }, { business_id: salon.businessId, customer_id: cust._id, code_hash: await hashCode('222222'), attempts: 0, created_at: new Date(0), expires_at: new Date(Date.now() + 600_000) }, { upsert: true });
    const res = await api(`/public/${slug}/portal/verify`, { method: 'POST', body: { email: `SARA-${tag}@example.TEST`, code: '222222' } });
    assert.equal(res.status, 200);
  });

  it('CP-08 customer and company tokens do not work on each other\'s endpoints', async () => {
    assert.equal((await api('/services', { auth: token })).status, 401, 'customer token on a company route');
    assert.equal((await api('/customers', { auth: token })).status, 401);
    const adminId = newId();
    await db.collection('admins').insertOne({ _id: adminId, business_id: salon.businessId, email: `o-${tag}@example.test`, name: 'Owner', role: 'owner', status: 'active', password_hash: 'x' });
    const business = jwt.sign({ role: 'business', adminId, businessId: salon.businessId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await api('/customer/me', { auth: business })).status, 401, 'company token on a customer route');
    assert.equal((await api('/customer/me')).status, 401, 'no token');
    assert.equal((await api('/customer/me', { auth: 'garbage' })).status, 401);
    await db.collection('admins').deleteOne({ _id: adminId });
  });

  it('CP-09 the customer sees only their own appointments at this business', async () => {
    const mine = await createBooking(salon.businessId, { customerName: 'Sara', phone: PHONE, serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: slot(5) });
    await createBooking(salon.businessId, { customerName: 'Someone', phone: OTHER, serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: slot(5, 12) });
    await createBooking(dentist.businessId, { customerName: 'Sara', phone: PHONE, serviceId: dentist.serviceIds.haircut, staffId: dentist.staffIds['Dr Khan'], startTime: slot(6) });
    const past = await createBooking(salon.businessId, { customerName: 'Sara', phone: PHONE, serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: slot(-3) });
    await db.collection('bookings').updateOne({ _id: past.booking.id }, { $set: { status: 'completed' } });

    const list = await (await api('/customer/appointments', { auth: token })).json();
    assert.deepEqual(list.upcoming.map((b) => b.id), [mine.booking.id]);
    assert.equal(list.upcoming[0].reference, mine.booking.reference);
    assert.equal(list.upcoming[0].serviceName, 'haircut');
    assert.equal(list.upcoming[0].staffName, 'Jessica');
    assert.deepEqual(list.history.map((b) => b.id), [past.booking.id]);
    assert.equal(list.upcoming.length + list.history.length, 2, 'not the other customer and not the dentist');
  });

  it('CP-10 reschedule moves the booking; a taken or unoffered time is refused', async () => {
    const [mine] = (await (await api('/customer/appointments', { auth: token })).json()).upcoming;
    const free = await (await api(`/customer/appointments/${mine.id}/availability?date=${date(7)}`, { auth: token })).json();
    assert.ok(free.slots.length > 0);
    assert.equal((await api(`/customer/appointments/${mine.id}/reschedule`, { method: 'POST', auth: token, body: { startTime: free.slots[2] } })).status, 200);
    const moved = await db.collection('bookings').findOne({ _id: mine.id });
    assert.equal(moved.start_time.toISOString(), new Date(free.slots[2]).toISOString());
    assert.equal((await api(`/customer/appointments/${mine.id}/reschedule`, { method: 'POST', auth: token, body: { startTime: slot(7, 3) } })).status, 409, 'outside opening hours');
    assert.equal((await api(`/customer/appointments/${mine.id}/reschedule`, { method: 'POST', auth: token, body: { startTime: slot(-1) } })).status, 400, 'in the past');
  });

  it('CP-11 someone else\'s appointment id answers 404 on every action', async () => {
    const theirs = await db.collection('bookings').findOne({ business_id: salon.businessId, phone: OTHER });
    const dentists = await db.collection('bookings').findOne({ business_id: dentist.businessId, phone: PHONE });
    for (const id of [theirs._id, dentists._id]) {
      assert.equal((await api(`/customer/appointments/${id}/cancel`, { method: 'POST', auth: token })).status, 404);
      assert.equal((await api(`/customer/appointments/${id}/reschedule`, { method: 'POST', auth: token, body: { startTime: slot(9) } })).status, 404);
      assert.equal((await api(`/customer/appointments/${id}/availability?date=${date(9)}`, { auth: token })).status, 404);
    }
    assert.equal((await db.collection('bookings').findOne({ _id: theirs._id })).status, 'confirmed', 'untouched');
  });

  it('CP-12 cancel moves it to history and a second cancel is refused', async () => {
    const [mine] = (await (await api('/customer/appointments', { auth: token })).json()).upcoming;
    assert.equal((await api(`/customer/appointments/${mine.id}/cancel`, { method: 'POST', auth: token })).status, 200);
    assert.equal((await api(`/customer/appointments/${mine.id}/cancel`, { method: 'POST', auth: token })).status, 400);
    const list = await (await api('/customer/appointments', { auth: token })).json();
    assert.equal(list.upcoming.length, 0);
    assert.ok(list.history.some((b) => b.id === mine.id && b.status === 'cancelled'));
  });

  it('CP-13 a change inside the cutoff window is refused', async () => {
    await createBooking(salon.businessId, { customerName: 'Sara', phone: PHONE, serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: DateTime.utc().plus({ minutes: 45 }).startOf('minute').toISO() });
    const [soon] = (await (await api('/customer/appointments', { auth: token })).json()).upcoming;
    assert.equal(soon.canChange, false);
    assert.equal((await api(`/customer/appointments/${soon.id}/cancel`, { method: 'POST', auth: token })).status, 422);
  });

  it('CP-14 the customer edits their profile and preferences', async () => {
    const ok = await (await api('/customer/me', { method: 'PATCH', auth: token, body: { name: 'Sara P', smsOptIn: false, emailOptIn: true } })).json();
    assert.equal(ok.name, 'Sara P');
    assert.equal(ok.smsOptIn, false);
    assert.equal((await api('/customer/me', { method: 'PATCH', auth: token, body: { email: 'nope' } })).status, 400);
    assert.equal((await api('/customer/me', { method: 'PATCH', auth: token, body: { name: '  ' } })).status, 400);
    const row = await db.collection('customers').findOne({ business_id: salon.businessId, phone: PHONE });
    assert.equal(row.consent.smsOptIn, false);
  });

  it('CP-15 export holds only this customer\'s data; a delete request lands in the owner\'s queue once', async () => {
    const data = await (await api('/customer/export', { auth: token })).json();
    assert.equal(data.customer.phone, PHONE);
    assert.ok(!JSON.stringify(data).includes(OTHER));
    assert.ok(!JSON.stringify(data).includes('business_id'));
    assert.equal((await api('/customer/delete-request', { method: 'POST', auth: token })).status, 202);
    assert.equal((await api('/customer/delete-request', { method: 'POST', auth: token })).status, 202);
    const pending = await db.collection('callback_requests').find({ business_id: salon.businessId, source: 'portal-delete' }).toArray();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].status, 'pending');
  });

  it('CP-16 code requests are rate limited per number and per IP', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await requestCode({ phone: '+15550400099' })).status);
    assert.equal(codes.at(-1), 429);
    await clearRateLimits();
    assert.equal((await requestCode({ phone: '123' })).status, 400, 'bad number');
  });

  it('CP-17 every booking gets a short reference code and Bookings search finds it', async () => {
    const { booking } = await createBooking(salon.businessId, { customerName: 'Ref Test', phone: '+15550400050', serviceId: salon.serviceIds.haircut, staffId: salon.staffIds.Jessica, startTime: slot(12) });
    assert.match(booking.reference, /^[A-HJKMNP-Z2-9]{6}$/);
    const found = await listBookings(salon.businessId, { q: booking.reference.toLowerCase() });
    assert.deepEqual(found.map((b) => b.id), [booking.id]);
  });

  it('CP-18 an email request also stores a magic-link token; an SMS request does not', async () => {
    fakeProvider(true);
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: PHONE });
    await db.collection('customer_login_codes').deleteMany({ business_id: salon.businessId }); // start clean so the row we wait for is the new one
    await requestCode({ email: `Sara-${tag}@Example.test` });
    const emailRow = await row(() => db.collection('customer_login_codes').findOne({ _id: `${salon.businessId}:${cust._id}` }));
    assert.ok(emailRow.link_token_hash, 'email request gets a link token');

    await db.collection('customer_login_codes').deleteMany({ business_id: salon.businessId });
    await requestCode({ phone: OTHER });
    const other = await db.collection('customers').findOne({ business_id: salon.businessId, phone: OTHER });
    const smsRow = await row(() => db.collection('customer_login_codes').findOne({ _id: `${salon.businessId}:${other._id}` }));
    assert.equal(smsRow.link_token_hash, null, 'SMS has nowhere to put a link, so it gets none');
  });

  it('CP-19 the magic link signs in exactly once, same as a code', async () => {
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: PHONE });
    const id = `${salon.businessId}:${cust._id}`;
    await db.collection('customer_login_codes').replaceOne(
      { _id: id },
      { _id: id, business_id: salon.businessId, customer_id: cust._id, code_hash: await hashCode('333333'), link_token_hash: await hashCode('a-real-link-token'), attempts: 0, created_at: new Date(0), expires_at: new Date(Date.now() + 600_000) },
      { upsert: true }
    );
    const res = await api(`/public/${slug}/portal/magic`, { method: 'POST', body: { id, token: 'a-real-link-token' } });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).token);
    const reused = await api(`/public/${slug}/portal/magic`, { method: 'POST', body: { id, token: 'a-real-link-token' } });
    assert.equal(reused.status, 401, 'a used link is gone');
  });

  it('CP-20 a wrong token, and an id from another business, are both refused', async () => {
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: PHONE });
    const id = `${salon.businessId}:${cust._id}`;
    await db.collection('customer_login_codes').replaceOne(
      { _id: id },
      { _id: id, business_id: salon.businessId, customer_id: cust._id, code_hash: await hashCode('444444'), link_token_hash: await hashCode('correct-token'), attempts: 0, created_at: new Date(0), expires_at: new Date(Date.now() + 600_000) },
      { upsert: true }
    );
    assert.equal((await api(`/public/${slug}/portal/magic`, { method: 'POST', body: { id, token: 'wrong-token' } })).status, 401);
    const otherBizId = `${dentist.businessId}:${cust._id}`;
    assert.equal((await api(`/public/${slug}/portal/magic`, { method: 'POST', body: { id: otherBizId, token: 'correct-token' } })).status, 401, 'an id prefixed with another business is refused outright');
  });

  it('CP-21 wrong link guesses do not use up the code attempts, and the reverse (Jira 36)', async () => {
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: PHONE });
    const id = `${salon.businessId}:${cust._id}`;
    await db.collection('customer_login_codes').replaceOne(
      { _id: id },
      { _id: id, business_id: salon.businessId, customer_id: cust._id, code_hash: await hashCode('555555'), link_token_hash: await hashCode('good-link'), attempts: 0, link_attempts: 0, created_at: new Date(0), expires_at: new Date(Date.now() + 600_000) },
      { upsert: true }
    );
    for (let i = 0; i < 5; i++) await api(`/public/${slug}/portal/magic`, { method: 'POST', body: { id, token: 'bad' } });
    assert.equal((await api(`/public/${slug}/portal/verify`, { method: 'POST', body: { phone: PHONE, code: '555555' } })).status, 200, 'the real code still works');
  });

  it('CP-22 "sign out everywhere" ends every earlier sign-in at once (Jira 36i)', async () => {
    const cust = await db.collection('customers').findOne({ business_id: salon.businessId, phone: PHONE });
    const first = signCustomerToken(salon.businessId, cust._id);
    assert.equal((await api('/customer/me', { auth: first })).status, 200);
    await new Promise((r) => setTimeout(r, 1100)); // tokens are stamped to the second
    assert.equal((await api('/customer/sign-out-everywhere', { method: 'POST', auth: first })).status, 200);
    assert.equal((await api('/customer/me', { auth: first })).status, 401, 'the old token is dead');
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal((await api('/customer/me', { auth: signCustomerToken(salon.businessId, cust._id) })).status, 200, 'a fresh sign-in works');
  });
});
