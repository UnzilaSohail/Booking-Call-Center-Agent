// Local dev convenience — exposes this machine's backend (default :3000) to the public
// internet via a free Cloudflare quick tunnel, so Twilio can actually reach it for
// testing the voice pipeline. Not for production; the URL changes every time this runs.
import { Tunnel } from 'cloudflared';

const target = process.argv[2] || 'http://localhost:3000';
const tunnel = Tunnel.quick(target);

tunnel.once('url', (url) => {
  console.log('READY ' + url);
  console.log('press Ctrl+C to stop');
});
tunnel.on('error', (err) => console.error('tunnel error:', err.message));
tunnel.on('exit', (code) => console.log('tunnel exited with code', code));
