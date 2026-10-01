import { Router } from 'express';
import { Readable } from 'node:stream';
import { listCallLogs } from '../services/callLogService.js';
import jwt from 'jsonwebtoken';
import { requireArea } from '../auth.js';
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

// Recording playback proxy — mounted WITHOUT the app-wide requireAuth (see app.js), because the
// dashboard's <audio src="..."> request comes straight from the browser and an HTML media
// element can't attach an Authorization header. Twilio's own recording URL needs HTTP Basic
// Auth the browser can't supply either, so this fetches the audio server-side and streams it.
//
// The URL carries a SHORT-LIVED token that is good for this one recording only (minted by
// POST /call-logs/:id/recording-token below, which is behind normal login) — never the login
// session token, which would end up in access logs, browser history and Referer headers.
// 15 minutes, not shorter: seeking in the player re-requests the URL with the same token.
const RECORDING_TOKEN_MINUTES = 15;

callLogsRouter.post('/call-logs/:id/recording-token', requireArea('calls'), async (req, res, next) => {
  try {
    const log = await withTenant(req.businessId, (c) => c('call_logs').findOne({ _id: req.params.id }, { projection: { recording_url: 1 } }));
    if (!log?.recording_url) return res.status(404).json({ error: 'no recording for this call' });
    const token = jwt.sign({ purpose: 'call-recording', businessId: req.businessId, callLogId: log._id }, process.env.JWT_SECRET, { expiresIn: `${RECORDING_TOKEN_MINUTES}m` });
    res.json({ token, expiresInMinutes: RECORDING_TOKEN_MINUTES });
  } catch (err) {
    next(err);
  }
});

export const callRecordingRouter = Router();

callRecordingRouter.get('/call-logs/:id/recording', async (req, res, next) => {
  try {
    let claims;
    try {
      claims = jwt.verify(String(req.query.rt ?? ''), process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'invalid or expired recording link' });
    }
    if (claims.purpose !== 'call-recording' || claims.callLogId !== req.params.id) return res.status(401).json({ error: 'invalid or expired recording link' });

    const log = await withTenant(claims.businessId, (c) => c('call_logs').findOne({ _id: req.params.id }));
    if (!log?.recording_url) return res.status(404).json({ error: 'no recording for this call' });

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !authToken) return res.status(503).json({ error: 'Twilio not configured' });

    const headers = { Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}` };
    if (req.headers.range) headers.Range = req.headers.range; // lets the player seek
    // .mp3 suffix: Twilio's recording resource serves the raw format by default
    // (not browser-playable without extra params); appending it gets an MP3 stream.
    const twilioRes = await fetch(`${log.recording_url}.mp3`, { headers });
    if (!twilioRes.ok || !twilioRes.body) return res.status(502).json({ error: 'failed to fetch recording from Twilio' });

    res.status(twilioRes.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    for (const h of ['content-length', 'content-range']) {
      const v = twilioRes.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    Readable.fromWeb(twilioRes.body).pipe(res);
  } catch (err) {
    next(err);
  }
});
