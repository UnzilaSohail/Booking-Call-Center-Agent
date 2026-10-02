// Screenshot regression check for the customer-facing pages (Jira 26f): takes a picture of each page at
// desktop and phone width and compares it with the saved baseline in docs/screenshots/baseline. A change
// you did not mean to make (a layout shift, a broken style, a missing section) shows up as a failed
// comparison plus a highlighted diff image in docs/screenshots/diff.
//
//   npm run screenshots           compare with the baseline (exit 1 on a difference)
//   npm run screenshots:update    replace the baseline after an intended design change
//
// Needs the backend and the dashboard running (see docs/testing/TEST_CASES.md) and the same MONGODB_URI /
// MONGODB_DB_NAME as that backend: it seeds fixed demo businesses (scripts/demo/seedDemo.mjs) and removes them afterwards.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startBrowser, go, click, type } from './demo/lib.mjs';
import { seedDemo, cleanupDemo, DEMO } from './demo/seedDemo.mjs';
import { client } from '../src/db.js';

const UPDATE = process.argv.includes('--update');
const ROOT = path.resolve('docs/screenshots');
const MAX_DIFF_RATIO = 0.005; // up to 0.5% of pixels may differ (font smoothing, caret)
const VIEWPORTS = { desktop: { width: 1280, height: 720 }, phone: { width: 390, height: 844 } };

const SHOTS = [
  { name: 'find-search', run: async (page) => { await go(page, '/find', { wait: 800 }); await type(page, page.locator('#q'), 'Glow Studio', { delay: 10, after: 1500 }); } },
  { name: 'book-location', run: async (page) => { await go(page, `/book/${DEMO.slug}`, { wait: 1500 }); } },
  { name: 'book-services', run: async (page) => { await go(page, `/book/${DEMO.slug}`, { wait: 1200 }); await click(page, page.getByRole('button', { name: /Bayshore Branch/ }), { after: 1200 }); } },
  { name: 'login', run: async (page) => { await go(page, '/login', { wait: 1200 }); } },
  { name: 'signup', run: async (page) => { await go(page, '/signup', { wait: 1200 }); } },
  { name: 'my-signin', run: async (page) => { await go(page, `/my/${DEMO.slug}`, { wait: 1500 }); } },
  { name: 'find-dark', run: async (page) => { await page.evaluate(() => localStorage.setItem('theme', 'dark')); await go(page, '/find', { wait: 1200 }); } },
  { name: 'login-dark', run: async (page) => { await go(page, '/login', { wait: 1200 }); } },
];

fs.mkdirSync(path.join(ROOT, 'baseline'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'diff'), { recursive: true });

const results = [];
await seedDemo();
try {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const { browser, page } = await startBrowser({ size, overlay: false });
    for (const shot of SHOTS) {
      const file = `${shot.name}-${vp}.png`;
      await shot.run(page);
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(300);
      const current = await page.screenshot({ fullPage: false, animations: 'disabled' });
      const baselinePath = path.join(ROOT, 'baseline', file);
      if (UPDATE || !fs.existsSync(baselinePath)) {
        fs.writeFileSync(baselinePath, current);
        results.push({ file, status: UPDATE ? 'updated' : 'created' });
        continue;
      }
      const a = PNG.sync.read(fs.readFileSync(baselinePath));
      const b = PNG.sync.read(current);
      if (a.width !== b.width || a.height !== b.height) {
        results.push({ file, status: 'FAIL', detail: `size changed ${a.width}x${a.height} -> ${b.width}x${b.height}` });
        fs.writeFileSync(path.join(ROOT, 'diff', file), current);
        continue;
      }
      const diff = new PNG({ width: a.width, height: a.height });
      const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
      const ratio = changed / (a.width * a.height);
      if (ratio > MAX_DIFF_RATIO) {
        fs.writeFileSync(path.join(ROOT, 'diff', file), PNG.sync.write(diff));
        results.push({ file, status: 'FAIL', detail: `${(ratio * 100).toFixed(2)}% of pixels differ (limit ${MAX_DIFF_RATIO * 100}%), see docs/screenshots/diff/${file}` });
      } else {
        fs.rmSync(path.join(ROOT, 'diff', file), { force: true });
        results.push({ file, status: 'ok', detail: `${(ratio * 100).toFixed(3)}% differ` });
      }
    }
    await browser.close();
  }
} finally {
  await cleanupDemo();
  await client.close();
}

for (const r of results) console.log(`${r.status.padEnd(8)} ${r.file}${r.detail ? `  ${r.detail}` : ''}`);
const failed = results.filter((r) => r.status === 'FAIL');
if (failed.length) { console.error(`\n${failed.length} screenshot(s) changed. If the change is intended, run: npm run screenshots:update`); process.exitCode = 1; }
else console.log(`\nscreenshot check ${UPDATE ? 'baseline updated' : 'passed'} (${results.length} pages)`);
