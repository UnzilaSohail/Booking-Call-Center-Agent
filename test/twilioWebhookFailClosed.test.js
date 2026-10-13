// With no TWILIO_AUTH_TOKEN, production must refuse every Twilio webhook (it used to accept all of them) (Jira 52l).
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'production';
delete process.env.TWILIO_AUTH_TOKEN; // after dotenv, before the app reads it
const { app } = await import('../src/app.js');

test('production without a Twilio auth token refuses the inbound-call webhook', async () => {
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/voice/incoming`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'To=%2B15550900001&From=%2B15550900002&CallSid=CA1',
    });
    assert.equal(res.status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
