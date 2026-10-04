// Demo data (Jira "Demo data"): realistic fake businesses with ~2.5 months of bookings, calls, customers and
// invoices, so a person opening the dashboard sees a busy product instead of empty screens. Used by the
// platform console (add/remove button), the CLI (npm run demo:seed / demo:remove) and the recorded walkthrough.
//
// Rules this file keeps:
//  - Every document it creates is reachable from a business flagged `demo: true`, and removeDemoData() deletes
//    exactly those. It never touches a real business.
//  - Rows are inserted directly, NOT through createBooking, so nothing sends a real SMS/email to a made-up number.
//  - The numbers are generated from a fixed seed, so every run looks the same (graphs included).
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { getDb, newId } from '../db.js';
import { initialBillingFields } from '../billing/plans.js';
import { lockDocs, makeReference } from './bookingService.js';

export const DEMO_ACCOUNTS = {
  owner: 'owner@glowstudio.example.test',
  newOwner: 'newbie@sunrisedental.example.test',
  platform: 'platform@demo.example.test',
};
export const DEMO_SLUGS = { glow: 'glow-studio', miami: 'glow-studio-miami', dentist: 'bright-smiles-dental' };

const TZ = 'America/New_York';
const HISTORY_DAYS = 75;
const AHEAD_DAYS = 14;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '18:00' }));
const TENANT_COLLECTIONS = [
  'services', 'staff', 'locations', 'bookings', 'booking_slot_locks', 'customers', 'call_logs', 'failed_bookings', 'sms_sends',
  'staff_time_off', 'callback_requests', 'voicemails', 'customer_login_codes', 'invoices', 'payment_failures', 'audit_logs',
];

const NAMES = [
  'Sara Ahmed', 'Mia Chen', 'Omar Farooq', 'Liam Walker', 'Priya Nair', 'Noah Johnson', 'Emma Davis', 'Ava Martinez', 'Lucas Brown', 'Sofia Garcia',
  'Ethan Wilson', 'Isabella Lopez', 'Mason Lee', 'Amelia Clark', 'Logan Hall', 'Harper Young', 'Elijah King', 'Layla Hassan', 'James Scott', 'Chloe Adams',
  'Daniel Perez', 'Grace Turner', 'Henry Campbell', 'Zoe Mitchell', 'Jack Roberts', 'Nora Evans', 'Samuel Reed', 'Ella Cooper', 'Aiden Morgan', 'Lily Bailey',
  'Ryan Foster', 'Maya Patel', 'Caleb Ward', 'Hana Sato', 'Owen Price', 'Ruby Gray',
];
const FIXED_PHONES = { 'Sara Ahmed': '+15550100001', 'Mia Chen': '+15550100003', 'Omar Farooq': '+15550100004' };

// Same input -> same output, so graphs and names are identical on every machine.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const generatePassword = () => `Demo-${randomBytes(6).toString('base64url')}9`;

export async function demoStatus() {
  const db = await getDb();
  const rows = await db.collection('businesses').find({ demo: true }, { projection: { name: 1, slug: 1, 'listing.listed': 1 } }).toArray();
  return { present: rows.length > 0, businesses: rows.map((b) => ({ name: b.name, slug: b.slug, listed: !!b.listing?.listed })) };
}

export async function removeDemoData() {
  const db = await getDb();
  const ids = (await db.collection('businesses').find({ demo: true }, { projection: { _id: 1 } }).toArray()).map((b) => b._id);
  for (const c of TENANT_COLLECTIONS) await db.collection(c).deleteMany({ business_id: { $in: ids } });
  await db.collection('admins').deleteMany({ business_id: { $in: ids } });
  await db.collection('businesses').deleteMany({ demo: true });
  await db.collection('platform_admins').deleteMany({ email: DEMO_ACCOUNTS.platform });
  await db.collection('leads').deleteMany({ demo: true });
  return ids.length;
}

const TEMPLATES = (biz, svc, who, when, day) => [
  `agent: Thanks for calling ${biz}. How can I help you today?\ncaller: Hi, I'd like to book a ${svc}.\nagent: Happy to help. What day works for you?\ncaller: ${day} if possible.\nagent: I have ${when}${who ? ` with ${who}` : ''}. Shall I book that?\ncaller: Yes please.\nagent: Done! You're booked for ${day} at ${when}. I've texted you a confirmation.`,
  `agent: ${biz}, this is the AI assistant. What can I do for you?\ncaller: Can I get a ${svc} this week?\nagent: Of course. ${when} on ${day} is open${who ? ` with ${who}` : ''}.\ncaller: That works.\nagent: Lovely, you're all set. You'll get a text reminder the day before.`,
];

