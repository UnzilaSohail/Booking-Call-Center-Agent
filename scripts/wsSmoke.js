// Concurrent-connection smoke test for the Twilio Media Stream endpoint (docs/CONCURRENCY.md,
// test case CC-01). Opens N sockets at once with a start event for a business that does not
// exist, and checks the server closes every one, survives garbage frames, and still answers
// /health. It does NOT open Gemini sessions (no API key or cost), so it proves the socket layer,
// not the AI capacity — that needs a real multi-call test with phones.
//   node scripts/wsSmoke.js [connections=50] [http://localhost:3000]
import WebSocket from 'ws';

const N = Number(process.argv[2] ?? 50);
const base = process.argv[3] ?? 'http://localhost:3000';
const wsUrl = `${base.replace(/^http/, 'ws')}/voice/stream`;

function openOne(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.terminate(); resolve({ i, closedByServer: false, reason: 'timeout' }); }, 5000);
    ws.on('open', () => {
      ws.send('not json at all');
      ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
      ws.send(JSON.stringify({ event: 'start', start: { streamSid: `MZ${i}`, callSid: `CA${i}`, customParameters: { businessId: 'does-not-exist', from: '+15550000000' } } }));
    });
    ws.on('close', () => { clearTimeout(timer); resolve({ i, closedByServer: true }); });
    ws.on('error', (err) => { clearTimeout(timer); resolve({ i, closedByServer: false, reason: err.message }); });
  });
}

const started = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => openOne(i)));
const notClosed = results.filter((r) => !r.closedByServer);
const health = await fetch(`${base}/health`).then((r) => r.json()).catch((err) => ({ error: err.message }));

console.log(`${N} concurrent sockets: ${N - notClosed.length} closed by server, ${notClosed.length} not closed, ${Date.now() - started} ms`);
if (notClosed.length) console.log('first failures:', notClosed.slice(0, 3));
console.log('health after burst:', JSON.stringify(health));
process.exit(notClosed.length === 0 && health.ok ? 0 : 1);
