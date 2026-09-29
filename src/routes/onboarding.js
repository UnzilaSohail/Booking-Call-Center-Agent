// Guided onboarding: contact verification, AI voice selection, test call, go-live.
// Everything else the checklist points at (services/staff/calendar/phone/FAQs) already
// has working Settings UI — this router only owns what's genuinely new.
import { Router } from 'express';
import twilio from 'twilio';
import { getDb } from '../db.js';
import { generateCode, hashCode, verifyCode, CODE_TTL_MS, MAX_ATTEMPTS } from '../verification.js';
import { sendEmail } from '../notifications/email.js';
import { sendSms } from '../notifications/sms.js';

export const onboardingRouter = Router();

const RESEND_COOLDOWN_MS = 60 * 1000;

// Known Gemini Live prebuilt voice names as of the last check (2026-09-16) — same
// "confirm against current docs before relying on this" caveat as the model id in
// src/voice/geminiSession.js, since this list moves on the same API surface.
export const VOICE_OPTIONS = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];
export const DEFAULT_VOICE = 'Kore';

// Pure — no DB access — so it's directly unit-testable (test/onboarding.test.js).
export function computeOnboardingStatus(business, admin, counts) {
  const steps = [
    { key: 'verify_contact', label: 'Verify email & phone', done: !!(admin.email_verified_at && admin.phone_verified_at), skippable: false },
    { key: 'services', label: 'Add your services', done: counts.services > 0, skippable: false },
    { key: 'staff', label: 'Add staff', done: counts.staff > 0, skippable: true },
    { key: 'calendar', label: 'Connect Google Calendar', done: business.google_refresh_token != null, skippable: true },
    { key: 'phone_number', label: 'Get a phone number', done: business.phone_number != null, skippable: false },
    { key: 'knowledge_base', label: 'Add common questions', done: (business.faqs?.length ?? 0) > 0, skippable: true },
    { key: 'ai_voice', label: 'Choose an AI voice', done: business.voice_name != null, skippable: true },
    { key: 'test_call', label: 'Make a test call', done: business.test_call_at != null, skippable: false },
    { key: 'go_live', label: 'Go live', done: business.onboarding_completed_at != null, skippable: false },
  ];
  const requiredRemaining = steps.filter((s) => !s.skippable && s.key !== 'go_live' && !s.done).map((s) => s.key);
  return { steps, requiredRemaining, readyForGoLive: requiredRemaining.length === 0 };
}

onboardingRouter.get('/onboarding/status', async (req, res, next) => {
  try {
    const db = await getDb();
    const [business, admin, services, staff] = await Promise.all([
      db.collection('businesses').findOne({ _id: req.businessId }),
      db.collection('admins').findOne({ _id: req.adminId }),
      db.collection('services').countDocuments({ business_id: req.businessId }),
      db.collection('staff').countDocuments({ business_id: req.businessId }),
    ]);
    res.json(computeOnboardingStatus(business, admin, { services, staff }));
  } catch (err) {
    next(err);
  }
});

onboardingRouter.post('/onboarding/verify/send', async (req, res, next) => {
  try {
    const { channel } = req.body ?? {};
    if (channel !== 'email' && channel !== 'phone') return res.status(400).json({ error: "channel must be 'email' or 'phone'" });

    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: req.adminId });
    if (!admin) return res.status(404).json({ error: 'admin not found' });

    const sentAt = admin[`${channel}_code_sent_at`];
    if (sentAt && Date.now() - new Date(sentAt).getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'a code was just sent — wait a bit before requesting another' });
    }

    const destination = channel === 'email' ? admin.email : admin.phone;
    if (!destination) return res.status(400).json({ error: `no ${channel} on file for this account` });

    const code = generateCode();
    const hash = await hashCode(code);
    const now = new Date();
    await db.collection('admins').updateOne({ _id: req.adminId }, {
      $set: {
        [`${channel}_code_hash`]: hash,
        [`${channel}_code_expires_at`]: new Date(now.getTime() + CODE_TTL_MS),
        [`${channel}_code_attempts`]: 0,
        [`${channel}_code_sent_at`]: now,
      },
    });

    if (channel === 'email') await sendEmail(destination, 'Verify your email', `Your verification code is ${code}. It expires in 10 minutes.`);
    else await sendSms(null, destination, `Your verification code is ${code}. It expires in 10 minutes.`);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

