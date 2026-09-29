// Shared setup for the DB-backed tests: an isolated tenant (business + services + staff)
// and a cleanup that uses raw collections (ScopedCollection has no deleteMany) and waits
// for createBooking's fire-and-forget confirmation/customer-upsert work before the shared
// Mongo client closes. Needs MONGODB_URI at a migrated replica set (npm run local-db).
import 'dotenv/config';
import { client, getDb, newId } from '../../src/db.js';

export { client, getDb, newId };

// Every booking logs "SMS/Email not sent (… not configured)" when providers are unset — hundreds
// of lines that bury results. Set TEST_VERBOSE=1 to see them.
if (!process.env.TEST_VERBOSE) {
  const warn = console.warn;
  console.warn = (...args) => (/not sent/i.test(String(args[0])) ? undefined : warn(...args));
}
export const skip = !process.env.MONGODB_URI && 'MONGODB_URI not set';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '09:00', close_time: '18:00' }));
const TENANT_COLLECTIONS = ['services', 'staff', 'bookings', 'booking_slot_locks', 'customers', 'failed_bookings', 'call_logs', 'sms_sends', 'staff_time_off'];

export async function createTenant({
  name = '__test__',
  timezone = 'UTC',
  hours = ALL_DAYS,
  services = [{ name: 'haircut', duration: 30, buffer: 0 }],
  staff = ['Jessica', 'Sam'],
} = {}) {
  const db = await getDb();
  const businessId = newId();
  await db.collection('businesses').insertOne({
    _id: businessId, name, timezone, hours, status: 'active',
    google_calendar_id: 'primary', reschedule_cutoff_minutes: 120,
  });

  const serviceIds = {};
  for (const s of services) {
    serviceIds[s.name] = newId();
    await db.collection('services').insertOne({ _id: serviceIds[s.name], business_id: businessId, name: s.name, duration_minutes: s.duration, buffer_minutes: s.buffer ?? 0 });
  }
  const staffIds = {};
  for (const n of staff) {
    staffIds[n] = newId();
    await db.collection('staff').insertOne({ _id: staffIds[n], business_id: businessId, name: n });
  }

  return { businessId, business: { id: businessId, name, timezone, contact_phone: null, reschedule_cutoff_minutes: 120 }, serviceIds, staffIds };
}

export async function dropTenants(...businessIds) {
  await new Promise((r) => setTimeout(r, 500));
  const db = await getDb();
  for (const id of businessIds) {
    await db.collection('businesses').deleteOne({ _id: id });
    for (const c of TENANT_COLLECTIONS) await db.collection(c).deleteMany({ business_id: id });
  }
  await client.close();
}
