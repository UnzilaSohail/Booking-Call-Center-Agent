// Role → dashboard-area access (ROADMAP.md §10). Areas map 1:1 onto nav pages so a
// route's gate always matches the page that calls it — see src/auth.js's requireArea.
export const AREAS = ['bookings', 'customers', 'calls', 'services', 'team', 'settings', 'exceptions', 'billing'];

const ROLE_AREAS = {
  owner: AREAS,
  // Same operational access as owner — the one thing that actually separates them is
  // requireOwner (src/auth.js), gating admin-management specifically, not areas.
  manager: AREAS,
  receptionist: ['bookings', 'customers', 'calls', 'exceptions'],
  staff: ['bookings', 'calls'],
  // §11 (Platform Billing) shipped — this is the scope cut from the Team Management
  // round being closed, not new role design.
  billing: ['billing'],
};

// Missing role = an admin created before roles existed — treated as owner so no
// migration is needed for existing accounts.
export function areasFor(admin) {
  if (admin.role === 'custom') return admin.permissions ?? [];
  return ROLE_AREAS[admin.role ?? 'owner'] ?? [];
}

export function hasArea(admin, area) {
  return areasFor(admin).includes(area);
}
