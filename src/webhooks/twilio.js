// Inbound call entry point (plan.md §5 step 1-2, §6 "Spoofed webhooks"). Twilio POSTs
// here when a customer dials a business's dedicated number; we verify the request is
// really from Twilio, look up the business by the number that was called, and hand the
// call off to a bidirectional Media Stream that src/voice/twilioBridge.js serves.
import express, { Router } from 'express';
import twilio from 'twilio';
import { findBusinessByPhoneNumber } from '../services/bookingService.js';
import { upsertCustomer, markRecordingAcknowledged } from '../services/customerService.js';
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
