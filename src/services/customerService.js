// Customer records (ROADMAP.md §4) — this system had no first-class customer entity
// before; "customer" data lived denormalized on each booking. This is the one place it
// gets consolidated, keyed by phone number the same way bookings/call_logs already are.
import { withTenant, newId, serialize, serializeAll } from '../db.js';

// Pure — strips formatting down to E.164 (leading + and digits only), so
// "+1 (555) 123-4567" and "555-123-4567" dedupe to the same customer within a business.
// KG-08/18b: a number typed without a country code (a caller reading out their own
// ten-digit number) used to normalise differently from the same number with +1 already
// on it, so a returning customer typing it on the web looked like a brand-new one.
// Defaults to NANP (+1) when no country code was given — this system's numbers are
// US/Canada-first (plan.md §3); a number that already carries a country code (a leading
// + typed by the caller, or 11+ digits starting with 1) passes through unchanged.
export function normalizePhone(phone) {
  if (!phone) return '';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

// Called from both createBooking (src/services/bookingService.js) and the Twilio inbound
// webhook (src/webhooks/twilio.js) — one shared upsert, not duplicated per caller. Never
// overwrites a known name/email with a blank one.
export async function upsertCustomer(businessId, { phone, name, email }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  return withTenant(businessId, async (c) => {
    // One atomic upsert (KG-09): simultaneous first-time calls for one phone used to race a
    // find-then-insert and the losers threw a duplicate-key error. phone and business_id come
    // from the filter, so they are not repeated in $setOnInsert.
    const doc = {
      _id: newId(),
      name: name || null,
      email: email || null,
      notes: null,
      tags: [],
      preferences: { preferredStaffId: null, preferredServiceId: null, preferredContactMethod: null },
      consent: { recordingAcknowledged: false, smsOptIn: true, emailOptIn: true },
      created_at: new Date(),
      updated_at: new Date(),
    };
    const existing = await c('customers').findOneAndUpdate({ phone: normalized }, { $setOnInsert: doc }, { upsert: true, returnDocument: 'after' });
    // Never overwrite a known name/email with a blank one; only fill gaps.
    const updates = {};
    if (name && !existing.name) updates.name = name;
    if (email && !existing.email) updates.email = email;
    if (Object.keys(updates).length) {
      updates.updated_at = new Date();
      await c('customers').updateOne({ _id: existing._id }, { $set: updates });
    }
    return serialize({ ...existing, ...updates });
  });
}

// Called where the "this call may be recorded" disclosure is actually spoken
// (src/webhooks/twilio.js) — a real consent record tied to a real spoken disclosure,
// not a checkbox no one saw.
export async function markRecordingAcknowledged(businessId, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  await withTenant(businessId, (c) =>
    c('customers').updateOne({ phone: normalized }, { $set: { 'consent.recordingAcknowledged': true, updated_at: new Date() } })
  );
}

// Inbound STOP/START SMS replies (src/webhooks/twilio.js) — upserts first so a reply
// from a number with no customer record yet still records the opt-out instead of
// silently doing nothing.
export async function setSmsOptIn(businessId, phone, optedIn) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  await upsertCustomer(businessId, { phone });
  await withTenant(businessId, (c) =>
    c('customers').updateOne({ phone: normalized }, { $set: { 'consent.smsOptIn': optedIn, updated_at: new Date() } })
  );
}

// Public booking page (docs/customer/PUBLIC_BOOKING_API.md): stores what the customer ticked
// and the wording they saw. A ticked box never re-enables an existing STOP — it only
// leaves consent as it was; an unticked box opts that channel out.
export async function recordWebConsent(businessId, { phone, name, email, sms, emailOk, text }) {
  const customer = await upsertCustomer(businessId, { phone, name, email });
  if (!customer) return null;
  const set = { 'consent.lastWeb': { at: new Date(), sms: !!sms, email: !!emailOk, text: text ?? null }, updated_at: new Date() };
  if (!sms) set['consent.smsOptIn'] = false;
  if (!emailOk) set['consent.emailOptIn'] = false;
  await withTenant(businessId, (c) => c('customers').updateOne({ _id: customer.id }, { $set: set }));
  return customer;
}

