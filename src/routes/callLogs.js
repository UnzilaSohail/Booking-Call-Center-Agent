import { Router } from 'express';
import { Readable } from 'node:stream';
import { listCallLogs } from '../services/callLogService.js';
import { requireArea, resolveSessionFromToken, SessionError } from '../auth.js';
import { withTenant } from '../db.js';

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

// Recording playback proxy — mounted WITHOUT the app-wide requireAuth (see app.js) and
// does its own token check instead, because the dashboard's <audio src="..."> request
// comes straight from the browser with no Authorization header (an HTML media element
// can't attach custom headers), so it carries the session token as ?token= instead.
// Twilio's own recording URL requires HTTP Basic Auth with the account's SID/token — the
// browser can't supply that either, which is exactly the login popup this route avoids by
// fetching the audio here (server-side, where the Twilio credentials actually live) and
// streaming it back rather than ever exposing the raw Twilio URL to the browser.
export const callRecordingRouter = Router();

callRecordingRouter.get('/call-logs/:id/recording', async (req, res, next) => {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (!token) return res.status(401).json({ error: 'missing token' });

    const { businessId, admin } = await resolveSessionFromToken(token);
    if (!admin.areas.includes('calls')) return res.status(403).json({ error: "you don't have access to calls" });

    const log = await withTenant(businessId, (c) => c('call_logs').findOne({ _id: req.params.id }));
    if (!log?.recording_url) return res.status(404).json({ error: 'no recording for this call' });

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !authToken) return res.status(503).json({ error: 'Twilio not configured' });

    const basicAuth = Buffer.from(`${sid}:${authToken}`).toString('base64');
    // .mp3 suffix: Twilio's recording resource serves the raw format by default
    // (not browser-playable without extra params); appending it gets an MP3 stream.
    const twilioRes = await fetch(`${log.recording_url}.mp3`, { headers: { Authorization: `Basic ${basicAuth}` } });
    if (!twilioRes.ok || !twilioRes.body) return res.status(502).json({ error: 'failed to fetch recording from Twilio' });

    res.setHeader('Content-Type', 'audio/mpeg');
    const contentLength = twilioRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    Readable.fromWeb(twilioRes.body).pipe(res);
  } catch (err) {
    if (err instanceof SessionError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});
