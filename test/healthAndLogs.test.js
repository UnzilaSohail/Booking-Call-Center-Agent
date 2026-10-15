// AIN-509: /health answers from the database, and request logs never carry secrets.
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { app } from '../src/app.js';
import { client } from '../src/db.js';
import { safePath } from '../src/requestLog.js';

after(() => client.close());

test('safePath drops the query and hides token-looking segments but keeps ids', () => {
  assert.equal(safePath('/api/my-booking/AbCdEfGhIjKlMnOpQrStUvWx12345/cancel?x=1'), '/api/my-booking/[token]/cancel');
  assert.equal(safePath('/api/recordings/9f1c2e44-1111-4222-8333-444455556666/audio?token=secret'), '/api/recordings/9f1c2e44-1111-4222-8333-444455556666/audio');
  assert.equal(safePath('/api/bookings'), '/api/bookings');
});

test('/health is ok when the database answers', { skip: !process.env.MONGODB_URI && 'MONGODB_URI not set' }, async () => {
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally { await new Promise((r) => server.close(r)); }
});
