// Public — a newly-invited team member has no bearer token yet, so this mirrors
// src/routes/myBooking.js's public-token-router shape (mounted before requireAuth).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';
import { verifyInviteToken } from '../teamInvite.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const acceptInviteRouter = Router();

async function loadInvite(token) {
  const claims = verifyInviteToken(token);
  if (!claims) return { error: 'this invite link is invalid or has expired' };
  const db = await getDb();
  const admin = await db.collection('admins').findOne({ _id: claims.adminId });
  if (!admin || admin.status !== 'invited') return { error: 'this invite link is invalid or has expired' };
  const business = await db.collection('businesses').findOne({ _id: admin.business_id }, { projection: { name: 1 } });
  return { admin, business };
}

acceptInviteRouter.get('/accept-invite/:token', async (req, res, next) => {
  try {
    const { error, admin, business } = await loadInvite(req.params.token);
    if (error) return res.status(404).json({ error });
    res.json({ businessName: business.name, role: admin.role, name: admin.name, email: admin.email });
  } catch (err) {
    next(err);
  }
});

acceptInviteRouter.post('/accept-invite/:token', async (req, res, next) => {
  try {
    const { password } = req.body ?? {};
    if (!password || password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

    const { error, admin } = await loadInvite(req.params.token);
    if (error) return res.status(404).json({ error });

    const password_hash = await bcrypt.hash(password, 10);
    const db = await getDb();
    await db.collection('admins').updateOne({ _id: admin._id }, {
      $set: { password_hash, status: 'active', invite_accepted_at: new Date() },
    });

    const token = jwt.sign({ role: 'business', adminId: admin._id, businessId: admin.business_id }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (err) {
    next(err);
  }
});
