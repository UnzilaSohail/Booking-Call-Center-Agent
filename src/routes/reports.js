// "Email me the report now" (Jira 41): the owner can see what the monthly email looks like without waiting for the 1st.
// Sends the month so far to the logged-in person's own address only.
import { Router } from 'express';
import { DateTime } from 'luxon';
import { getDb } from '../db.js';
import { requireArea } from '../auth.js';
import { sendEmail } from '../notifications/email.js';
import { buildMonthlyReport, formatReport } from '../services/reportService.js';

export const reportsRouter = Router();
const gate = requireArea('settings');

reportsRouter.post('/reports/send-now', gate, async (req, res, next) => {
  try {
    const db = await getDb();
    const [business, admin] = await Promise.all([db.collection('businesses').findOne({ _id: req.businessId }), db.collection('admins').findOne({ _id: req.adminId })]);
    if (!admin?.email) return res.status(400).json({ error: 'no email address on your account' });
    const now = DateTime.now().setZone(business.timezone || 'UTC');
    const stats = await buildMonthlyReport(req.businessId, now.startOf('month').toUTC().toJSDate(), now.toUTC().toJSDate());
    const { subject, text } = formatReport(business, stats, `${now.toFormat('LLLL')} so far`);
    const result = await sendEmail(admin.email, `[Sample] ${subject}`, text);
    if (!result?.sent) return res.status(503).json({ error: `The email could not be sent: ${result?.reason ?? 'email is not set up on this server'}`, preview: text });
    res.json({ ok: true, sentTo: admin.email });
  } catch (err) {
    next(err);
  }
});
