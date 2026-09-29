// Slot times from the API are UTC ISO strings; format them in the admin's own browser
// timezone for display (plan.md §6 "Timezones: store UTC in DB, convert ... for ... UI only").
export const DateTime = {
  formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  },
  formatDateTime(iso) {
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  },
  formatDate(iso) {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  },
};
