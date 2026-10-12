// Every API response carries a locked-down CSP (Jira 52c): the API shares an origin with the dashboard's tokens,
// so a route that ever reflects attacker text as HTML must not be able to run script. No database needed.
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { app } from '../src/app.js';

test('API responses forbid scripts, framing and content sniffing', async () => {
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
