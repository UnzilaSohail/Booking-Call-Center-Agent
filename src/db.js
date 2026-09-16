import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

// `||`, not `??` — dotenv gives an empty string (not undefined) for a present-but-blank
// `MONGODB_URI=` line, which MongoClient would otherwise reject at import time and take
// the whole server down before /health could even respond.
export const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');

let dbPromise = null;
export function getDb() {
  dbPromise ??= client.connect().then((c) => c.db(process.env.MONGODB_DB_NAME || 'booking_call_center'));
  return dbPromise;
}

export function newId() {
  return randomUUID();
}

// Mongo documents keep _id as the primary key everywhere in this codebase (it's what
// the unique-index/transaction tricks below hinge on) but every route, the dashboard
// and the voice tools all read `.id` — this is the one place that translates between
// the two so the rest of the app never has to think about _id.
export function serialize(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}
export function serializeAll(docs) {
  return docs.map(serialize);
}

// There is no Postgres-style Row-Level Security in Mongo — tenant isolation is now an
// application-layer guarantee, not a DB-enforced one (plan.md §4/§7's "much harder to
// leak tenant A's data to tenant B" claim no longer holds at the DB level). This wrapper
// is the mitigation: every read/write through it has business_id force-merged into the
// filter/document, so a route can't accidentally query cross-tenant by forgetting a
// clause the way it could with a bare `db.collection(...)`.
class ScopedCollection {
  constructor(collection, businessId) {
    this.collection = collection;
    this.businessId = businessId;
  }
  find(filter = {}, options) {
    return this.collection.find({ ...filter, business_id: this.businessId }, options);
  }
  findOne(filter = {}, options) {
    return this.collection.findOne({ ...filter, business_id: this.businessId }, options);
  }
  insertOne(doc, options) {
    return this.collection.insertOne({ ...doc, business_id: this.businessId }, options);
  }
  updateOne(filter, update, options) {
    return this.collection.updateOne({ ...filter, business_id: this.businessId }, update, options);
  }
  findOneAndUpdate(filter, update, options) {
    return this.collection.findOneAndUpdate({ ...filter, business_id: this.businessId }, update, options);
  }
  deleteOne(filter, options) {
    return this.collection.deleteOne({ ...filter, business_id: this.businessId }, options);
  }
  countDocuments(filter = {}, options) {
    return this.collection.countDocuments({ ...filter, business_id: this.businessId }, options);
  }
  // Prepends a $match on business_id as the pipeline's first stage — aggregate takes a
  // stage array, not a filter object, so it can't be merged the way the methods above do.
  aggregate(pipeline = [], options) {
    return this.collection.aggregate([{ $match: { business_id: this.businessId } }, ...pipeline], options);
  }
}

// The tenant-scoped path every request-driven read/write should go through — pass the
// business_id straight from the authenticated session/call context, never from
// unauthenticated client input (plan.md §7).
export async function withTenant(businessId, fn) {
  const db = await getDb();
  return fn((name) => new ScopedCollection(db.collection(name), businessId));
}

// The deliberate escape hatch for genuinely cross-tenant system operations: looking up
// an admin by email at login (business_id is what's being resolved), business lookup by
// phone number for call routing, and the two background workers that sweep every
// tenant's bookings on a timer. Never call this with anything derived from request
// input — unlike withTenant, nothing here enforces a business_id boundary.
export async function withSystemAccess(fn) {
  const db = await getDb();
  return fn((name) => db.collection(name));
}
