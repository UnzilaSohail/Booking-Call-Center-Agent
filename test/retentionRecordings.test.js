// Retention also deletes the audio at Twilio, and only forgets a recording once Twilio confirmed (Jira 54i).
import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { runRetentionSweepOnce } from '../src/services/retentionWorker.js';

describe('retention sweep with recordings', { skip }, () => {
  let db; let t;
  const old = new Date(Date.now() - 10 * 86_400_000);
  const call = (sid, extra = {}) => ({ _id: newId(), business_id: t.businessId, call_sid: `CA${newId()}`, phone: '+15550900021', created_at: old, outcome: 'completed', transcript: 'hello', recording_sid: sid, recording_url: sid ? `https://api.twilio.com/${sid}` : null, ...extra });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__retention__' });
    await db.collection('businesses').updateOne({ _id: t.businessId }, { $set: { recording_retention_days: 1 } });
  });
  after(async () => {
    await db.collection('call_logs').deleteMany({ business_id: t.businessId });
    await dropTenants(t.businessId);
  });

  it('RT-01 deletes at Twilio first; a failed delete keeps the sid for the next sweep but still clears the transcript', async () => {
    const ok = call('RE_ok'); const gone = call('RE_gone'); const broken = call('RE_broken'); const noAudio = call(null);
    await db.collection('call_logs').insertMany([ok, gone, broken, noAudio]);
    const asked = [];
    await runRetentionSweepOnce({
      deleteRecording: async (sid) => {
        asked.push(sid);
        if (sid === 'RE_gone') throw Object.assign(new Error('not found'), { status: 404 });
        if (sid === 'RE_broken') throw Object.assign(new Error('twilio down'), { status: 500 });
      },
    });
    assert.deepEqual(asked.sort(), ['RE_broken', 'RE_gone', 'RE_ok']);
    const row = (c) => db.collection('call_logs').findOne({ _id: c._id });
    assert.equal((await row(ok)).recording_sid, null);
    assert.equal((await row(gone)).recording_sid, null, '404 means it is already gone');
    assert.equal((await row(broken)).recording_sid, 'RE_broken', 'kept so the next sweep retries');
    assert.equal((await row(broken)).transcript, null, 'the transcript is cleared regardless');
    assert.equal((await row(noAudio)).transcript, null);
    assert.equal((await row(ok)).outcome, 'completed', 'outcome and counts survive');
  });
});
