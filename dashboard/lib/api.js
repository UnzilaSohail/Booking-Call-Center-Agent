// Thin client for the backend REST API (../src). No calendar logic lives here — every
// availability/conflict decision stays server-side so the dashboard and the voice agent
// can never disagree (plan.md §8 phase 2: "no calendar logic duplicated").
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const TOKEN_KEY = 'booking_admin_token';
const PLATFORM_TOKEN_KEY = 'booking_platform_admin_token';

function makeTokenStore(key) {
  return {
    get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(key)),
    set: (token) => window.localStorage.setItem(key, token),
    clear: () => window.localStorage.removeItem(key),
  };
}

const companyTokenStore = makeTokenStore(TOKEN_KEY);
const platformTokenStore = makeTokenStore(PLATFORM_TOKEN_KEY);

// Kept as named exports for the existing company-admin pages.
export const getToken = companyTokenStore.get;
export const setToken = companyTokenStore.set;
export const clearToken = companyTokenStore.clear;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, tokenStore } = {}) {
  const headers = { 'content-type': 'application/json' };
  const token = tokenStore?.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `request failed (${res.status})`);
  return data;
}

// CSV export comes back as text, not JSON — bearer-token auth means a plain <a href>
// can't carry the Authorization header, so the caller fetches the text and triggers a
// client-side download itself (see dashboard/app/customers/page.jsx).
async function requestText(path, { tokenStore } = {}) {
  const headers = {};
  const token = tokenStore?.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, text || `request failed (${res.status})`);
  return text;
}

