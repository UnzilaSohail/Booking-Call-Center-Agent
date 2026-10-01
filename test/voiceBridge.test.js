// Twilio media-stream bridge (docs/testing/TEST_CASES.md group VR): silence detection (27k),
// graceful drain on restart (27l) and transcript/duration saved when the SERVER closes a call
// (21m, KG-10). Real WebSocket client against the real bridge; Gemini and the call summary are
// swapped for fakes through the bridge's deps argument.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createTenant, dropTenants, skip, getDb, newId } from './support/tenantFixture.js';
import { attachTwilioMediaStreamServer, beginDrain, resetDrain, getActiveCalls } from '../src/voice/twilioBridge.js';
import { mulawFrameLevel, SPEECH_LEVEL } from '../src/voice/audio.js';

const SILENT = Buffer.alloc(160, 0xff).toString('base64'); // mu-law silence
const LOUD = Buffer.alloc(160, 0x00).toString('base64'); // mu-law full-scale
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await wait(50);
  }
};

describe('mu-law level', () => {
  it('VR-01 silence is near zero and speech is well above the threshold', () => {
    assert.equal(mulawFrameLevel(SILENT), 0);
    assert.ok(mulawFrameLevel(LOUD) > SPEECH_LEVEL * 10);
    assert.equal(mulawFrameLevel(''), 0);
    assert.equal(mulawFrameLevel(undefined), 0);
  });
});

describe('twilio media stream bridge', { skip }, () => {
  let db;
  let t;
  let server;
  let url;
  let sessions; // one entry per fake Gemini session started
  const envSaved = {};

  const fakeGemini = async (opts) => {
    const s = { opts, closed: false, audioIn: 0, sendCallerAudio() { s.audioIn++; }, close() { s.closed = true; } };
    sessions.push(s);
    return s;
  };

  // Opens a call: inserts the call_logs row the webhook would have made, connects, sends 'start'.
  async function openCall() {
    const callSid = `CA${newId()}`;
    await db.collection('call_logs').insertOne({ _id: newId(), business_id: t.businessId, call_sid: callSid, phone: '+15550800001', outcome: 'in_progress', created_at: new Date() });
    const ws = new WebSocket(url);
    const closed = new Promise((r) => ws.on('close', r));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ event: 'start', start: { streamSid: `MZ${newId()}`, callSid, customParameters: { businessId: t.businessId, from: '+15550800001' } } }));
    return { ws, callSid, closed };
  }
  const row = (callSid) => db.collection('call_logs').findOne({ call_sid: callSid });

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__voice__', staff: [] });
    for (const k of ['SILENCE_TIMEOUT_MS', 'WATCHDOG_INTERVAL_MS']) envSaved[k] = process.env[k];
    process.env.SILENCE_TIMEOUT_MS = '700';
    process.env.WATCHDOG_INTERVAL_MS = '100';
    server = createServer();
    attachTwilioMediaStreamServer(server, '/voice/stream', { startGeminiSession: fakeGemini, summarizeCall: async () => ({ summary: 'fake summary', intent: 'booking' }) });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `ws://127.0.0.1:${server.address().port}/voice/stream`;
  });

  after(async () => {
    resetDrain();
    for (const [k, v] of Object.entries(envSaved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await new Promise((r) => server.close(r));
    await dropTenants(t.businessId);
  });

  it('VR-02 a dead line (only silent frames) is hung up after the silence timeout (27k)', async () => {
    sessions = [];
    const { ws, callSid, closed } = await openCall();
    await until(() => sessions.length === 1);
    const t0 = Date.now();
    const pump = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'media', media: { payload: SILENT } })), 20);
    await closed;
    clearInterval(pump);
    const took = Date.now() - t0;
    assert.ok(took >= 600 && took < 3000, `closed after ${took} ms`);
    await until(async () => (await row(callSid)).outcome === 'completed');
    assert.equal(sessions[0].closed, true, 'the Gemini session was closed too');
  });

  it('VR-03 a line with speech on it stays open, then closes once the speech stops (27k)', async () => {
    sessions = [];
    const { ws, closed } = await openCall();
    await until(() => sessions.length === 1);
    let open = true;
    closed.then(() => { open = false; });
    const loud = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'media', media: { payload: LOUD } })), 20);
    await wait(1500); // twice the silence timeout
    assert.equal(open, true, 'still connected while the caller is speaking');
    assert.ok(sessions[0].audioIn > 20, 'audio reached the agent');
    clearInterval(loud);
    const quiet = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'media', media: { payload: SILENT } })), 20);
    await closed;
    clearInterval(quiet);
  });

  it('VR-04 the agent talking also counts as an active line', async () => {
    sessions = [];
    const { ws, closed } = await openCall();
    await until(() => sessions.length === 1);
    let open = true;
    closed.then(() => { open = false; });
    const quiet = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: 'media', media: { payload: SILENT } })), 20);
    const talk = setInterval(() => sessions[0].opts.onAudio(Buffer.alloc(480).toString('base64')), 100);
    await wait(1500);
    assert.equal(open, true);
    clearInterval(talk);
    clearInterval(quiet);
    ws.close();
    await closed;
  });

  it('VR-05 when the server ends the call, the transcript, duration and summary are still saved (21m)', async () => {
    sessions = [];
    const { ws, callSid, closed } = await openCall();
    await until(() => sessions.length === 1);
    sessions[0].opts.onTranscript('caller', 'I would like a haircut');
    sessions[0].opts.onTranscript('agent', 'Sure, what day?');
    await wait(1100); // a measurable duration
    sessions[0].opts.onEnded(); // Gemini ends the session: the server closes the socket, Twilio sends no 'stop'
    await closed;
    const saved = await until(async () => { const r = await row(callSid); return r.summary ? r : null; });
    assert.equal(saved.transcript, 'caller: I would like a haircut\nagent: Sure, what day?');
    assert.equal(saved.outcome, 'completed');
    assert.ok(saved.duration_seconds >= 1);
    assert.ok(saved.ended_at);
    assert.equal(saved.summary, 'fake summary');
    assert.equal(ws.readyState, ws.CLOSED);
  });

  it('VR-06 draining waits for calls in progress, refuses new ones politely, then finishes (27l)', async () => {
    sessions = [];
    const first = await openCall();
    await until(() => sessions.length === 1 && getActiveCalls() === 1);
    const drained = beginDrain(10_000);
    let done = false;
    drained.then(() => { done = true; });
    await wait(500);
    assert.equal(done, false, 'drain is still waiting for the live call');

    const late = await openCall();
    await late.closed;
    assert.equal(sessions.length, 1, 'no Gemini session was started for the new call');
    assert.equal((await row(late.callSid)).outcome, 'failed: restarting');
    assert.equal(done, false);

    first.ws.close();
    assert.equal(await drained, true, 'resolves once the last call ends');
    assert.equal(getActiveCalls(), 0);
  });

  it('VR-07 a drain that runs out of time gives up and says so', async () => {
    resetDrain();
    sessions = [];
    const call = await openCall();
    await until(() => sessions.length === 1 && getActiveCalls() === 1);
    assert.equal(await beginDrain(400), false);
    call.ws.close();
    await call.closed;
    await until(() => getActiveCalls() === 0);
    resetDrain();
  });
});
