import { Router } from 'express';
import { listCallLogs } from '../services/callLogService.js';

export const callLogsRouter = Router();

// GET /call-logs?from=&to=  (ISO datetimes, both optional) — most recent first.
callLogsRouter.get('/call-logs', async (req, res, next) => {
  try {
    res.json(await listCallLogs(req.businessId, { from: req.query.from, to: req.query.to }));
  } catch (err) {
    next(err);
  }
});