// ---- one booking row (plus slot locks for future confirmed ones) ----
function bookingRow(biz, { svc, staff, locationId, customer, start, status, via, now, flawed }) {
  const id = newId();
  const end = new Date(start.getTime() + svc.duration_minutes * 60_000);
  const past = start < now;
  const row = {
    _id: id, business_id: biz, customer_name: customer.name, phone: customer.phone, customer_email: customer.email ?? null,
    service_id: svc._id, staff_id: staff?._id ?? null, location_id: locationId ?? null, start_time: start, end_time: end,
    status, reference: makeReference(), google_event_id: null, created_via: via, is_test: false,
    created_at: new Date(Math.min(now.getTime(), start.getTime() - (1 + (id.charCodeAt(0) % 4)) * 86_400_000)),
    sync_status: 'synced', sync_attempts: 0, sync_error: null,
    confirmation_sent_at: new Date(Math.min(now.getTime(), start.getTime() - 86_400_000)), confirmation_sms_status: 'sent', confirmation_sms_error: null,
    confirmation_email_status: customer.email ? 'sent' : 'no_contact',
    reminder_24h_sent_at: past ? new Date(start.getTime() - 86_400_000) : null, reminder_1h_sent_at: past ? new Date(start.getTime() - 3_600_000) : null,
  };
  if (status === 'cancelled') row.cancelled_at = new Date(Math.min(now.getTime(), start.getTime() - 3_600_000 * 20));
  if (flawed === 'sms') { row.confirmation_sms_status = 'failed'; row.confirmation_sms_error = 'Carrier rejected the message (number cannot receive texts)'; }
  if (flawed === 'sync') { row.sync_status = 'failed'; row.sync_attempts = 3; row.sync_error = 'Google Calendar is not connected for this business'; }
  const locks = status === 'confirmed' && !past ? lockDocs(biz, id, staff?._id ?? null, start, end) : [];
  return { row, locks };
}

