// Public company self-signup — additive to, not a replacement for, the platform-admin
// registration flow in src/routes/platform.js (plan.md §7/§9's "companies don't
// self-register" decision was explicitly revisited for this feature; platform-admin
// registration still exists for sales-assisted/manual onboarding).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb, newId } from '../db.js';
import { generateCode, hashCode, CODE_TTL_MS } from '../verification.js';
import { sendEmail } from '../notifications/email.js';
import { sendSms } from '../notifications/sms.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const signupRouter = Router();

async function sendVerificationCode(db, adminId, channel, destination) {
  const code = generateCode();
  const hash = await hashCode(code);
  const now = new Date();
  await db.collection('admins').updateOne({ _id: adminId }, {
    $set: {
      [`${channel}_code_hash`]: hash,
      [`${channel}_code_expires_at`]: new Date(now.getTime() + CODE_TTL_MS),
      [`${channel}_code_attempts`]: 0,
      [`${channel}_code_sent_at`]: now,
    },
  });
  if (channel === 'email') {
    await sendEmail(destination, 'Verify your email', `Your verification code is ${code}. It expires in 10 minutes.`);
  } else {
    await sendSms(destination, `Your verification code is ${code}. It expires in 10 minutes.`);
  }
}

signupRouter.post('/signup', async (req, res, next) => {
  const {
    businessName, industry, timezone, locationName, address, contactPhone,
    ownerName, ownerEmail, ownerPhone, ownerPassword, termsAccepted,
  } = req.body ?? {};

  if (!businessName || !ownerEmail || !ownerPassword || !ownerPhone) {
    return res.status(400).json({ error: 'businessName, ownerEmail, ownerPhone and ownerPassword are required' });
  }
  if (ownerPassword.length < 8) return res.status(400).json({ error: 'ownerPassword must be at least 8 characters' });
  if (termsAccepted !== true) return res.status(400).json({ error: 'you must accept the terms and privacy policy' });

  try {
    const db = await getDb();
    const businessId = newId();
    await db.collection('businesses').insertOne({
      _id: businessId,
      name: businessName,
      industry: industry || null,
      timezone: timezone || 'UTC',
      contact_email: ownerEmail.toLowerCase(),
      contact_phone: contactPhone || null,
      address: address || null,
      status: 'active',
      // phone_number intentionally omitted until provisioned (routes/phoneNumber.js) —
      // db/schema.js's unique index only constrains documents where it's an actual string.
      google_refresh_token: null,
      google_calendar_id: 'primary',
      reschedule_cutoff_minutes: 120,
      hours: [],
      faqs: [],
      voice_name: null,
      onboarding_completed_at: null,
      test_call_at: null,
      created_at: new Date(),
    });

    const passwordHash = await bcrypt.hash(ownerPassword, 10);
    let adminId;
    try {
      adminId = newId();
      await db.collection('admins').insertOne({
        _id: adminId,
        business_id: businessId,
        name: ownerName || null,
        email: ownerEmail.toLowerCase(),
        phone: ownerPhone,
        password_hash: passwordHash,
        role: 'owner',
        status: 'active',
        terms_accepted_at: new Date(),
        email_verified_at: null,
        phone_verified_at: null,
        created_at: new Date(),
      });
    } catch (err) {
      // No cross-collection transaction for this multi-insert — clean up by hand on the
      // one failure mode that matters, same as platform.js's registration endpoint.
      await db.collection('businesses').deleteOne({ _id: businessId });
      if (err.code === 11000) return res.status(409).json({ error: 'an account with this email already exists' });
      throw err;
    }

    if (locationName || address) {
      await db.collection('locations').insertOne({
        _id: newId(),
        business_id: businessId,
        name: locationName || businessName,
        address: address || null,
        contact_phone: contactPhone || null,
        is_primary: true,
        created_at: new Date(),
      });
    }

    await Promise.all([
      sendVerificationCode(db, adminId, 'email', ownerEmail.toLowerCase()),
      sendVerificationCode(db, adminId, 'phone', ownerPhone),
    ]);

    const token = jwt.sign({ role: 'business', adminId, businessId }, JWT_SECRET, { expiresIn: '12h' });
    res.status(201).json({ token });
  } catch (err) {
    next(err);
  }
});
