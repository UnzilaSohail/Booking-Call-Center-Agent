// Inbound call entry point (plan.md §5 step 1-2, §6 "Spoofed webhooks"). Twilio POSTs
// here when a customer dials a business's dedicated number; we verify the request is
// really from Twilio, look up the business by the number that was called, and hand the
// call off to a bidirectional Media Stream that src/voice/twilioBridge.js serves.
import express, { Router } from 'express';
import twilio from 'twilio';
import { findBusinessByPhoneNumber } from '../services/bookingService.js';
import { withTenant, newId } from '../db.js';

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

twilioWebhookRouter.post('/voice/incoming', async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    console.error('rejected inbound call webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }

  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();

  const calledNumber = req.body.To;
  const business = await findBusinessByPhoneNumber(calledNumber);

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
      created_at: new Date(),
    })
  );

  // plan.md §7: transcripts are stored (call_logs.transcript), so most jurisdictions
  // require this disclosure before the AI agent starts the actual conversation.
  twiml.say('This call may be recorded and transcribed for booking and quality purposes.');

  const streamUrl = process.env.PUBLIC_WSS_URL || `wss://${req.headers.host}/voice/stream`;
  const connect = twiml.connect();
  const stream = connect.stream({ url: streamUrl });
  stream.parameter({ name: 'businessId', value: business.id });
  stream.parameter({ name: 'callSid', value: req.body.CallSid });
  stream.parameter({ name: 'from', value: req.body.From });

  res.type('text/xml').send(twiml.toString());
});
