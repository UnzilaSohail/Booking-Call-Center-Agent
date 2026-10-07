// Reminders with "Reply C to cancel", the waiting list, review requests, the money-saved and no-show numbers, and the
// monthly report (Jira 38 to 41). Group EN in docs/testing/TEST_CASES.md.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DateTime } from 'luxon';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { app } from '../src/app.js';
import { clearRateLimits } from '../src/rateLimit.js';
import { createBooking, cancelBooking } from '../src/services/bookingService.js';
import { reminderTexts } from '../src/notifications/notify.js';
import { runReminderSweepOnce } from '../src/notifications/reminder-worker.js';
import { cancelNextByReply } from '../src/webhooks/twilio.js';
import { joinWaitlist, notifyWaitlistForCancellation, listWaitlist } from '../src/services/waitlistService.js';
import { runReviewSweepOnce } from '../src/services/reviewService.js';
import { getImpact } from '../src/services/analyticsService.js';
import { buildMonthlyReport, formatReport, runMonthlyReportSweepOnce } from '../src/services/reportService.js';

const tag = newId().slice(0, 8);
const NY = 'America/New_York';
const soon = (hours) => new Date(Date.now() + hours * 3_600_000);

describe('reminders, waiting list, reviews and reports', { skip }, () => {
  let db; let server; let base; let t; let slug; let svc; let staff;
  const business = () => ({ id: t.businessId, name: `Engage ${tag}`, timezone: NY, slug, contact_phone: '+18135550100', reschedule_cutoff_minutes: 120 });
  const book = (hoursAhead, phone, over = {}) => createBooking(t.businessId, { customerName: 'Sara Test', phone, serviceId: svc, staffId: staff, startTime: soon(hoursAhead).toISOString(), ...over });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: `Engage ${tag}`, timezone: NY, services: [{ name: 'haircut', duration: 30, buffer: 0 }], staff: ['Jessica', 'Sam'] });
    svc = t.serviceIds.haircut; staff = t.staffIds.Jessica;
    slug = `engage-${tag}`;
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { slug, booking_page_enabled: true, onboarding_completed_at: new Date(), contact_email: 'owner@example.test', phone_number: '+18135550199' } });
    await db.collection('services').updateOne({ _id: svc }, { $set: { price: 40 } });
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  beforeEach(() => clearRateLimits());
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.collection('waitlist').deleteMany({ business_id: t.businessId });
    await dropTenants(t.businessId);
  });

  // ---------------- reminders ----------------
  it('EN-01 the reminder text says "Reply C to cancel"; the email just links (Jira 40)', () => {
    const b = { ...business(), id: t.businessId };
    const booking = { id: 'bk1', start_time: soon(24), manage_token: undefined };
    const { smsText, emailText } = reminderTexts(b, { ...booking, business_id: t.businessId, start_time: soon(24) }, { name: 'haircut' }, '24h');
    assert.match(smsText, /tomorrow/);
    assert.match(smsText, /Reply C to cancel/);
    assert.doesNotMatch(emailText, /Reply C/);
    assert.match(reminderTexts(b, { id: 'bk2', start_time: soon(2) }, { name: 'haircut' }, '2h').smsText, /in about 2 hours/);
  });

  it('EN-02 a booking 2 hours away gets the 2-hour reminder once, and the 24-hour one when it is a day away', async () => {
    // the sweep looks 10 minutes back from each mark, so a booking 1h55 away is due its 2-hour reminder
    const two = await book(1.95, '+15550109001', { staffId: t.staffIds.Sam });
    const day = await book(23.95, '+15550109002', { staffId: t.staffIds.Sam });
    const calls = [];
    const send = async (biz, booking, service, label) => { calls.push(`${booking._id}:${label}`); };
    await runReminderSweepOnce({ send, businessIds: [t.businessId] });
    await runReminderSweepOnce({ send, businessIds: [t.businessId] });
    assert.ok(calls.includes(`${two.booking.id}:2h`), 'the 2-hour reminder went out');
    assert.ok(calls.includes(`${day.booking.id}:24h`), 'the 24-hour reminder went out');
    assert.equal(calls.filter((c) => c === `${two.booking.id}:2h`).length, 1, 'only once, even with two sweeps');
    assert.ok((await db.collection('bookings').findOne({ _id: two.booking.id })).reminder_2h_sent_at, 'marked as sent');
  });

  // ---------------- "C" cancels ----------------
  it('EN-03 replying C cancels the next appointment, frees the time and records it was by text (Jira 40)', async () => {
    const mine = await book(30, '+15550109010', { staffId: t.staffIds.Sam });
    const answer = await cancelNextByReply(business(), '+15550109010');
    assert.match(answer, /cancelled/);
    assert.match(answer, new RegExp(`/book/${slug}`), 'offers a way to book again');
    const row = await db.collection('bookings').findOne({ _id: mine.booking.id });
    assert.equal(row.status, 'cancelled');
    assert.equal(row.cancelled_via, 'sms_reply');
    assert.ok(row.cancelled_at);
    assert.equal(await db.collection('booking_slot_locks').countDocuments({ booking_id: mine.booking.id }), 0, 'the time is free again');
  });

  it('EN-04 a C reply too close to the appointment is refused with the phone number; nothing is cancelled', async () => {
    const close = await book(1, '+15550109011', { staffId: t.staffIds.Sam });
    const answer = await cancelNextByReply(business(), '+15550109011');
    assert.match(answer, /too close/);
    assert.match(answer, /\+18135550100/);
    assert.equal((await db.collection('bookings').findOne({ _id: close.booking.id })).status, 'confirmed');
  });

  it('EN-05 a C from a number with no appointment gets a polite answer', async () => {
    assert.match(await cancelNextByReply(business(), '+15550109999'), /could not find an upcoming appointment/);
  });

  // ---------------- waiting list ----------------
  const joinOver = (over = {}) => fetch(`${base}/api/public/${slug}/waitlist`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serviceId: svc, staffId: 'any', date: DateTime.now().setZone(NY).plus({ days: 3 }).toISODate(), name: 'Wanda Waiting', phone: '+15550109020', consent: { sms: true }, ...over }),
  });

  it('EN-07 a customer joins the waiting list from the public page; a second request is not a second place (Jira 38)', async () => {
    assert.equal((await joinOver()).status, 201);
    const again = await joinOver();
    assert.equal((await again.json()).alreadyOnList, true);
    assert.equal(await db.collection('waitlist').countDocuments({ business_id: t.businessId, phone: '+15550109020' }), 1);
  });

  it('EN-08 the waiting list needs the customer\'s OK to text, a real day and a real service', async () => {
    assert.equal((await joinOver({ consent: { sms: false } })).status, 400);
    assert.equal((await joinOver({ date: '2020-01-01' })).status, 400);
    assert.equal((await joinOver({ serviceId: { $ne: null } })).status, 400);
    assert.equal((await joinOver({ serviceId: 'no-such-service' })).status, 404);
    assert.equal((await joinOver({ phone: '12' })).status, 400);
  });

  it('EN-09 when a booking for that service and day is cancelled, the first people in line are texted once (Jira 38)', async () => {
    const day = DateTime.now().setZone(NY).plus({ days: 5 }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
    const target = day.toISODate();
    for (const [i, phone] of ['+15550109031', '+15550109032', '+15550109033', '+15550109034'].entries()) {
      await db.collection('waitlist').insertOne({ _id: newId(), business_id: t.businessId, service_id: svc, staff_id: null, date: target, name: `Person ${i}`, phone, status: 'waiting', created_at: new Date(Date.now() + i), expire_at: new Date(Date.now() + 9 * 86_400_000) });
    }
    const booked = await createBooking(t.businessId, { customerName: 'Leaver', phone: '+15550109030', serviceId: svc, staffId: staff, startTime: day.toUTC().toISO() });
    const texts = [];
    const send = async (id, to, body) => { texts.push({ to, body }); };
    const cancelled = await db.collection('bookings').findOneAndUpdate({ _id: booked.booking.id }, { $set: { status: 'cancelled' } }, { returnDocument: 'after' });
    // the time of day must not be "quiet hours" for the test, whatever the clock says
    const quiet = DateTime.now().setZone(NY).hour >= 21 || DateTime.now().setZone(NY).hour < 8;
    const n = await notifyWaitlistForCancellation(t.businessId, cancelled, { send });
    if (quiet) { assert.equal(n, 0, 'no texts at night'); return; }
    assert.equal(n, 3, 'only the first three in line');
    assert.deepEqual(texts.map((x) => x.to), ['+15550109031', '+15550109032', '+15550109033']);
    assert.match(texts[0].body, new RegExp(`/book/${slug}`));
    assert.equal(await notifyWaitlistForCancellation(t.businessId, cancelled, { send }), 1, 'the next one in line is texted on the next cancellation, nobody twice');
    const rows = await listWaitlist(t.businessId);
    assert.equal(rows.filter((r) => r.date === target && r.status === 'notified').length, 4);
  });

  it('EN-10 someone on the list who then books is counted as a refilled slot', async () => {
    const day = DateTime.now().setZone(NY).plus({ days: 6 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    await joinWaitlist({ id: t.businessId, timezone: NY }, { serviceId: svc, date: day.toISODate(), name: 'Rita Refill', phone: '+15550109040' });
    await createBooking(t.businessId, { customerName: 'Rita Refill', phone: '+15550109040', serviceId: svc, staffId: staff, startTime: day.toUTC().toISO() });
    let row = null;
    for (let i = 0; i < 30 && row?.status !== 'booked'; i++) { row = await db.collection('waitlist').findOne({ business_id: t.businessId, phone: '+15550109040' }); if (row?.status !== 'booked') await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(row.status, 'booked');
  });

  // ---------------- review requests ----------------
  it('EN-11 a review text goes out about 2 hours after the visit, once, only with a link set and consent (Jira 39)', async () => {
    const noon = DateTime.now().setZone(NY).startOf('day').plus({ hours: 12 });
    const past = await db.collection('bookings').insertOne({ _id: newId(), business_id: t.businessId, customer_name: 'Rev Iew', phone: '+15550109050', service_id: svc, staff_id: staff, start_time: new Date(noon.toMillis() - 3 * 3_600_000), end_time: new Date(noon.toMillis() - 2.5 * 3_600_000), status: 'confirmed', created_at: new Date() });
    const texts = [];
    const send = async (id, to, body) => { texts.push({ to, body }); };
    const now = noon.toMillis();
    assert.equal(await runReviewSweepOnce({ send, now, businessIds: [t.businessId] }), 0, 'no review link set yet: nothing is sent');
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { review_link: 'https://g.page/r/example/review' } });
    assert.equal(await runReviewSweepOnce({ send, now, businessIds: [t.businessId] }), 1);
    assert.match(texts[0].body, /g\.page\/r\/example\/review/);
    assert.match(texts[0].body, /Rev/);
    assert.equal(await runReviewSweepOnce({ send, now, businessIds: [t.businessId] }), 0, 'asked once');
    assert.ok((await db.collection('bookings').findOne({ _id: past.insertedId })).review_request_sent_at);
  });

  it('EN-12 no review text at night, none for cancelled visits, none within 30 days of the last one', async () => {
    const day = DateTime.now().setZone(NY).startOf('day');
    const mk = (phone, status = 'confirmed') => db.collection('bookings').insertOne({ _id: newId(), business_id: t.businessId, customer_name: 'N N', phone, service_id: svc, staff_id: staff, start_time: new Date(day.plus({ hours: 8 }).toMillis()), end_time: new Date(day.plus({ hours: 8.5 }).toMillis()), status, created_at: new Date() });
    await mk('+15550109060'); await mk('+15550109061', 'cancelled');
    const send = async () => {};
    assert.equal(await runReviewSweepOnce({ send, now: day.plus({ hours: 22 }).toMillis(), businessIds: [t.businessId] }), 0, '10pm: wait for the morning');
    assert.equal(await runReviewSweepOnce({ send, now: day.plus({ hours: 11 }).toMillis(), businessIds: [t.businessId] }), 1, 'morning: sent, and the cancelled visit was skipped');
    await db.collection('customers').insertOne({ _id: newId(), business_id: t.businessId, phone: '+15550109062', name: 'Recent', last_review_request_at: new Date(), consent: {}, created_at: new Date() });
    await mk('+15550109062');
    assert.equal(await runReviewSweepOnce({ send, now: day.plus({ hours: 11 }).toMillis(), businessIds: [t.businessId] }), 0, 'asked this customer recently');
  });

  // ---------------- numbers ----------------
  it('EN-13 money saved: only after-hours calls that became confirmed bookings count (Jira 41)', async () => {
    const from = new Date(Date.now() - 86_400_000); const to = new Date(Date.now() + 60_000);
    const b1 = await book(70, '+15550109070', { staffId: t.staffIds.Sam });
    const b2 = await book(71, '+15550109071', { staffId: t.staffIds.Sam });
    await cancelBooking(t.businessId, b2.booking.id);
    await db.collection('call_logs').insertMany([
      { _id: newId(), business_id: t.businessId, call_sid: `a${tag}1`, created_at: new Date(), is_after_hours: true, booking_id: b1.booking.id, outcome: 'completed' },
      { _id: newId(), business_id: t.businessId, call_sid: `a${tag}2`, created_at: new Date(), is_after_hours: true, booking_id: b2.booking.id, outcome: 'completed' },
      { _id: newId(), business_id: t.businessId, call_sid: `a${tag}3`, created_at: new Date(), is_after_hours: true, booking_id: null, outcome: 'completed' },
      { _id: newId(), business_id: t.businessId, call_sid: `a${tag}4`, created_at: new Date(), is_after_hours: false, booking_id: b1.booking.id, outcome: 'completed' },
    ]);
    const { afterHours } = await getImpact(t.businessId, from, to);
    assert.equal(afterHours.calls, 3, 'calls answered while closed');
    assert.equal(afterHours.bookings, 1, 'one became a confirmed booking (the other was cancelled)');
    assert.equal(afterHours.value, 40, 'worth the haircut price');
  });

  it('EN-14 no-show protection: cancelled by the customer after a reminder and before the visit; staff cancels do not count', async () => {
    const mk = async (hours, via, reminder) => {
      const r = await book(hours, `+1555010908${Math.floor(Math.random() * 9)}${Math.floor(Math.random() * 9)}`, { staffId: t.staffIds.Sam });
      await db.collection('bookings').updateOne({ _id: r.booking.id }, { $set: { status: 'cancelled', cancelled_via: via, cancelled_at: new Date(), ...(reminder ? { reminder_24h_sent_at: new Date(Date.now() - 3_600_000) } : {}) } });
    };
    const before = (await getImpact(t.businessId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000))).reminders;
    await mk(90, 'sms_reply', true);   // counts
    await mk(92, 'portal', true);      // counts
    await mk(94, 'dashboard', true);   // staff cancelled: does not count
    await mk(96, 'sms_reply', false);  // no reminder had gone out: does not count
    const after = (await getImpact(t.businessId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000))).reminders;
    assert.equal(after.cancelledInTime - before.cancelledInTime, 2);
    assert.equal(after.valueFreed - before.valueFreed, 80);
    assert.equal(after.viaReply - before.viaReply, 2, 'both text-reply cancels, including the one with no reminder');
  });

  // ---------------- monthly report ----------------
  it('EN-15 the monthly report puts the numbers in plain words and leaves out empty sections (Jira 41)', async () => {
    const stats = await buildMonthlyReport(t.businessId, new Date(Date.now() - 30 * 86_400_000), new Date(Date.now() + 90 * 86_400_000));
    const { subject, text } = formatReport({ name: 'Glow' }, stats, 'September 2026');
    assert.match(subject, /Glow: your September 2026/);
    assert.match(text, /Calls answered by the AI receptionist: \d+/);
    assert.match(text, /While you were closed: the AI answered 3 calls and made 1 booking worth \$40/);
    const quiet = formatReport({ name: 'Glow' }, { calls: 0, booked: 0, bookings: 0, revenue: 0, newCustomers: 0, cancelled: 0, topService: null, impact: { afterHours: { calls: 0, bookings: 0, value: 0 }, reminders: { sent: 0, cancelledInTime: 0, valueFreed: 0, viaReply: 0, waitlistRefilled: 0 } } }, 'x');
    assert.doesNotMatch(quiet.text, /While you were closed|Reminders:|Waiting list/);
  });

  it('EN-16 the sweep sends last month\'s report once, in the first 3 days of the month from 9am, and respects the off switch', async () => {
    const sent = [];
    const send = async (to, subject) => { sent.push({ to, subject }); return { sent: true }; };
    const now = DateTime.fromObject({ year: 2031, month: 5, day: 2, hour: 10 }, { zone: NY });
    const lastMonth = DateTime.fromObject({ year: 2031, month: 4, day: 12, hour: 12 }, { zone: NY });
    await db.collection('bookings').insertOne({ _id: newId(), business_id: t.businessId, customer_name: 'April', phone: '+15550109080', service_id: svc, staff_id: staff, start_time: new Date(lastMonth.toMillis()), end_time: new Date(lastMonth.toMillis() + 1_800_000), status: 'confirmed', created_at: new Date() });
    const mine = () => sent.filter((s) => s.to === 'owner@example.test');
    await runMonthlyReportSweepOnce({ send, now: DateTime.fromObject({ year: 2031, month: 5, day: 2, hour: 7 }, { zone: NY }) });
    assert.equal(mine().length, 0, 'before 9am: not yet');
    await runMonthlyReportSweepOnce({ send, now: DateTime.fromObject({ year: 2031, month: 5, day: 20, hour: 10 }, { zone: NY }) });
    assert.equal(mine().length, 0, 'the 20th: too late to send last month');
    await runMonthlyReportSweepOnce({ send, now });
    await runMonthlyReportSweepOnce({ send, now });
    assert.equal(mine().length, 1, 'once');
    assert.match(mine()[0].subject, /April 2031/);
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { monthly_report_enabled: false }, $unset: { monthly_report_sent_for: '' } });
    await runMonthlyReportSweepOnce({ send, now });
    assert.equal(mine().length, 1, 'owner turned it off: nothing more');
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { monthly_report_enabled: true } });
  });
});
