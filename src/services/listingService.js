// Directory listing opt-in rule (docs/plans/PLAN_1_CUSTOMER.md §1A, Jira 16b/16c/16j).
// Listing is opt-in — listed defaults to false, the owner turns it on in Settings — and
// even opted-in, a business only actually appears in the directory once it's genuinely
// ready: go-live done, active (not suspended), has a bookable service, and has hours set.
// No approval queue: the platform admin can only hide a listing after the fact
// (hidden_by_platform), not gate it before (that field/endpoint is Jira 16w, not built yet).
//
// Pure — no DB access — so it's directly unit-testable, same convention as
// computeOnboardingStatus (src/routes/onboarding.js).
export const LISTING_CATEGORIES = [
  'hair-salon', 'barber', 'nail-salon', 'spa-massage', 'dentist', 'doctor', 'physiotherapy',
  'fitness', 'home-services', 'restaurant', 'professional-services', 'other',
];

export function isListingEligible(business, { serviceCount }) {
  return (
    business.onboarding_completed_at != null &&
    (business.status ?? 'active') === 'active' && // not suspended, not deleted

    serviceCount > 0 &&
    (business.hours?.length ?? 0) > 0
  );
}

// Whether the business actually shows up in the public directory right now.
export function isListed(business, { serviceCount }) {
  const listing = business.listing ?? {};
  if (listing.listed !== true) return false;
  if (listing.hidden_by_platform === true) return false;
  return isListingEligible(business, { serviceCount });
}
