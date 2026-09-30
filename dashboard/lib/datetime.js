// Slot times from the API are UTC ISO strings; format them in the admin's own browser
// timezone for display (plan.md §6 "Timezones: store UTC in DB, convert ... for ... UI only").
export const DateTime = {
  // timeZone is optional: the customer-facing manage page passes the business's zone so the
  // time matches what the booking page and SMS said; the admin UI keeps the browser's zone.
  formatTime(iso, timeZone) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  },
  formatDateTime(iso, timeZone) {
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone });
  },
  formatDate(iso) {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  },
};
