// Customer records (ROADMAP.md §4) — this system had no first-class customer entity
// before; "customer" data lived denormalized on each booking. This is the one place it
// gets consolidated, keyed by phone number the same way bookings/call_logs already are.
import { withTenant, newId, serialize, serializeAll } from '../db.js';

// Pure — strips everything but a leading + and digits, so "+1 (555) 123-4567" and
// "5551234567" dedupe to the same customer within a business.
export function normalizePhone(phone) {
  if (!phone) return '';
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

// Called from both createBooking (src/services/bookingService.js) and the Twilio inbound
// webhook (src/webhooks/twilio.js) — one shared upsert, not duplicated per caller. Never
// overwrites a known name/email with a blank one.
export async function upsertCustomer(businessId, { phone, name, email }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  return withTenant(businessId, async (c) => {
    const existing = await c('customers').findOne({ phone: normalized });
    if (existing) {
      const updates = {};
      if (name && !existing.name) updates.name = name;
      if (email && !existing.email) updates.email = email;
      if (Object.keys(updates).length) {
        updates.updated_at = new Date();
        await c('customers').updateOne({ _id: existing._id }, { $set: updates });
      }
      return serialize({ ...existing, ...updates });
    }

    const doc = {
      _id: newId(),
      business_id: businessId,
      phone: normalized,
      name: name || null,
      email: email || null,
      notes: null,
      tags: [],
      preferences: { preferredStaffId: null, preferredServiceId: null, preferredContactMethod: null },
      consent: { recordingAcknowledged: false, smsOptIn: true, emailOptIn: true },
      created_at: new Date(),
      updated_at: new Date(),
    };
    await c('customers').insertOne(doc);
    return serialize(doc);
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
    bookings: serializeAll(bookings).map((b) => ({ id: b.id, serviceId: b.service_id, startTime: b.start_time, status: b.status, confirmationSentAt: b.confirmation_sent_at })),
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
