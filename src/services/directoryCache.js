// A short memory for the public directory (Jira 36j). Every visitor's search used to read up to 500 businesses from the
// database; now the same question inside a short window is answered from memory. Any change made through the API
// clears it at once (app.js), and the time limit covers changes that come from elsewhere, so a visitor never sees
// a listing that is more than a few seconds out of date.
export function createCache(ttlMs) {
  const store = new Map();
  return {
    async cached(key, load) {
      if (!ttlMs) return load();
      const hit = store.get(key);
      if (hit && Date.now() < hit.until) return hit.value;
      const value = await load();
      if (store.size >= 200) store.clear(); // many different searches: start over rather than grow
      store.set(key, { value, until: Date.now() + ttlMs });
      return value;
    },
    clear: () => store.clear(),
  };
}

// 0 turns it off (the test runner does, so tests that write straight to the database see their own changes).
const shared = createCache(Number(process.env.DIRECTORY_CACHE_MS ?? 30_000));
export const cached = shared.cached;
export const clearDirectoryCache = shared.clear;
