import { Router } from 'express';
import { listCallLogs } from '../services/callLogService.js';
import { requireArea } from '../auth.js';

export const callLogsRouter = Router();

// GET /call-logs?from=&to=&phone=&outcome=  (all optional) — most recent first.
callLogsRouter.get('/call-logs', requireArea('calls'), async (req, res, next) => {
  try {
    const { from, to, phone, outcome } = req.query;
    res.json(await listCallLogs(req.businessId, { from, to, phone, outcome }));
  } catch (err) {
    next(err);
  }
});
