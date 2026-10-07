// Inbound call entry point (plan.md §5 step 1-2, §6 "Spoofed webhooks"). Twilio POSTs
// here when a customer dials a business's dedicated number; we verify the request is
// really from Twilio, look up the business by the number that was called, and hand the
// call off to a bidirectional Media Stream that src/voice/twilioBridge.js serves.
import express, { Router } from 'express';
import twilio from 'twilio';
import { DateTime } from 'luxon';
import { findBusinessByPhoneNumber, cancelBooking, assertWithinChangeCutoff } from '../services/bookingService.js';
import { upsertCustomer, markRecordingAcknowledged, setSmsOptIn, normalizePhone } from '../services/customerService.js';
import { isOpenNow } from '../voice/geminiSession.js';
import { withTenant, withSystemAccess, newId, serialize } from '../db.js';

export const twilioWebhookRouter = Router();
// Twilio posts application/x-www-form-urlencoded, not JSON — the app-wide express.json()
// middleware won't touch it, so this route parses its own body.
twilioWebhookRouter.use(express.urlencoded({ extended: false }));

const authToken = process.env.TWILIO_AUTH_TOKEN;

function verifyTwilioSignature(req) {
  if (!authToken) {
    console.warn('TWILIO_AUTH_TOKEN not set — skipping signature verification (dev only, never in production)');
    return true;
  }
  const signature = req.headers['x-twilio-signature'];
  const url = `${process.env.PUBLIC_HTTPS_URL || `https://${req.headers.host}`}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, url, req.body);
}

// Shared by /voice/incoming (real inbound calls) and /voice/test-call (onboarding's
// "call me now" step) — same disclosure, same call_logs row, same Media Stream connect,
// only how `business` is resolved and whether the log is tagged `is_test` differ.
async function respondWithVoiceAgent(res, req, business, { isTest = false } = {}) {
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();

  if (!business) {
    twiml.say('Sorry, this number is not currently set up to take bookings.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  await withTenant(business.id, (c) =>
    c('call_logs').insertOne({
      _id: newId(),
      business_id: business.id,
      call_sid: req.body.CallSid,
      phone: req.body.From,
      transcript: null,
      booking_id: null,
      outcome: 'in_progress',
      is_test: isTest,
      // ROADMAP.md §8 "After-hours calls" — same isOpenNow() check the system prompt
      // already uses (src/voice/geminiSession.js) to change agent behavior, just stamped
      // on the log so it's visible in Calls/Dashboard too.
      is_after_hours: isOpenNow(business) === false,
      created_at: new Date(),
    })
  );

  // plan.md §7: transcripts are stored (call_logs.transcript), so most jurisdictions
  // require this disclosure before the AI agent starts the actual conversation. This is
  // also the actual moment a real caller's consent record (customerService.js) reflects —
  // skipped for test calls to the admin's own phone, which aren't real customers.
  twiml.say('This call may be recorded and transcribed for booking and quality purposes.');
  if (!isTest && req.body.From) {
    upsertCustomer(business.id, { phone: req.body.From }).catch((err) => console.error('customer upsert failed on inbound call:', err.message));
    markRecordingAcknowledged(business.id, req.body.From).catch((err) => console.error('consent record failed on inbound call:', err.message));
  }

  // Call recording (ROADMAP.md §7, plan.md §11 item 1) — a real Twilio REST recording of
  // the call, not a custom capture off the Media Stream. Started here (not blocking the
  // TwiML response) since the call already exists by the time this webhook fires; the
  // recording lands via /webhooks/twilio/recording-status once it's done. Off by default
  // per business via recording_enabled (src/routes/settings.js), and skipped for test
  // calls the same way consent-tracking is above.
  if (!isTest && business.recording_enabled !== false) {
    const client = twilioClient();
    const base = process.env.PUBLIC_HTTPS_URL || `https://${req.headers.host}`;
    client?.calls(req.body.CallSid).recordings.create({
      recordingChannels: 'dual',
      recordingStatusCallback: `${base}/webhooks/twilio/recording-status`,
      recordingStatusCallbackEvent: ['completed'],
    }).catch((err) => console.error(`failed to start recording for call ${req.body.CallSid}:`, err.message));
  }

  const streamUrl = process.env.PUBLIC_WSS_URL || `wss://${req.headers.host}/voice/stream`;
  const connect = twiml.connect();
  const stream = connect.stream({ url: streamUrl });
  stream.parameter({ name: 'businessId', value: business.id });
  stream.parameter({ name: 'callSid', value: req.body.CallSid });
  stream.parameter({ name: 'from', value: req.body.From });

  res.type('text/xml').send(twiml.toString());
}

twilioWebhookRouter.post('/voice/incoming', async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected inbound call webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }

  const business = await findBusinessByPhoneNumber(req.body.To);
  await respondWithVoiceAgent(res, req, business);
});

