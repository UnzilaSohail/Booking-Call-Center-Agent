// Staff view of the waiting list (Jira 38): who asked to be told when a time opens up, who was already texted, and removal.
import { Router } from 'express';
import { requireArea } from '../auth.js';
import { listWaitlist, removeWaitlistEntry } from '../services/waitlistService.js';

export const waitlistRouter = Router();
const gate = requireArea('bookings');

waitlistRouter.get('/waitlist', gate, async (req, res, next) => {
  try {
    res.json(await listWaitlist(req.businessId));
  } catch (err) {
    next(err);
  }
});

waitlistRouter.delete('/waitlist/:id', gate, async (req, res, next) => {
  try {
    if (!(await removeWaitlistEntry(req.businessId, req.params.id))) return res.status(404).json({ error: 'not on the list' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