export async function addDemoData({ listed = false, password = generatePassword() } = {}) {
  await removeDemoData();
  const db = await getDb();
  const rng = prng(20261003);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const hash = await bcrypt.hash(password, 10);
  const now = new Date();
  const today = DateTime.now().setZone(TZ).startOf('day');
  const at = (days, hour) => today.plus({ days }).set({ hour }).toUTC().toJSDate();

  const business = (fields) => ({
    status: 'active', timezone: TZ, hours: ALL_DAYS, google_calendar_id: 'primary', reschedule_cutoff_minutes: 120, faqs: [],
    created_at: new Date(now.getTime() - 80 * 86_400_000), demo: true, booking_page_enabled: true, ...initialBillingFields(now), ...fields,
  });
  const listing = (categories, city, description, lat, lng) => ({ listed, categories, city, region: 'FL', country: 'US', description, lat, lng });
  const owner = (biz, name, email, n) => ({
    _id: newId(), business_id: biz, name, email, phone: `+15550009${String(n).padStart(3, '0')}`, password_hash: hash, role: 'owner', status: 'active',
    terms_accepted_at: new Date(), email_verified_at: new Date(), phone_verified_at: new Date(), created_at: new Date(),
  });

  // ---------------- Glow Studio, Tampa: the busy flagship ----------------
  const glow = newId();
  const periodStart = new Date(now.getTime() - 18 * 86_400_000);
  await db.collection('businesses').insertOne(business({
    _id: glow, name: 'Glow Studio', slug: DEMO_SLUGS.glow, industry: 'Salon / Spa', address: '100 Bayshore Blvd, Tampa FL', contact_phone: '+18135550142',
    contact_email: DEMO_ACCOUNTS.owner, phone_number: '+18135550142', onboarding_completed_at: new Date(), test_call_at: new Date(), voice_name: 'Aoede',
    faqs: [{ question: 'Do you take walk-ins?', answer: 'Yes, when we have a free chair.' }, { question: 'Is there parking?', answer: 'Free parking behind the building.' }],
    google_refresh_token: null, listing: listing(['hair-salon'], 'Tampa', 'Cuts, colour and facials in the heart of Tampa.', 27.9, -82.46),
    plan: 'growth', trial_ends_at: new Date(now.getTime() - 40 * 86_400_000), card_brand: 'visa', card_last4: '4242',
    current_period_start: periodStart, current_period_end: new Date(periodStart.getTime() + 30 * 86_400_000),
  }));
  await db.collection('admins').insertOne(owner(glow, 'Aiza Owner', DEMO_ACCOUNTS.owner, 1));

  const north = newId();
  const south = newId();
  await db.collection('locations').insertMany([
    { _id: north, business_id: glow, name: 'Bayshore Branch', address: '100 Bayshore Blvd, Tampa', is_primary: true, created_at: new Date() },
    { _id: south, business_id: glow, name: 'Downtown Branch', address: '22 Franklin St, Tampa', is_primary: false, created_at: new Date() },
  ]);
  const S = {
    haircut: { _id: newId(), business_id: glow, name: 'Haircut', duration_minutes: 30, buffer_minutes: 0, price: 40 },
    facial: { _id: newId(), business_id: glow, name: 'Facial', duration_minutes: 60, buffer_minutes: 0, price: 80 },
    colour: { _id: newId(), business_id: glow, name: 'Colour', duration_minutes: 90, buffer_minutes: 15, price: 120 },
  };
  await db.collection('services').insertMany(Object.values(S));
  const T = {
    jessica: { _id: newId(), business_id: glow, name: 'Jessica', location_id: north, service_ids: [S.haircut._id, S.facial._id, S.colour._id] },
    sam: { _id: newId(), business_id: glow, name: 'Sam', location_id: south, service_ids: [S.haircut._id] },
    flo: { _id: newId(), business_id: glow, name: 'Flo', service_ids: [S.haircut._id, S.facial._id] },
  };
  await db.collection('staff').insertMany(Object.values(T));
  const staffFor = (svc) => Object.values(T).filter((t) => t.service_ids.includes(svc._id));

  // customers: 36 regulars (the first few are the walkthrough's named people) plus a duplicate pair to merge
  const people = NAMES.map((name, i) => ({
    name, phone: FIXED_PHONES[name] ?? `+1555010${String(2000 + i)}`,
    email: i % 3 === 0 ? `${name.toLowerCase().replace(/\W+/g, '.')}@example.test` : null,
  }));
  const dupe = { name: 'S. Ahmed', phone: '+15550100002', email: people[0].email ?? 'sara.ahmed@example.test' };
  people[0].email ??= 'sara.ahmed@example.test';
  const bookingCount = new Map();

  const rows = [];
  const locks = [];
  const calls = [];
  const used = new Set();
  const cellKeys = (staff, start, mins) => Array.from({ length: Math.ceil(mins / 30) }, (_, i) => `${staff?._id ?? 'none'}|${start.getTime() + i * 1_800_000}`);
  const claim = (staff, start, mins) => {
    const keys = cellKeys(staff, start, mins);
    if (keys.some((k) => used.has(k))) return false;
    keys.forEach((k) => used.add(k));
    return true;
  };
  const add = (opts) => {
    const { row, locks: l } = bookingRow(glow, { ...opts, now });
    rows.push(row); locks.push(...l);
    if (row.status === 'confirmed') bookingCount.set(row.phone, (bookingCount.get(row.phone) ?? 0) + 1);
    return row;
  };
  const locationOf = (staff) => staff?.location_id ?? north;

  // the six bookings the guided walkthrough talks about (some with a deliberately failed confirmation)
  const fixed = [
    ['Sara Ahmed', S.haircut, T.jessica, at(1, 10), 'web', null],
    [dupe, S.facial, T.flo, at(3, 14), 'call', 'sms'],
    ['Mia Chen', S.colour, T.jessica, at(2, 11), 'dashboard', null],
    ['Omar Farooq', S.haircut, T.sam, at(2, 15), 'call', 'sync'],
    ['Mia Chen', S.facial, T.jessica, at(5, 13), 'web', null],
  ];
  let firstFixed = null;
  let jessicaBookedAt = null;
  for (const [who, svc, staff, start, via, flawed] of fixed) {
    const customer = typeof who === 'string' ? people.find((p) => p.name === who) : who;
    claim(staff, start, svc.duration_minutes);
    const r = add({ svc, staff, locationId: locationOf(staff), customer, start, status: 'confirmed', via, flawed });
    firstFixed ??= r;
    if (svc === S.facial && staff === T.jessica) jessicaBookedAt = r.start_time;
  }
  const omar = people.find((p) => p.name === 'Omar Farooq');
  claim(T.sam, at(4, 16), 30);
  add({ svc: S.haircut, staff: T.sam, locationId: south, customer: omar, start: at(4, 16), status: 'cancelled', via: 'web' });

  // 75 days of history and two weeks ahead; busier as time goes on so the graph climbs
  const weights = [[S.haircut, 0.45], [S.facial, 0.3], [S.colour, 0.25]];
  const pickService = () => { let r = rng(); for (const [s, w] of weights) { if ((r -= w) < 0) return s; } return S.haircut; };
  const pickVia = () => { const r = rng(); return r < 0.4 ? 'call' : r < 0.72 ? 'web' : 'dashboard'; };
  for (let d = -HISTORY_DAYS; d <= AHEAD_DAYS; d++) {
    const day = today.plus({ days: d });
    const growth = 0.55 + 0.45 * Math.min(1, (d + HISTORY_DAYS) / HISTORY_DAYS);
    let n = Math.round((day.weekday >= 6 ? 3.2 : 5.6) * growth + (rng() * 2 - 1));
    if (d > 0) n = Math.round(n * Math.max(0.15, 1 - d / 18));
    for (let i = 0; i < Math.max(0, n); i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const svc = pickService();
        const staff = pick(staffFor(svc));
        const room = 540 - svc.duration_minutes - svc.buffer_minutes;
        const start = day.set({ hour: 9 }).plus({ minutes: 30 * Math.floor(rng() * (Math.floor(room / 30) + 1)) }).toUTC().toJSDate();
        if (!claim(staff, start, svc.duration_minutes + svc.buffer_minutes)) continue;
        const customer = people[Math.floor(rng() * rng() * people.length)];
        add({ svc, staff, locationId: locationOf(staff), customer, start, status: rng() < (d < 0 ? 0.09 : 0.05) ? 'cancelled' : 'confirmed', via: pickVia() });
        break;
      }
    }
  }
  await db.collection('bookings').insertMany(rows);
  if (locks.length) await db.collection('booking_slot_locks').insertMany(locks);

  const customers = [...people, dupe].map((p) => {
    const n = bookingCount.get(p.phone) ?? 0;
    return {
      _id: newId(), business_id: glow, name: p.name, phone: p.phone, email: p.email, notes: n >= 6 ? 'Prefers morning appointments.' : null, tags: n >= 6 ? ['VIP'] : [],
      preferences: { preferredStaffId: null, preferredServiceId: null, preferredContactMethod: null, language: null },
      consent: { recordingAcknowledged: n > 0, smsOptIn: true, emailOptIn: true },
      created_at: new Date(now.getTime() - (20 + Math.floor(rng() * 55)) * 86_400_000), updated_at: new Date(now.getTime() - Math.floor(rng() * 30) * 86_400_000),
    };
  });
  await db.collection('customers').insertMany(customers);

  // ---- calls: one per phone booking (with a transcript), plus enquiries, transfers, voicemail, a failed one ----
  const svcName = (id) => Object.values(S).find((s) => s._id === id)?.name ?? 'appointment';
  const staffName = (id) => Object.values(T).find((t) => t._id === id)?.name ?? null;
  const fmtDay = (dt) => DateTime.fromJSDate(dt).setZone(TZ).toFormat('cccc');
  const fmtTime = (dt) => DateTime.fromJSDate(dt).setZone(TZ).toFormat('h:mm a');
  const phoneBooked = rows.filter((r) => r.created_via === 'call' && r.status !== 'cancelled' && r.created_at > new Date(now.getTime() - 62 * 86_400_000));
  for (const r of phoneBooked) {
    const dur = 70 + Math.floor(rng() * 170);
    const started = new Date(Math.min(now.getTime() - 600_000, r.created_at.getTime()));
    calls.push({
      _id: newId(), business_id: glow, call_sid: `CAdemo${calls.length}`, phone: r.phone, created_at: started, ended_at: new Date(started.getTime() + dur * 1000), duration_seconds: dur,
      outcome: 'completed', intent: 'booking', is_after_hours: false, booking_id: r._id,
      summary: `${r.customer_name} booked a ${svcName(r.service_id)}${staffName(r.staff_id) ? ` with ${staffName(r.staff_id)}` : ''} for ${fmtDay(r.start_time)} at ${fmtTime(r.start_time)}.`,
      transcript: pick(TEMPLATES('Glow Studio', svcName(r.service_id).toLowerCase(), staffName(r.staff_id), fmtTime(r.start_time), fmtDay(r.start_time))),
    });
  }
  const extraKinds = [
    ['completed', 'faq', 'Caller asked about opening hours and parking. Answered from the knowledge base.', 'agent: Glow Studio, how can I help?\ncaller: Are you open on Sundays, and is there parking?\nagent: Yes, we are open every day from 9 to 6, and there is free parking behind the building.\ncaller: Great, thanks.'],
    ['transferred: asked for the owner', 'other', 'Caller asked to speak to the owner about a gift card; transferred.', 'caller: I want to talk to the owner.\nagent: Of course, let me put you through.'],
    ['voicemail', 'other', 'Caller left a voicemail asking for a price list.', 'agent: Nobody is available right now. Please leave a message.\ncaller: Hi, could someone send me your price list?'],
    ['callback_requested', 'other', 'Caller asked for a call back about a colour correction.', 'caller: I need a colour correction, can someone call me?\nagent: I will ask the team to call you back.'],
    ['completed', 'pricing', 'Caller asked how much a haircut and facial cost; did not book.', 'caller: How much is a haircut and a facial?\nagent: A haircut is 40 dollars and a facial is 80 dollars.\ncaller: Thanks, I will think about it.'],
  ];
  for (let i = 0; i < Math.round(phoneBooked.length * 0.55); i++) {
    const [outcome, intent, summary, transcript] = extraKinds[i % extraKinds.length];
    const afterHours = i % 7 === 3;
    const when = new Date(now.getTime() - Math.floor(rng() * 58 * 86_400_000));
    if (afterHours) when.setUTCHours(1 + Math.floor(rng() * 3));
    const dur = 25 + Math.floor(rng() * 110);
    calls.push({
      _id: newId(), business_id: glow, call_sid: `CAdemo${calls.length}`, phone: pick(people).phone, created_at: when, ended_at: new Date(when.getTime() + dur * 1000), duration_seconds: dur,
      outcome, intent, is_after_hours: afterHours, booking_id: null, summary, transcript,
    });
  }
  calls.push({ _id: newId(), business_id: glow, call_sid: `CAdemo${calls.length}`, phone: '+15550100321', created_at: new Date(now.getTime() - 9 * 86_400_000), duration_seconds: 4, outcome: 'failed: ai_unavailable', intent: null, is_after_hours: false, booking_id: null, summary: 'The AI service was briefly unavailable; the caller heard an apology and a callback was offered.', transcript: null });
  await db.collection('call_logs').insertMany(calls);
  const open = { status: 'open', assigned_to: null, resolved_at: null, resolved_by: null, resolution_notes: null };
  await db.collection('failed_bookings').insertOne({
    _id: newId(), business_id: glow, phone: '+15550100321', customer_name: 'Hana Sato', service_id: S.colour._id, requested_start_time: at(2, 11),
    error_message: 'slot no longer available', created_at: new Date(now.getTime() - 2 * 86_400_000), ...open,
  });
  await db.collection('callback_requests').insertOne({
    _id: newId(), business_id: glow, call_sid: 'CAdemoCB', phone: '+15550100077', preferred_time: null, reason: 'Wants a quote for bridal party colouring',
    created_at: new Date(now.getTime() - 3 * 86_400_000), ...open, status: 'pending',
  });

  // ---- activity history: what the owner and a manager did over the last weeks ----
  const ownerAdmin = await db.collection('admins').findOne({ business_id: glow, email: DEMO_ACCOUNTS.owner });
  const trail = [
    [0.1, 'POST', '/api/bookings'], [0.2, 'PATCH', '/api/bookings/b1'], [0.9, 'PATCH', '/api/exceptions/sms_delivery/x1'], [1.1, 'POST', '/api/exceptions/sms_delivery/x1/retry'],
    [1.2, 'PATCH', '/api/customers/c1'], [2.1, 'POST', '/api/customers/c2/merge'], [2.3, 'PUT', '/api/knowledge/draft'], [2.3, 'POST', '/api/knowledge/publish'],
    [3.0, 'PATCH', '/api/services/s1'], [3.1, 'PATCH', '/api/services/s1'], [4.0, 'POST', '/api/staff'], [4.1, 'PATCH', '/api/staff/t1'], [4.2, 'POST', '/api/staff/t1/time-off'],
    [5.0, 'POST', '/api/team-members/invite'], [5.1, 'PATCH', '/api/team-members/m1'], [6.0, 'PUT', '/api/business-hours'], [6.2, 'PUT', '/api/business/holidays'],
    [8.0, 'PATCH', '/api/billing/plan'], [9.0, 'POST', '/api/onboarding/test-call'], [9.1, 'POST', '/api/onboarding/go-live'], [12.0, 'POST', '/api/services'],
  ];
  await db.collection('audit_logs').insertMany(trail.map(([daysAgo, method, path]) => ({
    _id: newId(), business_id: glow, admin_id: ownerAdmin._id, method, path, status: 200, ip: '203.0.113.7', created_at: new Date(now.getTime() - daysAgo * 86_400_000),
  })));

  // ---- usage and invoices: two paid months behind us and a current month in progress ----
  const smsDocs = rows.filter((r) => r.status === 'confirmed' && r.created_at >= periodStart && r.created_at <= now)
    .flatMap((r, i) => [{ _id: newId(), business_id: glow, sid: `SMdemo${i}a`, sent_at: r.created_at }, { _id: newId(), business_id: glow, sid: `SMdemo${i}b`, sent_at: r.reminder_24h_sent_at ?? r.created_at }])
    .filter((d) => d.sent_at >= periodStart && d.sent_at <= now);
  if (smsDocs.length) await db.collection('sms_sends').insertMany(smsDocs);
  const invoices = [1, 2].map((k) => {
    const end = new Date(periodStart.getTime() - (k - 1) * 30 * 86_400_000);
    const start = new Date(end.getTime() - 30 * 86_400_000);
    const voice = 380 + k * 70;
    const sms = 520 + k * 40;
    return {
      _id: newId(), business_id: glow, period_start: start, period_end: end, plan: 'growth', base_amount: 149, voice_minutes_used: voice, voice_overage_amount: 0,
      sms_used: sms, sms_overage_amount: 0, phone_number_fee: 5, total_amount: 154, status: 'paid', stripe_payment_intent_id: `pi_demo_${k}`,
      created_at: end, paid_at: end, failed_reason: null,
    };
  });
  await db.collection('invoices').insertMany(invoices);

  // ---------------- other businesses: a second Glow Studio, a dentist, and some for the directory ----------------
  const light = async ({ name, slug, industry, address, phone, category, city, description, lat, lng, services, staff, ownerEmail, ownerN, hours }) => {
    const id = newId();
    await db.collection('businesses').insertOne(business({
      _id: id, name, slug, industry, address, contact_phone: phone, onboarding_completed_at: new Date(),
      listing: listing([category], city, description, lat, lng), ...(hours ? { hours } : {}),
    }));
    const svcs = services.map(([n, dur, price]) => ({ _id: newId(), business_id: id, name: n, duration_minutes: dur, buffer_minutes: 0, price }));
    await db.collection('services').insertMany(svcs);
    const team = staff.map((n) => ({ _id: newId(), business_id: id, name: n, service_ids: svcs.map((s) => s._id) }));
    await db.collection('staff').insertMany(team);
    if (ownerEmail) await db.collection('admins').insertOne(owner(id, `${name} Owner`, ownerEmail, ownerN));
    // a week of bookings so the platform console counts are not zero
    const local = [];
    const lockList = [];
    for (let d = 1; d <= 6; d++) {
      const svc = svcs[d % svcs.length];
      const st = team[d % team.length];
      const customer = people[(d * 5) % people.length];
      const { row, locks: l } = bookingRow(id, { svc, staff: st, customer, start: at(d, 9 + (d % 7)), status: 'confirmed', via: d % 2 ? 'web' : 'call', now });
      local.push(row); lockList.push(...l);
    }
    await db.collection('bookings').insertMany(local);
    await db.collection('booking_slot_locks').insertMany(lockList);
    return id;
  };
  const miami = await light({ name: 'Glow Studio', slug: DEMO_SLUGS.miami, industry: 'Salon / Spa', address: '800 Collins Ave, Miami Beach FL', phone: '+13055550188', category: 'hair-salon', city: 'Miami', description: 'Our sister studio on Miami Beach.', lat: 25.78, lng: -80.13, services: [['Haircut', 30, 55]], staff: ['Gabi'], ownerEmail: 'owner@glowmiami.example.test', ownerN: 2 });
  const dentist = await light({ name: 'Bright Smiles Dental', slug: DEMO_SLUGS.dentist, industry: 'Medical / Dental', address: '45 Kennedy Blvd, Tampa FL', phone: '+18135550177', category: 'dentist', city: 'Tampa', description: 'Family dentistry: cleanings, fillings and whitening.', lat: 27.95, lng: -82.46, services: [['Teeth cleaning', 45, 90], ['Check-up', 30, 60]], staff: ['Dr Khan'] });
  await light({ name: 'Fade Factory Barbers', slug: 'fade-factory-barbers', industry: 'Barber', address: '310 Central Ave, St Petersburg FL', phone: '+17275550120', category: 'barber', city: 'St Petersburg', description: 'Sharp fades, hot-towel shaves and beard trims.', lat: 27.77, lng: -82.64, services: [['Fade', 30, 35], ['Beard trim', 20, 20], ['Hot-towel shave', 30, 40]], staff: ['Marcus', 'Dre'] });
  await light({ name: 'Serene Day Spa', slug: 'serene-day-spa', industry: 'Salon / Spa', address: '77 Harbor Dr, Clearwater FL', phone: '+17275550155', category: 'spa', city: 'Clearwater', description: 'Massage, facials and body treatments by the water.', lat: 27.96, lng: -82.8, services: [['Swedish massage', 60, 95], ['Deep tissue massage', 60, 110], ['Express facial', 30, 55]], staff: ['Lena', 'Tomas'] });
  await light({ name: 'Peak Fitness Studio', slug: 'peak-fitness-studio', industry: 'Fitness', address: '12 Dale Mabry Hwy, Tampa FL', phone: '+18135550166', category: 'fitness', city: 'Tampa', description: 'Personal training and small-group classes.', lat: 28.0, lng: -82.5, services: [['Personal training', 60, 70], ['Intro session', 45, 0]], staff: ['Coach Ria'] });

  // a brand-new business that has not finished setup (shows the setup card and first-run tour)
  const sunrise = newId();
  await db.collection('businesses').insertOne(business({ _id: sunrise, name: 'Sunrise Dental', slug: 'sunrise-dental', industry: 'Medical / Dental', hours: [], onboarding_completed_at: null, created_at: now }));
  await db.collection('services').insertOne({ _id: newId(), business_id: sunrise, name: 'New patient visit', duration_minutes: 45, buffer_minutes: 0, price: 70 });
  await db.collection('admins').insertOne(owner(sunrise, 'New Owner', DEMO_ACCOUNTS.newOwner, 3));

  await db.collection('leads').insertMany([
    { _id: newId(), name: 'Dana Lee', contact: 'dana@example.test', need: 'A physiotherapist near downtown Tampa', city: 'Tampa', status: 'open', created_at: new Date(now.getTime() - 2 * 86_400_000), demo: true },
    { _id: newId(), name: 'Chris Moore', contact: '+15550100555', need: 'Dog groomer who takes walk-ins', city: 'Clearwater', status: 'open', created_at: new Date(now.getTime() - 5 * 86_400_000), demo: true },
  ]);

  const sara = customers.find((c) => c.phone === FIXED_PHONES['Sara Ahmed']);
  return {
    password, listed, owners: [DEMO_ACCOUNTS.owner, DEMO_ACCOUNTS.newOwner],
    // ids the walkthrough and screenshot scripts use
    ids: { glow, miami, dentist, sunrise, svc: { haircut: S.haircut._id, facial: S.facial._id, colour: S.colour._id }, staff: { jessica: T.jessica._id, sam: T.sam._id, flo: T.flo._id }, north, south, saraId: sara._id },
    jessicaBookedAt, firstBookingId: firstFixed._id,
    counts: { bookings: rows.length, calls: calls.length, customers: customers.length },
  };
}
