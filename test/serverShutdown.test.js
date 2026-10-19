// AIN-610: the real server process exits cleanly on SIGTERM / SIGINT (idle, so the drain has nothing to
// wait for). Drain with live calls is covered in voiceBridge.test.js. Signals do not reach a child the
// same way on Windows, so this runs on Linux/macOS (CI, the VPS) only.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const skip = process.platform === 'win32' ? 'POSIX signals only' : !process.env.MONGODB_URI && 'MONGODB_URI not set';

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  for (let i = 0; i < 100 && !out.includes(`listening on :${port}`); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(out.includes(`listening on :${port}`), `server did not start:\n${out}`);
  return { child, port, exited, output: () => out };
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`server exits 0 on ${signal} with no calls in progress`, { skip }, async () => {
    const { child, port, exited, output } = await startServer();
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    child.kill(signal);
    const result = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 8000))]);
    if (result === 'timeout') child.kill('SIGKILL');
    assert.notEqual(result, 'timeout', `still running 8s after ${signal}:\n${output()}`);
    assert.deepEqual(result, { code: 0, signal: null }, output());
    assert.ok(!output().includes('drain timed out'), output());
  });
}
