// Demo data used by the recorded walkthrough (scripts/demo/record.mjs) and the screenshot checks
// (scripts/screenshots.mjs). Creates fixed, named businesses so the pages look the same every run.
// Everything it creates carries `demo: true` and is removed again by cleanupDemo().
//
// Needs the same MONGODB_URI / MONGODB_DB_NAME as the backend it will be shown against.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { getDb, newId } from '../../src/db.js';
import { initialBillingFields } from '../../src/billing/plans.js';
import { createBooking, cancelBooking } from '../../src/services/bookingService.js';
import { upsertCustomer } from '../../src/services/customerService.js';
import { signCustomerToken } from '../../src/customerAuth.js';

export const DEMO_PASSWORD = 'DemoPass123!';
export const DEMO = {
  owner: 'owner@glowstudio.example.test',
  newOwner: 'newbie@sunrisedental.example.test',
  platform: 'platform@demo.example.test',
  slug: 'glow-studio',
  miamiSlug: 'glow-studio-miami',
  dentistSlug: 'bright-smiles-dental',
  repeatCustomerPhone: '+15550100001',
};

const TENANT_COLLECTIONS = ['services', 'staff', 'locations', 'bookings', 'booking_slot_locks', 'customers', 'call_logs', 'failed_bookings', 'sms_sends', 'staff_time_off', 'callback_requests', 'customer_login_codes'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '18:00' }));

export async function cleanupDemo() {
  const db = await getDb();
  const ids = (await db.collection('businesses').find({ demo: true }, { projection: { _id: 1 } }).toArray()).map((b) => b._id);
  for (const c of TENANT_COLLECTIONS) await db.collection(c).deleteMany({ business_id: { $in: ids } });
  await db.collection('admins').deleteMany({ business_id: { $in: ids } });
  await db.collection('businesses').deleteMany({ demo: true });
  await db.collection('platform_admins').deleteMany({ email: DEMO.platform });
  await db.collection('leads').deleteMany({ demo: true });
  return ids.length;
}

