// Post-deploy smoke test (Jira 31g). Checks that a deployed copy is alive and that its doors are locked:
//   npm run smoke -- https://bookingagent.sparkmind.online          (API and dashboard on one address)
//   npm run smoke -- https://api.example.com https://app.example.com   (API address, then dashboard address)
// Makes only harmless requests: no login, no data written. Exit code 1 if anything fails.
import WebSocket from 'ws';

const api = (process.argv[2] || process.env.SMOKE_URL || 'http://localhost:3000').replace(/\/$/, '');
const app = (process.argv[3] || api).replace(/\/$/, '');
let failed = 0;
const check = async (name, fn) => {
  try { const detail = await fn(); console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}  -> ${e.message}`); }
};
const get = (url, opts) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...opts });
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('API health', async () => { const r = await get(`${api}/health`); expect(r.status === 200 && (await r.json()).ok === true, `status ${r.status}`); });
await check('dashboard home (find page)', async () => { const r = await get(`${app}/find`); expect(r.status === 200, `status ${r.status}`); expect((await r.text()).includes('<html'), 'not an HTML page'); });
await check('dashboard login page', async () => { const r = await get(`${app}/login`); expect(r.status === 200, `status ${r.status}`); });
await check('public directory answers JSON', async () => { const r = await get(`${api}/api/public/directory?page=1`); const j = await r.json(); expect(r.status === 200 && Array.isArray(j.results), `status ${r.status}`); return `${j.total} listed`; });
await check('unknown business page is a clean 404, not an error', async () => { const r = await get(`${api}/api/public/no-such-business-xyz`); expect(r.status === 404, `status ${r.status}`); });
if (api.startsWith('https://')) await check('plain http redirects to https', async () => { const r = await get(api.replace('https://', 'http://') + '/health'); expect([301, 302, 307, 308].includes(r.status), `status ${r.status}`); });

// Doors that must stay locked without a login (also covers the demo-data endpoints)
for (const [method, path] of [['GET', '/api/platform/demo-data'], ['POST', '/api/platform/demo-data'], ['DELETE', '/api/platform/demo-data'], ['GET', '/api/platform/businesses'], ['GET', '/api/bookings'], ['GET', '/api/customers'], ['GET', '/api/call-logs'], ['GET', '/api/me/appointments']]) {
  await check(`${method} ${path} refuses anonymous callers`, async () => { const r = await get(api + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined }); expect(r.status === 401 || r.status === 403, `status ${r.status} (should be 401/403)`); });
}
await check('a made-up token is refused on the platform API', async () => { const r = await get(`${api}/api/platform/demo-data`, { headers: { authorization: 'Bearer not.a.token' } }); expect(r.status === 401 || r.status === 403, `status ${r.status}`); });

await check('voice WebSocket accepts a connection', () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${api.replace(/^http/, 'ws')}/voice/stream`);
  const t = setTimeout(() => { ws.terminate(); reject(new Error('no upgrade within 10s (nginx needs the Upgrade/Connection headers)')); }, 10_000);
  ws.on('open', () => { clearTimeout(t); ws.close(); resolve(); });
  ws.on('error', (e) => { clearTimeout(t); reject(e); });
}));

console.log(failed ? `\n${failed} check(s) failed` : '\nsmoke test passed');
process.exit(failed ? 1 : 0);
