// Customer sign-in, deliberately separate from company login (src/auth.js): a customer proves
// they own a phone number (or email) with a one-time code, for ONE business, and gets a token
// with role:'customer'. requireAuth only accepts role:'business' and requireCustomer only
// accepts role:'customer', so neither kind of token works on the other's endpoints.
import jwt from 'jsonwebtoken';
import { getDb, withTenant } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_DAYS = 1; // short on purpose: coming back means one new code, and a lost phone stops working by tomorrow

export function signCustomerToken(businessId, customerId) {
  return jwt.sign({ role: 'customer', purpose: 'customer-session', businessId, customerId }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

export async function requireCustomer(req, res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'please sign in' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'your session has expired, please sign in again' });
    }
    if (payload.role !== 'customer' || payload.purpose !== 'customer-session') return res.status(401).json({ error: 'invalid token for this endpoint' });

    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: payload.businessId }, { projection: { status: 1 } });
    if (business?.status !== 'active') return res.status(401).json({ error: 'please sign in' });
    const customer = await withTenant(payload.businessId, (c) => c('customers').findOne({ _id: payload.customerId }));
    if (!customer) return res.status(401).json({ error: 'please sign in' });
    // "Sign out on all devices" stamps this time; any token issued before it is dead.
    if (customer.sessions_valid_after && payload.iat < Math.floor(new Date(customer.sessions_valid_after).getTime() / 1000)) return res.status(401).json({ error: 'your session has ended, please sign in again' });

    req.businessId = payload.businessId;
    req.customer = customer;
    next();
  } catch (err) {
    next(err);
  }
}