// Checked before every send in src/notifications/notify.js — "Opt-out management"
// (ROADMAP.md §6) only means something if consent is actually enforced, not just
// stored. No customer record yet reads as "not explicitly opted out" (a fresh
// customer's default is opted in), same as upsertCustomer's own defaults.
export async function getConsent(businessId, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const customer = await withTenant(businessId, (c) => c('customers').findOne({ phone: normalized }, { projection: { consent: 1 } }));
  return customer?.consent ?? null;
}

export async function listCustomers(businessId, { q } = {}) {
  const filter = {};
  if (q) {
    const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: pattern, $options: 'i' } }, { phone: { $regex: pattern, $options: 'i' } }, { email: { $regex: pattern, $options: 'i' } }];
  }
  const customers = await withTenant(businessId, (c) => c('customers').find(filter).sort({ updated_at: -1 }).limit(500).toArray());
  return serializeAll(customers);
}

export async function getCustomerDetail(businessId, id) {
  const customer = await withTenant(businessId, (c) => c('customers').findOne({ _id: id }));
  if (!customer) return null;

  const [bookings, calls] = await withTenant(businessId, (c) => Promise.all([
    c('bookings').find({ phone: customer.phone }).sort({ start_time: -1 }).limit(100).toArray(),
    c('call_logs').find({ phone: customer.phone }).sort({ created_at: -1 }).limit(100).toArray(),
  ]));

  return {
    ...serialize(customer),
    bookings: serializeAll(bookings).map((b) => ({ id: b.id, serviceId: b.service_id, startTime: b.start_time, status: b.status, confirmationSentAt: b.confirmation_sent_at, createdVia: b.created_via ?? 'dashboard', reference: b.reference ?? null })),
    calls: serializeAll(calls).map((l) => ({ id: l.id, createdAt: l.created_at, outcome: l.outcome })),
  };
}