onboardingRouter.post('/onboarding/verify/confirm', async (req, res, next) => {
  try {
    const { channel, code } = req.body ?? {};
    if (channel !== 'email' && channel !== 'phone') return res.status(400).json({ error: "channel must be 'email' or 'phone'" });
    if (!code) return res.status(400).json({ error: 'code is required' });

    const db = await getDb();
    const admin = await db.collection('admins').findOne({ _id: req.adminId });
    if (!admin) return res.status(404).json({ error: 'admin not found' });

    const attempts = admin[`${channel}_code_attempts`] ?? 0;
    if (attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'too many attempts — request a new code' });

    const ok = await verifyCode(code, admin[`${channel}_code_hash`], admin[`${channel}_code_expires_at`]);
    if (!ok) {
      await db.collection('admins').updateOne({ _id: req.adminId }, { $inc: { [`${channel}_code_attempts`]: 1 } });
      return res.status(400).json({ error: 'invalid or expired code' });
    }

    await db.collection('admins').updateOne({ _id: req.adminId }, {
      $set: { [`${channel}_verified_at`]: new Date() },
      $unset: { [`${channel}_code_hash`]: '', [`${channel}_code_expires_at`]: '', [`${channel}_code_attempts`]: '', [`${channel}_code_sent_at`]: '' },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

onboardingRouter.post('/onboarding/voice', async (req, res, next) => {
  try {
    const { voiceName } = req.body ?? {};
    if (!VOICE_OPTIONS.includes(voiceName)) return res.status(400).json({ error: `voiceName must be one of: ${VOICE_OPTIONS.join(', ')}` });

    const db = await getDb();
    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { voice_name: voiceName } });
    res.json({ ok: true, voiceName });
  } catch (err) {
    next(err);
  }
});

function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw Object.assign(new Error('Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)'), { status: 503 });
  return twilio(sid, token);
}

onboardingRouter.post('/onboarding/test-call', async (req, res, next) => {
  try {
    const { toPhoneNumber } = req.body ?? {};
    if (!toPhoneNumber) return res.status(400).json({ error: 'toPhoneNumber is required' });

    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: req.businessId }, { projection: { phone_number: 1 } });
    if (!business?.phone_number) return res.status(409).json({ error: 'get a phone number before making a test call' });

    const client = twilioClient();
    const url = `${process.env.PUBLIC_HTTPS_URL}/voice/test-call?businessId=${encodeURIComponent(req.businessId)}`;
    await client.calls.create({ to: toPhoneNumber, from: business.phone_number, url });

    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { test_call_at: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ error: err.message });
    next(err);
  }
});

onboardingRouter.post('/onboarding/go-live', async (req, res, next) => {
  try {
    const db = await getDb();
    const [business, admin, services, staff] = await Promise.all([
      db.collection('businesses').findOne({ _id: req.businessId }),
      db.collection('admins').findOne({ _id: req.adminId }),
      db.collection('services').countDocuments({ business_id: req.businessId }),
      db.collection('staff').countDocuments({ business_id: req.businessId }),
    ]);
    const { requiredRemaining, readyForGoLive } = computeOnboardingStatus(business, admin, { services, staff });
    if (!readyForGoLive) return res.status(409).json({ error: `finish these steps first: ${requiredRemaining.join(', ')}` });

    await db.collection('businesses').updateOne({ _id: req.businessId }, { $set: { onboarding_completed_at: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