export const api = {
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  getMe: () => request('/api/auth/me', { tokenStore: companyTokenStore }),
  changePassword: (payload) => request('/api/auth/password', { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),

  getBusiness: () => request('/api/business', { tokenStore: companyTokenStore }),
  updateBusiness: (payload) => request('/api/business', { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),

  signup: (payload) => request('/api/signup', { method: 'POST', body: payload }),

  getOnboardingStatus: () => request('/api/onboarding/status', { tokenStore: companyTokenStore }),
  sendVerificationCode: (channel) => request('/api/onboarding/verify/send', { method: 'POST', body: { channel }, tokenStore: companyTokenStore }),
  confirmVerificationCode: (channel, code) => request('/api/onboarding/verify/confirm', { method: 'POST', body: { channel, code }, tokenStore: companyTokenStore }),
  setVoice: (voiceName) => request('/api/onboarding/voice', { method: 'POST', body: { voiceName }, tokenStore: companyTokenStore }),
  triggerTestCall: (toPhoneNumber) => request('/api/onboarding/test-call', { method: 'POST', body: { toPhoneNumber }, tokenStore: companyTokenStore }),
  goLive: () => request('/api/onboarding/go-live', { method: 'POST', tokenStore: companyTokenStore }),

  listLocations: () => request('/api/locations', { tokenStore: companyTokenStore }),
  createLocation: (payload) => request('/api/locations', { method: 'POST', body: payload, tokenStore: companyTokenStore }),
  updateLocation: (id, payload) => request(`/api/locations/${id}`, { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),
  deleteLocation: (id) => request(`/api/locations/${id}`, { method: 'DELETE', tokenStore: companyTokenStore }),

  listServices: () => request('/api/services', { tokenStore: companyTokenStore }),
  createService: (payload) => request('/api/services', { method: 'POST', body: payload, tokenStore: companyTokenStore }),
  updateService: (id, payload) => request(`/api/services/${id}`, { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),
  deleteService: (id) => request(`/api/services/${id}`, { method: 'DELETE', tokenStore: companyTokenStore }),

  listStaff: () => request('/api/staff', { tokenStore: companyTokenStore }),
  createStaff: (payload) => request('/api/staff', { method: 'POST', body: payload, tokenStore: companyTokenStore }),
  updateStaff: (id, payload) => request(`/api/staff/${id}`, { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),
  deleteStaff: (id) => request(`/api/staff/${id}`, { method: 'DELETE', tokenStore: companyTokenStore }),

  listTeamMembers: () => request('/api/team-members', { tokenStore: companyTokenStore }),
  inviteTeamMember: (payload) => request('/api/team-members/invite', { method: 'POST', body: payload, tokenStore: companyTokenStore }),
  updateTeamMember: (id, payload) => request(`/api/team-members/${id}`, { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),

  listExceptions: (status) => request(`/api/exceptions?${new URLSearchParams({ status })}`, { tokenStore: companyTokenStore }),
  updateException: (type, id, payload) => request(`/api/exceptions/${type}/${id}`, { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),
  retryException: (type, id) => request(`/api/exceptions/${type}/${id}/retry`, { method: 'POST', tokenStore: companyTokenStore }),

  listStaffTimeOff: (staffId) => request(`/api/staff/${staffId}/time-off`, { tokenStore: companyTokenStore }),
  createStaffTimeOff: (staffId, payload) => request(`/api/staff/${staffId}/time-off`, { method: 'POST', body: payload, tokenStore: companyTokenStore }),
  deleteStaffTimeOff: (id) => request(`/api/time-off/${id}`, { method: 'DELETE', tokenStore: companyTokenStore }),

  getBusinessHours: () => request('/api/business-hours', { tokenStore: companyTokenStore }),
  putBusinessHours: (hours) => request('/api/business-hours', { method: 'PUT', body: { hours }, tokenStore: companyTokenStore }),

  getHolidays: () => request('/api/business/holidays', { tokenStore: companyTokenStore }),
  putHolidays: (holidays) => request('/api/business/holidays', { method: 'PUT', body: { holidays }, tokenStore: companyTokenStore }),

  getTransferDepartments: () => request('/api/business/transfer-departments', { tokenStore: companyTokenStore }),
  putTransferDepartments: (departments) => request('/api/business/transfer-departments', { method: 'PUT', body: { departments }, tokenStore: companyTokenStore }),

  getKnowledge: () => request('/api/knowledge', { tokenStore: companyTokenStore }),
  saveKnowledgeDraft: (payload) => request('/api/knowledge/draft', { method: 'PUT', body: payload, tokenStore: companyTokenStore }),
  publishKnowledge: () => request('/api/knowledge/publish', { method: 'POST', tokenStore: companyTokenStore }),
  getKnowledgeVersions: () => request('/api/knowledge/versions', { tokenStore: companyTokenStore }),
  rollbackKnowledge: (version) => request(`/api/knowledge/versions/${version}/rollback`, { method: 'POST', tokenStore: companyTokenStore }),

  getAvailability: (serviceId, date, staffId, excludeBookingId) =>
    request(`/api/availability?${new URLSearchParams({ serviceId, date, ...(staffId ? { staffId } : {}), ...(excludeBookingId ? { excludeBookingId } : {}) })}`, { tokenStore: companyTokenStore }),

  listBookings: (from, to, extra = {}) => {
    const params = {};
    for (const [k, v] of Object.entries({ from, to, ...extra })) if (v !== undefined && v !== '') params[k] = v;
    return request(`/api/bookings?${new URLSearchParams(params)}`, { tokenStore: companyTokenStore });
  },
  createBooking: (payload) => request('/api/bookings', { method: 'POST', body: { ...payload, createdVia: 'dashboard' }, tokenStore: companyTokenStore }),
  rescheduleBooking: (id, startTime) => request(`/api/bookings/${id}`, { method: 'PATCH', body: { startTime }, tokenStore: companyTokenStore }),
  cancelBooking: (id) => request(`/api/bookings/${id}`, { method: 'DELETE', tokenStore: companyTokenStore }),

  getStats: () => request('/api/stats', { tokenStore: companyTokenStore }),
  getAnalytics: () => request('/api/analytics', { tokenStore: companyTokenStore }),

  calendarStatus: () => request('/api/calendar/status', { tokenStore: companyTokenStore }),
  calendarConnectUrl: () => request('/api/calendar/connect', { tokenStore: companyTokenStore }),

  getPhoneNumber: () => request('/api/phone-number', { tokenStore: companyTokenStore }),
  provisionPhoneNumber: (payload) => request('/api/phone-number/provision', { method: 'POST', body: payload, tokenStore: companyTokenStore }),

  listCallLogs: (from, to) => request(`/api/call-logs?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`, { tokenStore: companyTokenStore }),

  listCustomers: (q) => request(`/api/customers${q ? `?${new URLSearchParams({ q })}` : ''}`, { tokenStore: companyTokenStore }),
  getCustomer: (id) => request(`/api/customers/${id}`, { tokenStore: companyTokenStore }),
  updateCustomer: (id, payload) => request(`/api/customers/${id}`, { method: 'PATCH', body: payload, tokenStore: companyTokenStore }),
  exportCustomersCsv: () => requestText('/api/customers/export', { tokenStore: companyTokenStore }),
  importCustomersCsv: (csv) => request('/api/customers/import', { method: 'POST', body: { csv }, tokenStore: companyTokenStore }),

  getBillingPlan: () => request('/api/billing/plan', { tokenStore: companyTokenStore }),
  updateBillingPlan: (plan) => request('/api/billing/plan', { method: 'PATCH', body: { plan }, tokenStore: companyTokenStore }),
  getBillingUsage: () => request('/api/billing/usage', { tokenStore: companyTokenStore }),
  listInvoices: () => request('/api/billing/invoices', { tokenStore: companyTokenStore }),
  retryInvoice: (id) => request(`/api/billing/invoices/${id}/retry`, { method: 'POST', tokenStore: companyTokenStore }),
  createSetupIntent: () => request('/api/billing/setup-intent', { method: 'POST', tokenStore: companyTokenStore }),
  savePaymentMethod: (paymentMethodId) => request('/api/billing/payment-method', { method: 'POST', body: { paymentMethodId }, tokenStore: companyTokenStore }),
  cancelBillingPlan: () => request('/api/billing/cancel', { method: 'POST', tokenStore: companyTokenStore }),
  reactivateBillingPlan: () => request('/api/billing/reactivate', { method: 'POST', tokenStore: companyTokenStore }),
};

// Customer self-service (ROADMAP.md §6 reschedule/cancel links) — token-authenticated
// via the URL itself (dashboard/app/manage/[token]/page.jsx), no bearer token/login at all.
export const myBookingApi = {
  get: (token) => request(`/api/my-booking/${token}`),
  getAvailability: (token, date) => request(`/api/my-booking/${token}/availability?${new URLSearchParams({ date })}`),
  reschedule: (token, startTime) => request(`/api/my-booking/${token}/reschedule`, { method: 'POST', body: { startTime } }),
  cancel: (token) => request(`/api/my-booking/${token}/cancel`, { method: 'POST' }),
};

// Team-invite acceptance (ROADMAP.md §10) — token-authenticated via the URL itself
// (dashboard/app/accept-invite/[token]/page.jsx), same shape as myBookingApi above.
export const acceptInviteApi = {
  get: (token) => request(`/api/accept-invite/${token}`),
  accept: (token, password) => request(`/api/accept-invite/${token}`, { method: 'POST', body: { password } }),
};

// Platform-admin actions: registering/listing companies. A separate token namespace
// from the company-admin `api` above, so being logged into one doesn't imply the other.
export const platformApi = {
  getToken: platformTokenStore.get,
  setToken: platformTokenStore.set,
  clearToken: platformTokenStore.clear,

  login: (payload) => request('/api/platform/auth/login', { method: 'POST', body: payload }),
  changePassword: (payload) => request('/api/platform/auth/password', { method: 'PATCH', body: payload, tokenStore: platformTokenStore }),
  getMe: () => request('/api/platform/auth/me', { tokenStore: platformTokenStore }),
  listCompanies: (q) => request(`/api/platform/businesses${q ? `?${new URLSearchParams({ q })}` : ''}`, { tokenStore: platformTokenStore }),
  getCompany: (id) => request(`/api/platform/businesses/${id}`, { tokenStore: platformTokenStore }),
  setCompanyStatus: (id, status) => request(`/api/platform/businesses/${id}/status`, { method: 'PATCH', body: { status }, tokenStore: platformTokenStore }),
  resetAdminPassword: (adminId, newPassword) => request(`/api/platform/admins/${adminId}/password`, { method: 'PATCH', body: { newPassword }, tokenStore: platformTokenStore }),
  registerCompany: (payload) => request('/api/platform/businesses', { method: 'POST', body: payload, tokenStore: platformTokenStore }),
  getStats: () => request('/api/platform/stats', { tokenStore: platformTokenStore }),
  getAnalytics: () => request('/api/platform/analytics', { tokenStore: platformTokenStore }),
  listBookings: (q, status) => request(`/api/platform/bookings?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) })}`, { tokenStore: platformTokenStore }),
  listCallLogs: () => request('/api/platform/call-logs', { tokenStore: platformTokenStore }),
  getCompanyBilling: (id) => request(`/api/platform/businesses/${id}/billing`, { tokenStore: platformTokenStore }),
};

// Single login call used by the one login page (app/login/page.jsx) — tries both roles
// server-side (src/routes/unifiedLogin.js) so the admin doesn't have to know or pick
// which one they are. Returns { token, role: 'business' | 'platform' }; the caller
// stores the token in the matching store (companyTokenStore vs platformTokenStore) and
// routes to that role's dashboard.
export const unifiedLogin = (payload) => request('/api/login', { method: 'POST', body: payload });
export function storeTokenForRole(role, token) {
  (role === 'platform' ? platformTokenStore : companyTokenStore).set(token);
}

export { ApiError };
