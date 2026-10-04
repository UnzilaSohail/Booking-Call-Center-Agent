// Turns the stored "POST /api/staff" style records into sentences a business owner understands.
// Only changes that actually happened are logged, so there is no success/failure to show.
// Each rule: [HTTP method, pattern on the address, group, sentence]. First match wins.
const EXCEPTION_KIND = {
  callback_request: 'a call-back request', failed_booking: 'a booking that failed', voicemail: 'a voicemail', low_confidence_call: 'a call the AI was unsure about',
  sms_delivery: 'a text that did not go out', email_delivery: 'an email that did not go out', calendar_sync: 'a calendar sync problem', payment_failure: 'a failed payment',
};

const RULES = [
  ['POST', /^\/onboarding\/verify\/send/, 'Setup & security', 'Asked for a verification code'],
  ['POST', /^\/onboarding\/verify\/confirm/, 'Setup & security', 'Confirmed their email or phone number'],
  ['POST', /^\/onboarding\/test-call/, 'Setup & security', 'Made a test call to the AI receptionist'],
  ['POST', /^\/onboarding\/go-live/, 'Setup & security', 'Switched the AI receptionist on for real calls'],
  ['POST', /^\/onboarding\/voice/, 'AI & calls', "Chose the AI receptionist's voice"],
  ['POST', /^\/phone-number\/provision/, 'Setup & security', 'Got a business phone number'],
  ['POST', /^\/exceptions\/([^/]+)\/[^/]+\/retry/, 'Needs attention', (m) => `Tried again to fix ${EXCEPTION_KIND[m[1]] ?? 'an item'}`],
  ['PATCH', /^\/exceptions\/([^/]+)\//, 'Needs attention', (m) => `Updated ${EXCEPTION_KIND[m[1]] ?? 'an item'} in Needs attention`],
  ['POST', /^\/team-members\/invite/, 'Team', 'Invited someone to use this dashboard'],
  ['POST', /^\/team-members\/[^/]+\/resend-invite/, 'Team', 'Sent a dashboard invitation again'],
  ['PATCH', /^\/team-members\//, 'Team', 'Changed what a dashboard user can see or do'],
  ['POST', /^\/staff\/[^/]+\/time-off/, 'Team', 'Added time off for a team member'],
  ['DELETE', /^\/time-off\//, 'Team', "Removed a team member's time off"],
  ['POST', /^\/staff/, 'Team', 'Added a team member to the calendar'],
  ['PATCH', /^\/staff\//, 'Team', "Changed a team member's details or schedule"],
  ['DELETE', /^\/staff\//, 'Team', 'Removed a team member from the calendar'],
  ['POST', /^\/services/, 'Services', 'Added a service'],
  ['PATCH', /^\/services\//, 'Services', 'Changed a service'],
  ['DELETE', /^\/services\//, 'Services', 'Removed a service'],
  ['PUT', /^\/business-hours/, 'Settings', 'Changed opening hours'],
  ['PUT', /^\/business\/holidays/, 'Settings', 'Changed holidays and days closed'],
  ['PUT', /^\/business\/listing/, 'Settings', 'Changed how the business appears in the public directory'],
  ['PUT', /^\/business\/transfer-departments/, 'AI & calls', 'Changed who calls are transferred to'],
  ['POST', /^\/business\/restore/, 'Settings', 'Restored the business account'],
  ['DELETE', /^\/business/, 'Settings', 'Deleted the business account'],
  ['PATCH', /^\/business/, 'Settings', 'Changed business settings'],
  ['POST', /^\/locations/, 'Settings', 'Added a location'],
  ['PATCH', /^\/locations\//, 'Settings', 'Changed a location'],
  ['DELETE', /^\/locations\//, 'Settings', 'Removed a location'],
  ['PUT', /^\/knowledge\/draft/, 'AI & calls', 'Edited what the AI should know (not published yet)'],
  ['POST', /^\/knowledge\/publish/, 'AI & calls', 'Published what the AI should know'],
  ['POST', /^\/knowledge\/versions\/[^/]+\/rollback/, 'AI & calls', 'Went back to an earlier version of what the AI knows'],
  ['POST', /^\/bookings/, 'Bookings', 'Created a booking'],
  ['PATCH', /^\/bookings\//, 'Bookings', 'Changed a booking'],
  ['DELETE', /^\/bookings\//, 'Bookings', 'Cancelled a booking'],
  ['POST', /^\/customers\/import/, 'Customers', 'Imported a customer list'],
  ['POST', /^\/customers\/[^/]+\/merge/, 'Customers', 'Merged two records of the same customer'],
  ['PATCH', /^\/customers\//, 'Customers', "Edited a customer's details"],
  ['POST', /^\/call-logs\/[^/]+\/recording-token/, 'AI & calls', 'Listened to a call recording'],
  ['PATCH', /^\/billing\/plan/, 'Billing', 'Changed the subscription plan'],
  ['POST', /^\/billing\/cancel/, 'Billing', 'Cancelled the subscription'],
  ['POST', /^\/billing\/reactivate/, 'Billing', 'Restarted the subscription'],
  ['POST', /^\/billing\/(payment-method|setup-intent)/, 'Billing', 'Added or changed the payment card'],
  ['POST', /^\/billing\/invoices\/[^/]+\/retry/, 'Billing', 'Tried to pay an unpaid invoice again'],
  ['PATCH', /^\/auth\/password/, 'Setup & security', 'Changed their password'],
  ['POST', /^\/auth\/mfa\/enroll/, 'Setup & security', 'Turned on two-step login'],
  ['POST', /^\/auth\/mfa\/disable/, 'Setup & security', 'Turned off two-step login'],
  ['POST', /^\/calendar\//, 'Settings', 'Changed the Google Calendar connection'],
];

export const GROUPS = ['Bookings', 'Customers', 'Team', 'Services', 'Settings', 'AI & calls', 'Billing', 'Needs attention', 'Setup & security'];

// log: { method, path } as stored. Returns { text, group }.
export function describeActivity({ method, path }) {
  const clean = String(path ?? '').split('?')[0].replace(/^\/api/, '');
  for (const [m, re, group, text] of RULES) {
    if (m !== method) continue;
    const hit = re.exec(clean);
    if (hit) return { group, text: typeof text === 'function' ? text(hit) : text };
  }
  // Unknown action: still a sentence, never a web address.
  const noun = clean.split('/').filter(Boolean)[0]?.replace(/[-_]/g, ' ') ?? 'something';
  return { group: 'Settings', text: `${{ POST: 'Added', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Removed' }[method] ?? 'Changed'} ${noun}` };
}