export async function updateCustomer(businessId, id, { name, email, notes, tags, preferences, consent }) {
  const updates = { updated_at: new Date() };
  if (name !== undefined) updates.name = name || null;
  if (email !== undefined) updates.email = email || null;
  if (notes !== undefined) updates.notes = notes || null;
  if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags.filter(Boolean).map(String) : [];
  if (preferences !== undefined) {
    updates.preferences = {
      preferredStaffId: preferences.preferredStaffId || null,
      preferredServiceId: preferences.preferredServiceId || null,
      preferredContactMethod: preferences.preferredContactMethod || null,
    };
  }
  if (consent !== undefined) {
    updates.consent = {
      recordingAcknowledged: !!consent.recordingAcknowledged,
      smsOptIn: consent.smsOptIn !== false,
      emailOptIn: consent.emailOptIn !== false,
    };
  }
  const updated = await withTenant(businessId, (c) => c('customers').findOneAndUpdate({ _id: id }, { $set: updates }, { returnDocument: 'after' }));
  return updated ? serialize(updated) : null;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Possible duplicates (Jira 18k/18m): the same person who came back with a different phone.
// Same email is a strong signal; the same name alone is weak (two different "John Smith"s),
// so it is returned labelled as such and the staff member decides.
export async function findDuplicates(businessId, id) {
  const me = await withTenant(businessId, (c) => c('customers').findOne({ _id: id }));
  if (!me) return null;
  const exact = (v) => ({ $regex: `^${escapeRegex(v.trim())}$`, $options: 'i' });
  const or = [];
  if (me.email) or.push({ email: exact(me.email) });
  if (me.name) or.push({ name: exact(me.name) });
  if (!or.length) return [];
  const rows = await withTenant(businessId, (c) => c('customers').find({ _id: { $ne: id }, $or: or }).limit(20).toArray());
  return rows.map((r) => ({
    ...serialize(r),
    matchedOn: me.email && r.email?.toLowerCase() === me.email.toLowerCase() ? 'email' : 'name',
  }));
}

// Folds `fromId` into `intoId` (Jira 18l): bookings and calls move to the surviving phone number,
// tags/notes/name/email fill gaps, and consent keeps the MOST restrictive answer so a merge can
// never re-enable messages someone opted out of. The duplicate record is then deleted.
// ponytail: sequential writes, not one transaction; a crash mid-way leaves both records and a
// re-run finishes the job (every step is idempotent).
export async function mergeCustomers(businessId, fromId, intoId) {
  if (fromId === intoId) return { error: 'pick a different customer to merge', status: 400 };
  const [from, into] = await withTenant(businessId, (c) => Promise.all([c('customers').findOne({ _id: fromId }), c('customers').findOne({ _id: intoId })]));
  if (!from || !into) return { error: 'customer not found', status: 404 };

  const moved = await withTenant(businessId, async (c) => {
    const bookings = await c('bookings').updateMany({ phone: from.phone }, { $set: { phone: into.phone } });
    const calls = await c('call_logs').updateMany({ phone: from.phone }, { $set: { phone: into.phone } });
    const set = { updated_at: new Date() };
    if (!into.name && from.name) set.name = from.name;
    if (!into.email && from.email) set.email = from.email;
    const notes = [into.notes, from.notes].filter(Boolean);
    if (notes.length) set.notes = notes.join('\n');
    set['consent.smsOptIn'] = into.consent?.smsOptIn !== false && from.consent?.smsOptIn !== false;
    set['consent.emailOptIn'] = into.consent?.emailOptIn !== false && from.consent?.emailOptIn !== false;
    set['consent.recordingAcknowledged'] = !!(into.consent?.recordingAcknowledged || from.consent?.recordingAcknowledged);
    await c('customers').updateOne({ _id: intoId }, { $set: set, ...(from.tags?.length ? { $addToSet: { tags: { $each: from.tags } } } : {}) });
    await c('customers').deleteOne({ _id: fromId });
    return { bookings: bookings.modifiedCount, calls: calls.modifiedCount };
  });
  return { ok: true, ...moved };
}

const CSV_COLUMNS = ['name', 'phone', 'email', 'tags'];

export function toCsv(customers) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const c of customers) {
    lines.push([c.name ?? '', c.phone ?? '', c.email ?? '', (c.tags ?? []).join('|')].map((v) => String(v).replace(/,/g, ';')).join(','));
  }
  return lines.join('\n');
}

// Deliberately simple — no quoted-field/embedded-comma support, matching toCsv's own
// comma-stripping. Adequate for a plain contact list; a real RFC4180 parser would be
// over-engineering for this.
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(CSV_COLUMNS.map((col) => [col, header.indexOf(col)]));
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return {
      name: idx.name >= 0 ? cells[idx.name]?.trim() : undefined,
      phone: idx.phone >= 0 ? cells[idx.phone]?.trim() : undefined,
      email: idx.email >= 0 ? cells[idx.email]?.trim() : undefined,
      tags: idx.tags >= 0 ? cells[idx.tags]?.split('|').map((t) => t.trim()).filter(Boolean) : [],
    };
  }).filter((row) => row.phone);
}

export async function importCsv(businessId, csvText) {
  const rows = parseCsv(csvText);
  let imported = 0;
  let updated = 0;
  for (const row of rows) {
    const normalized = normalizePhone(row.phone);
    if (!normalized) continue;
    const existing = await withTenant(businessId, (c) => c('customers').findOne({ phone: normalized }));
    await upsertCustomer(businessId, row);
    if (row.tags?.length) {
      await withTenant(businessId, (c) => c('customers').updateOne({ phone: normalized }, { $addToSet: { tags: { $each: row.tags } } }));
    }
    if (existing) updated++; else imported++;
  }
  return { imported, updated };
}
