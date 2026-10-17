// The dashboard's API client (lib/api.js): the part every page depends on and none of them tests. Runs in plain Node with a
// fake window and fetch: `npm test` in dashboard/. (AIN-572, first dashboard tests)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../lib/api.js';

const TOKEN_KEY = 'booking_admin_token';
let store, redirects, calls;

function fakeFetch(handler) {
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return handler(url, options); };
}
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  store = new Map();
  redirects = [];
  calls = [];
  globalThis.window = {
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    location: { assign: (url) => redirects.push(url) },
  };
});

test('a request carries the saved token', async () => {
  store.set(TOKEN_KEY, 'tok123');
  fakeFetch(() => json(200, [{ id: 1 }]));
  assert.deepEqual(await api.listServices(), [{ id: 1 }]);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok123');
});

test('an expired session clears the token and sends the person to the login page, once', async () => {
  store.set(TOKEN_KEY, 'old');
  fakeFetch(() => json(401, { error: 'Session expired', code: 'session' }));
  await assert.rejects(api.listServices(), (e) => e.status === 401 && e.message === 'Session expired');
  assert.equal(store.has(TOKEN_KEY), false);
  assert.deepEqual(redirects, ['/login?expired=1']);
});

test('a wrong password or code (401 without the session marker) does not sign anyone out', async () => {
  store.set(TOKEN_KEY, 'still-good');
  fakeFetch(() => json(401, { error: 'Wrong password' }));
  await assert.rejects(api.listServices(), (e) => e.status === 401 && e.message === 'Wrong password');
  assert.equal(store.get(TOKEN_KEY), 'still-good');
  assert.deepEqual(redirects, []);
});

test('a session error with no saved token (a login attempt) does not redirect', async () => {
  fakeFetch(() => json(401, { error: 'Session expired', code: 'session' }));
  await assert.rejects(api.listServices());
  assert.deepEqual(redirects, []);
});

test('204 gives null, other failures carry the server message or a status fallback', async () => {
  fakeFetch(() => ({ status: 204, ok: true }));
  assert.equal(await api.listServices(), null);
  fakeFetch(() => json(409, { error: 'Slot taken' }));
  await assert.rejects(api.listServices(), (e) => e.status === 409 && e.message === 'Slot taken');
  fakeFetch(() => ({ status: 500, ok: false, json: async () => { throw new Error('not json'); } }));
  await assert.rejects(api.listServices(), (e) => e.status === 500 && e.message === 'request failed (500)');
});

test('a request that never answers ends with a clear message instead of a spinner', async () => {
  fakeFetch(() => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; });
  await assert.rejects(api.listServices(), (e) => e.status === 0 && /took too long/.test(e.message));
});

test('the CSV export also ends an expired session, and returns the text otherwise', async () => {
  store.set(TOKEN_KEY, 'old');
  fakeFetch(() => ({ status: 401, ok: false, text: async () => JSON.stringify({ error: 'Session expired', code: 'session' }) }));
  await assert.rejects(api.exportCustomersCsv());
  assert.deepEqual(redirects, ['/login?expired=1']);
  store.set(TOKEN_KEY, 'new');
  fakeFetch(() => ({ status: 200, ok: true, text: async () => 'name,phone\nA,1' }));
  assert.equal(await api.exportCustomersCsv(), 'name,phone\nA,1');
});