// Onboarding's "make a test call" step (src/routes/onboarding.js POST /onboarding/test-call)
// — Twilio dials the admin's own phone with this as the TwiML URL, `businessId` passed
// directly since there's no dedicated inbound number to look it up by.
twilioWebhookRouter.post('/voice/test-call', async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected test-call webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }

  // Cross-tenant by design: resolving *which* business this test call belongs to from a
  // businessId is exactly what withSystemAccess exists for (src/db.js), same as the
  // called-number lookup /voice/incoming does via findBusinessByPhoneNumber.
  const doc = await withSystemAccess((c) => c('businesses').findOne({ _id: req.query.businessId }));
  const business = doc ? serialize(doc) : null;
  await respondWithVoiceAgent(res, req, business, { isTest: true });
});

function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

// Real warm transfer (ROADMAP.md §5) — redirects the *live* call to ring a human via
// Twilio's REST API, replacing the TwiML that's currently running (the Media Stream to
// Gemini). Uses Twilio's standard "whisper" idiom: <Number url=...> plays a short <Say>
// to the human alone before the two legs are bridged, which is what makes the transfer
// reason (ROADMAP's "conversation summary before transfer") actually get heard, not just
// logged. Returns false (never throws) if Twilio isn't configured, so callers can fall
// back to the graceful end-of-call + callback-request path.
export async function transferCallToHuman(callSid, phoneNumber, reason) {
  const client = twilioClient();
  if (!client) return false;
  const base = process.env.PUBLIC_HTTPS_URL;
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  const dial = twiml.dial({ action: `${base}/voice/transfer-result?reason=${encodeURIComponent(reason)}`, method: 'POST' });
  dial.number({ url: `${base}/voice/transfer-whisper?reason=${encodeURIComponent(reason)}`, method: 'POST' }, phoneNumber);
  try {
    await client.calls(callSid).update({ twiml: twiml.toString() });
    return true;
  } catch (err) {
    console.error(`transfer redirect failed for call ${callSid}:`, err.message);
    return false;
  }
}

// KG-07/27c: when Gemini Live fails to start (bad key, quota, model 404) the caller must
// not be left in silence until the 15-minute call cap — end the live call gracefully
// instead, same REST-redirect idiom as transferCallToHuman above. Never throws, so a
// caller (src/voice/twilioBridge.js) can always fall through to closing the media stream.
export async function endCallWithMessage(callSid, message) {
  const client = twilioClient();
  if (!client) return false;
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  twiml.say(message);
  twiml.hangup();
  try {
    await client.calls(callSid).update({ twiml: twiml.toString() });
    return true;
  } catch (err) {
    console.error(`graceful end failed for call ${callSid}:`, err.message);
    return false;
  }
}

// What the human hears alone, before being bridged to the caller — Twilio requests this
// once they answer the transfer call.
twilioWebhookRouter.post('/voice/transfer-whisper', (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected transfer-whisper webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  twiml.say(`Incoming transfer. ${req.query.reason || 'A caller needs assistance.'}`);
  res.type('text/xml').send(twiml.toString());
});

