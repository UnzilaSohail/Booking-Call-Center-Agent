// Onboarding step (plan.md §7): "admin gets a dedicated inbound phone number
// provisioned." This purchases a real Twilio number and is billed to the Twilio
// account — it's an explicit admin-triggered action, never automatic.
import { Router } from 'express';
import twilio from 'twilio';
import { getDb } from '../db.js';
import { requireArea } from '../auth.js';

export const phoneNumberRouter = Router();

// Applied per-route (see the comment in src/routes/services.js for why).
const gate = requireArea('settings');

function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw Object.assign(new Error('Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)'), { status: 503 });
  return twilio(sid, token);
}

phoneNumberRouter.get('/phone-number', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { phone_number: 1 } });
    res.json({ phone_number: business?.phone_number ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /phone-number/provision { areaCode?, country? } — searches for and buys one
// available number, points its voice webhook at this business, and stores it.
phoneNumberRouter.post('/phone-number/provision', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const existing = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { phone_number: 1 } });
    if (existing?.phone_number) return res.status(409).json({ error: 'this business already has a phone number', phoneNumber: existing.phone_number });

    const client = twilioClient();
    const country = req.body?.country || 'US';
    const searchParams = { limit: 1, voiceEnabled: true, ...(req.body?.areaCode ? { areaCode: req.body.areaCode } : {}) };

    const available = await client.availablePhoneNumbers(country).local.list(searchParams);
    if (!available.length) return res.status(404).json({ error: 'no available numbers matched — try a different area code/country' });

    const voiceUrl = `${process.env.PUBLIC_HTTPS_URL}/voice/incoming`;
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      voiceUrl,
      voiceMethod: 'POST',
    });

    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { phone_number: purchased.phoneNumber } });
    res.status(201).json({ phoneNumber: purchased.phoneNumber });
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ error: err.message });
    next(err);
  }
});