const at = (days, hour, zone = 'America/New_York') => DateTime.now().setZone(zone).plus({ days }).set({ hour, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO();

export async function seedDemo() {
  await cleanupDemo();
  const db = await getDb();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const business = (fields) => ({
    status: 'active', timezone: 'America/New_York', hours: ALL_DAYS, google_calendar_id: 'primary', reschedule_cutoff_minutes: 120,
    faqs: [], created_at: new Date(), demo: true, booking_page_enabled: true, ...initialBillingFields(), ...fields,
  });

  // ---- Glow Studio, Tampa: live, listed, two branches, the business the dashboard tour uses ----
  const glow = newId();
  await db.collection('businesses').insertOne(business({
    _id: glow, name: 'Glow Studio', slug: DEMO.slug, industry: 'Salon / Spa', address: '100 Bayshore Blvd, Tampa FL', contact_phone: '+18135550142',
    contact_email: DEMO.owner, phone_number: '+18135550142', onboarding_completed_at: new Date(), test_call_at: new Date(), voice_name: 'Aoede',
    faqs: [{ question: 'Do you take walk-ins?', answer: 'Yes, when we have a free chair.' }], google_refresh_token: null,
    listing: { listed: true, categories: ['hair-salon'], city: 'Tampa', region: 'FL', country: 'US', description: 'Cuts, colour and facials in the heart of Tampa.', lat: 27.9, lng: -82.46 },
  }));
  await db.collection('admins').insertOne({
    _id: newId(), business_id: glow, name: 'Aiza Owner', email: DEMO.owner, phone: '+15550009001', password_hash: hash, role: 'owner', status: 'active',
    terms_accepted_at: new Date(), email_verified_at: new Date(), phone_verified_at: new Date(), created_at: new Date(),
  });

  const north = newId();
  const south = newId();
  await db.collection('locations').insertMany([
    { _id: north, business_id: glow, name: 'Bayshore Branch', address: '100 Bayshore Blvd, Tampa', is_primary: true, created_at: new Date() },
    { _id: south, business_id: glow, name: 'Downtown Branch', address: '22 Franklin St, Tampa', is_primary: false, created_at: new Date() },
  ]);
  const svc = { haircut: newId(), facial: newId(), colour: newId() };
  await db.collection('services').insertMany([
    { _id: svc.haircut, business_id: glow, name: 'Haircut', duration_minutes: 30, buffer_minutes: 0, price: 40 },
    { _id: svc.facial, business_id: glow, name: 'Facial', duration_minutes: 60, buffer_minutes: 0, price: 80 },
    { _id: svc.colour, business_id: glow, name: 'Colour', duration_minutes: 90, buffer_minutes: 15, price: 120 },
  ]);
  const staff = { jessica: newId(), sam: newId(), flo: newId() };
  await db.collection('staff').insertMany([
    { _id: staff.jessica, business_id: glow, name: 'Jessica', location_id: north, service_ids: [svc.haircut, svc.facial, svc.colour] },
    { _id: staff.sam, business_id: glow, name: 'Sam', location_id: south, service_ids: [svc.haircut] },
    { _id: staff.flo, business_id: glow, name: 'Flo', service_ids: [svc.haircut, svc.facial] },
  ]);

  // customers, including two records for the same person (the merge demo)
  await upsertCustomer(glow, { phone: '+15550100001', name: 'Sara Ahmed', email: 'sara.ahmed@example.test' });
  await upsertCustomer(glow, { phone: '+15550100002', name: 'S. Ahmed', email: 'sara.ahmed@example.test' });
  await upsertCustomer(glow, { phone: '+15550100003', name: 'Mia Chen', email: 'mia.chen@example.test' });
  await upsertCustomer(glow, { phone: '+15550100004', name: 'Omar Farooq' });

  // bookings from every channel; confirmations are not delivered here (no SMS/email provider), which is
  // exactly what the "Confirmation" column and Needs attention page show.
  const bk = async (over) => (await createBooking(glow, { serviceId: svc.haircut, ...over })).booking;
  const first = await bk({ customerName: 'Sara Ahmed', phone: '+15550100001', customerEmail: 'sara.ahmed@example.test', staffId: staff.jessica, locationId: north, startTime: at(1, 10), createdVia: 'web' });
  await bk({ customerName: 'S. Ahmed', phone: '+15550100002', customerEmail: 'sara.ahmed@example.test', serviceId: svc.facial, staffId: staff.flo, startTime: at(3, 14), createdVia: 'call' });
  await bk({ customerName: 'Mia Chen', phone: '+15550100003', customerEmail: 'mia.chen@example.test', serviceId: svc.colour, staffId: staff.jessica, locationId: north, startTime: at(2, 11), createdVia: 'dashboard' });
  await bk({ customerName: 'Omar Farooq', phone: '+15550100004', staffId: staff.sam, locationId: south, startTime: at(2, 15), createdVia: 'call' });
  const jessicaBooked = await bk({ customerName: 'Mia Chen', phone: '+15550100003', customerEmail: 'mia.chen@example.test', serviceId: svc.facial, staffId: staff.jessica, locationId: north, startTime: at(5, 13), createdVia: 'web' });
  const cancelled = await bk({ customerName: 'Omar Farooq', phone: '+15550100004', staffId: staff.sam, locationId: south, startTime: at(4, 16), createdVia: 'web' });
  await cancelBooking(glow, cancelled.id);

  const now = Date.now();
  await db.collection('call_logs').insertMany([
    { _id: newId(), business_id: glow, call_sid: 'CAdemo1', phone: '+15550100002', created_at: new Date(now - 3 * 3600_000), ended_at: new Date(now - 3 * 3600_000 + 142_000), duration_seconds: 142, outcome: 'completed', intent: 'booking', summary: 'S. Ahmed booked a Facial with Flo for Friday afternoon.', transcript: 'agent: Thanks for calling Glow Studio.\ncaller: Hi, I would like a facial on Friday.\nagent: Of course, I have 2pm with Flo.\ncaller: Perfect.', booking_id: first.id },
    { _id: newId(), business_id: glow, call_sid: 'CAdemo2', phone: '+15550100004', created_at: new Date(now - 26 * 3600_000), ended_at: new Date(now - 26 * 3600_000 + 88_000), duration_seconds: 88, outcome: 'completed', intent: 'booking', summary: 'Omar Farooq booked a haircut with Sam at the Downtown branch.', transcript: 'agent: Glow Studio, how can I help?\ncaller: A haircut downtown please.' },
    { _id: newId(), business_id: glow, call_sid: 'CAdemo3', phone: '+15550100077', created_at: new Date(now - 50 * 3600_000), ended_at: new Date(now - 50 * 3600_000 + 40_000), duration_seconds: 40, outcome: 'transferred: asked for the owner', intent: 'other', summary: 'Caller asked to speak to the owner about a gift card.', transcript: 'caller: I want to talk to the owner.' },
  ]);

  // ---- a second "Glow Studio" in Miami (same name, different city) and a dentist ----
  const miami = newId();
  await db.collection('businesses').insertOne(business({
    _id: miami, name: 'Glow Studio', slug: DEMO.miamiSlug, industry: 'Salon / Spa', address: '800 Collins Ave, Miami Beach FL', contact_phone: '+13055550188',
    onboarding_completed_at: new Date(), listing: { listed: true, categories: ['hair-salon'], city: 'Miami', region: 'FL', country: 'US', description: 'Our sister studio on Miami Beach.', lat: 25.78, lng: -80.13 },
  }));
  await db.collection('services').insertOne({ _id: newId(), business_id: miami, name: 'Haircut', duration_minutes: 30, buffer_minutes: 0, price: 55 });
  await db.collection('admins').insertOne({ _id: newId(), business_id: miami, name: 'Miami Owner', email: 'owner@glowmiami.example.test', phone: '+15550009002', password_hash: hash, role: 'owner', status: 'active', created_at: new Date() });

  const dentist = newId();
  await db.collection('businesses').insertOne(business({
    _id: dentist, name: 'Bright Smiles Dental', slug: DEMO.dentistSlug, industry: 'Medical / Dental', address: '45 Kennedy Blvd, Tampa FL', contact_phone: '+18135550177',
    onboarding_completed_at: new Date(), listing: { listed: true, categories: ['dentist'], city: 'Tampa', region: 'FL', country: 'US', description: 'Family dentistry: cleanings, fillings and whitening.', lat: 27.95, lng: -82.46 },
  }));
  await db.collection('services').insertMany([
    { _id: newId(), business_id: dentist, name: 'Teeth cleaning', duration_minutes: 45, buffer_minutes: 0, price: 90 },
    { _id: newId(), business_id: dentist, name: 'Check-up', duration_minutes: 30, buffer_minutes: 0, price: 60 },
  ]);
  await db.collection('staff').insertOne({ _id: newId(), business_id: dentist, name: 'Dr Khan' });

  // ---- a brand-new business whose owner has not finished setup (setup card + first-run tour) ----
  const sunrise = newId();
  await db.collection('businesses').insertOne(business({ _id: sunrise, name: 'Sunrise Dental', slug: 'sunrise-dental', industry: 'Medical / Dental', hours: [], onboarding_completed_at: null }));
  await db.collection('services').insertOne({ _id: newId(), business_id: sunrise, name: 'New patient visit', duration_minutes: 45, buffer_minutes: 0, price: 70 });
  await db.collection('admins').insertOne({
    _id: newId(), business_id: sunrise, name: 'New Owner', email: DEMO.newOwner, phone: '+15550009003', password_hash: hash, role: 'owner', status: 'active',
    terms_accepted_at: new Date(), email_verified_at: new Date(), phone_verified_at: new Date(), created_at: new Date(),
  });

  // ---- platform admin for the moderation scene ----
  await db.collection('platform_admins').insertOne({ _id: newId(), email: DEMO.platform, password_hash: hash, created_at: new Date() });
  await db.collection('leads').insertOne({ _id: newId(), name: 'Dana Lee', contact: 'dana@example.test', need: 'A physiotherapist near downtown Tampa', city: 'Tampa', status: 'open', created_at: new Date(), demo: true });

  const sara = await db.collection('customers').findOne({ business_id: glow, phone: DEMO.repeatCustomerPhone });
  return {
    glow, miami, dentist, sunrise, svc, staff, north, south, jessicaBookedAt: jessicaBooked.start_time,
    // A session for Sara, as if she had signed in with a code (codes can't be delivered without SMS/email).
    saraToken: signCustomerToken(glow, sara._id),
  };
}

// node scripts/demo/seedDemo.mjs [--clean]
if (process.argv[1]?.replace(/\\/g, '/').endsWith('demo/seedDemo.mjs')) {
  const { client } = await import('../../src/db.js');
  if (process.argv.includes('--clean')) console.log('removed', await cleanupDemo(), 'demo businesses');
  else { const d = await seedDemo(); console.log('seeded demo businesses:', Object.keys(d).join(', ')); }
  await client.close();
}
