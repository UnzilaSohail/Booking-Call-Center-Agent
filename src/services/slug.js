// Public booking-page names (`/book/<slug>`, docs/customer/DISCOVERY_AND_LISTING.md).
// slugify/validateSlug are pure; uniqueSlug and backfillSlugs touch the businesses collection.
export const RESERVED_SLUGS = new Set([
  'api', 'admin', 'login', 'signup', 'find', 'book', 'directory', 'manage', 'my', 'platform',
  'onboarding', 'settings', 'team', 'billing', 'public', 'health', 'accept-invite', 'new', 'www',
]);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '');
}

// Returns an error string, or null when the slug is acceptable.
export function validateSlug(slug) {
  if (typeof slug !== 'string' || slug.length < 3 || slug.length > 40) return 'slug must be 3 to 40 characters';
  if (!SLUG_RE.test(slug)) return 'slug can only use lowercase letters, numbers and single hyphens';
  if (RESERVED_SLUGS.has(slug)) return 'that name is reserved, pick another';
  return null;
}

// abc-salon, then abc-salon-tampa, then abc-salon-2, -3, ... The unique index is the real
// guard; this only makes a collision unlikely, and callers retry once on a 11000.
export async function uniqueSlug(db, name, city) {
  const base = slugify(name) || 'business';
  const candidates = [base, city && slugify(`${base}-${city}`)].filter(Boolean);
  for (let n = 2; n < 100; n++) candidates.push(`${base.slice(0, 36)}-${n}`);
  for (const c of candidates) {
    if (validateSlug(c)) continue;
    if (!(await db.collection('businesses').findOne({ slug: c }, { projection: { _id: 1 } }))) return c;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

// Gives every business created before slugs existed a link name. Idempotent; run by migrate.
export async function backfillSlugs(db) {
  const rows = await db.collection('businesses').find({ slug: { $exists: false } }, { projection: { name: 1, 'listing.city': 1 } }).toArray();
  for (const b of rows) {
    await db.collection('businesses').updateOne(
      { _id: b._id, slug: { $exists: false } },
      { $set: { slug: await uniqueSlug(db, b.name, b.listing?.city) } }
    );
  }
  return rows.length;
}
