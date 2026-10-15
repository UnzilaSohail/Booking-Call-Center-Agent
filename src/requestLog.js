// One log line per request: method, path, status, milliseconds. Never the query string, the body or headers: they carry
// login codes, recording links and tokens. Segments that look like a secret token are replaced. Only on in production (or
// LOG_REQUESTS=1) so test output stays quiet. /health is skipped: an uptime monitor would drown everything else.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safePath(url) {
  return String(url).split('?')[0].split('/').map((seg) => (/^[A-Za-z0-9_-]{24,}$/.test(seg) && !UUID.test(seg) ? '[token]' : seg)).join('/');
}

export function requestLog(req, res, next) {
  if (process.env.NODE_ENV !== 'production' && !process.env.LOG_REQUESTS) return next();
  const started = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    console.log(`${req.method} ${safePath(req.originalUrl)} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
}
