// "How was your visit?" (Jira 39): one text, about two hours after the appointment ends, with the business's Google
// review link. Sent only when the owner has set a link, the customer accepts texts, the booking was not cancelled, and
// the same customer has not been asked in the last 30 days. Never between 9pm and 8am (it waits for the morning).
import { DateTime } from 'luxon';
import { getDb, withSystemAccess, withTenant } from '../db.js';
import { sendSms } from '../notifications/sms.js';
import { getConsent } from './customerService.js';

const ASK_AFTER_MS = 2 * 3_600_000;
const GIVE_UP_AFTER_MS = 30 * 3_600_000; // a booking from yesterday evening can still be asked this morning
const REPEAT_AFTER_MS = 30 * 86_400_000;

export const isGoodReviewLink = (v) => { try { const u = new URL(String(v)); return u.protocol === 'https:'; } catch { return false; } };

// `send` is injectable so tests can count texts without a provider.
// businessIds: tests pass their own business so other data in a shared database is left alone. Normal runs: all.
export async function runReviewSweepOnce({ send = sendSms, now = Date.now(), businessIds } = {}) {
  const db = await getDb();
  // Only businesses that set a review link: bookings of the others must not crowd the batch.
  const withLink = await db.collection('businesses').find({ review_link: { $type: 'string' }, status: { $ne: 'suspended' }, ...(businessIds ? { _id: { $in: businessIds } } : {}) }, { projection: { _id: 1 } }).toArray();
  if (!withLink.length) return 0;
  const due = await withSystemAccess((c) => c('bookings').find({
    business_id: { $in: withLink.map((b) => b._id) }, status: 'confirmed', no_show: { $ne: true }, is_test: { $ne: true }, review_request_sent_at: null,
    end_time: { $lte: new Date(now - ASK_AFTER_MS), $gte: new Date(now - GIVE_UP_AFTER_MS) },
  }).limit(100).toArray());
  const businesses = new Map();
  let sent = 0;
  for (const b of due) {
    if (!businesses.has(b.business_id)) businesses.set(b.business_id, await db.collection('businesses').findOne({ _id: b.business_id }));
    const biz = businesses.get(b.business_id);
    if (!biz?.review_link || biz.status === 'suspended') continue; // not set up: leave it, the owner may add a link later (within the window)
    const hour = DateTime.fromMillis(now).setZone(biz.timezone).hour;
    if (hour >= 21 || hour < 8) continue; // wait for the morning
    // claim first (atomic), so two sweeps never text the same person twice
    const claim = await withSystemAccess((c) => c('bookings').updateOne({ _id: b._id, review_request_sent_at: null }, { $set: { review_request_sent_at: new Date(now) } }));
    if (claim.modifiedCount === 0) continue;
    const customer = await withTenant(b.business_id, (c) => c('customers').findOne({ phone: b.phone }));
    const recent = customer?.last_review_request_at && now - new Date(customer.last_review_request_at).getTime() < REPEAT_AFTER_MS;
    const optedOut = (await getConsent(b.business_id, b.phone).catch(() => null))?.smsOptIn === false;
    if (recent || optedOut) continue; // marked as handled above, nothing sent
    try {
      await send(b.business_id, b.phone, `Thanks for visiting ${biz.name}${b.customer_name ? `, ${b.customer_name.split(' ')[0]}` : ''}! If you enjoyed it, a quick Google review would mean a lot to us: ${biz.review_link}${biz.slug ? ` Ready for your next visit? Book here: ${process.env.PUBLIC_DASHBOARD_URL || 'http://localhost:3002'}/book/${biz.slug}` : ''}`);
      await withTenant(b.business_id, (c) => c('customers').updateOne({ phone: b.phone }, { $set: { last_review_request_at: new Date(now) } }));
      sent++;
    } catch (err) {
      console.error(`review request failed for booking ${b._id}:`, err.message);
    }
  }
  return sent;
}