// <Dial>'s action callback — fires once the transfer attempt ends, however it ends.
// DialCallStatus is 'completed' for an actual answered/bridged call; anything else
// (no-answer/busy/failed/canceled) means the caller is still on the line with nobody
// connected, so this is also "Callback creation when staff are unavailable."
twilioWebhookRouter.post('/voice/transfer-result', async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected transfer-result webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  const status = req.body.DialCallStatus;
  const dialDurationSeconds = req.body.DialCallDuration ? Number(req.body.DialCallDuration) : null;

  const business = await findBusinessByPhoneNumber(req.body.To);
  if (status !== 'completed') {
    if (business) {
      await withTenant(business.id, (c) => Promise.all([
        c('callback_requests').insertOne({
          _id: newId(), call_sid: req.body.CallSid, phone: req.body.From,
          preferred_time: null, reason: req.query.reason || 'transfer not answered', status: 'pending', created_at: new Date(),
        }),
        c('call_logs').updateOne(
          { call_sid: req.body.CallSid },
          { $set: { outcome: 'transfer_failed: callback created', 'transfer.status': 'failed', 'transfer.resolvedAt': new Date(), 'transfer.dialStatus': status ?? null } }
        ),
      ]));
    }
    twiml.say("Sorry, no one is available to take your call right now. We'll have someone call you back as soon as possible.");
  } else if (business) {
    await withTenant(business.id, (c) => c('call_logs').updateOne(
      { call_sid: req.body.CallSid },
      { $set: { 'transfer.status': 'answered', 'transfer.resolvedAt': new Date(), 'transfer.durationSeconds': dialDurationSeconds } }
    ));
  }
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// Fires once the call recording started above (respondWithVoiceAgent) finishes
// processing — matched by CallSid, same as the sms-status callback below matches by
// MessageSid, so no business_id/tenant lookup is needed to find the row.
twilioWebhookRouter.post('/webhooks/twilio/recording-status', async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected recording-status webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration } = req.body;
  if (CallSid && RecordingUrl) {
    await withSystemAccess((c) => c('call_logs').updateOne(
      { call_sid: CallSid },
      { $set: { recording_sid: RecordingSid ?? null, recording_url: RecordingUrl, recording_duration_seconds: RecordingDuration ? Number(RecordingDuration) : null } }
    ));
  }
  res.sendStatus(204);
});

// "C" from a reminder text. Returns the sentence to text back. Honours the business's change cut-off.
export async function cancelNextByReply(business, from) {
  const phone = normalizePhone(from);
  const next = await withTenant(business.id, (c) => c('bookings').find({ phone, status: 'confirmed', is_test: { $ne: true }, start_time: { $gt: new Date() } }).sort({ start_time: 1 }).limit(1).next());
  if (!next) return `${business.name}: we could not find an upcoming appointment for this number.`;
  try {
    assertWithinChangeCutoff(business, next);
  } catch {
    return `${business.name}: it is too close to your appointment to cancel by text. Please call ${business.contact_phone || business.phone_number || 'us'}.`;
  }
  await cancelBooking(business.id, next._id, { via: 'sms_reply' });
  const service = await withTenant(business.id, (c) => c('services').findOne({ _id: next.service_id }));
  const when = DateTime.fromJSDate(next.start_time).setZone(business.timezone).toFormat('ccc d LLL, h:mm a');
  const again = business.slug ? ` Book again any time: ${process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002'}/book/${business.slug}` : '';
  return `${business.name}: your ${service?.name ?? 'appointment'} on ${when} is cancelled.${again}`;
}

const SMS_OPT_OUT_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
const SMS_OPT_IN_KEYWORDS = ['START', 'UNSTOP', 'YES'];

// Twilio's delivery-status callback for the confirmation/reminder SMS (src/notifications/
// sms.js passes this as statusCallback) — "Delivery status" from ROADMAP.md §6.
twilioWebhookRouter.post('/webhooks/twilio/sms-status', async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected sms-status webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }
  const { MessageSid, MessageStatus } = req.body;
  if (MessageSid && MessageStatus) {
    await withSystemAccess((c) => c('bookings').updateOne({ confirmation_sms_sid: MessageSid }, { $set: { confirmation_sms_status: MessageStatus } }));
  }
  res.sendStatus(204);
});

// Inbound SMS — "Opt-out management" from ROADMAP.md §6. Needs the business's Twilio
// number to have its Messaging webhook pointed here to actually receive replies
// (account-level Twilio console config, same class as the voice webhook already is).
twilioWebhookRouter.post('/webhooks/twilio/sms-inbound', async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected sms-inbound webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }
  const body = (req.body.Body || '').trim().toUpperCase();
  const business = await findBusinessByPhoneNumber(req.body.To);
  const { MessagingResponse } = twilio.twiml;
  const reply = new MessagingResponse();
  if (business) {
    if (SMS_OPT_OUT_KEYWORDS.includes(body)) await setSmsOptIn(business.id, req.body.From, false);
    else if (SMS_OPT_IN_KEYWORDS.includes(body)) await setSmsOptIn(business.id, req.body.From, true);
    else if (body === 'C') {
      // The reminder said "Reply C to cancel": cancel this person's next appointment (or say why we could not).
      const answer = await cancelNextByReply(business, req.body.From).catch((err) => { console.error('cancel-by-reply failed:', err.message); return null; });
      if (answer) reply.message(answer);
    }
  }
  // No reply for STOP/START: Twilio's own carrier-level handling already sends the compliance auto-reply
  // for opted-in numbers, so there is nothing to duplicate here.
  res.type('text/xml').send(reply.toString());
});
