// Playwright helpers for the recorded walkthrough and the screenshot checks. Everything here only
// drives a browser; no application code. Browsers and ffmpeg come from Playwright's own cache
// (npx playwright install chromium ffmpeg, if a machine does not have them yet).
import { chromium } from 'playwright';

export const BASE = process.env.DASHBOARD_URL || 'http://localhost:3002';
export const API = process.env.API_URL || 'http://localhost:3000';

// Injected into every page before it loads: a caption bar along the bottom, a visible mouse
// pointer (Playwright videos do not show one) and a click ripple. State lives in sessionStorage so
// it survives navigation inside the same tab.
const OVERLAY = `(() => {
  const ready = () => {
    if (document.getElementById('__cap')) return;
    const css = document.createElement('style');
    css.textContent = \`
      #__cap { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: min(900px, 92vw); z-index: 2147483647;
        background: rgba(15,30,45,.92); color: #fff; font: 600 17px/1.35 system-ui, sans-serif; padding: 10px 18px; border-radius: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,.35); text-align: center; pointer-events: none; display: none; }
      #__cursor { position: fixed; z-index: 2147483647; width: 18px; height: 18px; margin: -3px 0 0 -3px; pointer-events: none;
        border-radius: 50%; background: rgba(37,99,235,.9); border: 2px solid #fff; box-shadow: 0 1px 6px rgba(0,0,0,.45); transition: transform .08s; }
      #__cursor.down { transform: scale(.7); }
      .__ripple { position: fixed; z-index: 2147483646; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; pointer-events: none;
        border: 3px solid rgba(37,99,235,.8); animation: __rip .5s ease-out forwards; }
      @keyframes __rip { to { transform: scale(4); opacity: 0; } }\`;
    document.head.appendChild(css);
    const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = '__cursor'; document.body.appendChild(cur);
    const setCap = (t) => { cap.textContent = t || ''; cap.style.display = t ? 'block' : 'none'; };
    window.__setCap = setCap;
    try { setCap(sessionStorage.getItem('__cap')); const x = +sessionStorage.getItem('__cx') || 40, y = +sessionStorage.getItem('__cy') || 40; cur.style.left = x + 'px'; cur.style.top = y + 'px'; } catch {}
    addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; try { sessionStorage.setItem('__cx', e.clientX); sessionStorage.setItem('__cy', e.clientY); } catch {} }, true);
    addEventListener('mousedown', (e) => {
      cur.classList.add('down');
      const r = document.createElement('div'); r.className = '__ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener('mouseup', () => cur.classList.remove('down'), true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();`;

export async function startBrowser({ videoDir, size = { width: 1280, height: 720 }, overlay = true } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: size, locale: 'en-US', timezoneId: 'America/New_York',
    ...(videoDir ? { recordVideo: { dir: videoDir, size } } : {}),
  });
  if (overlay) await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  return { browser, context, page };
}

export const pause = (page, ms = 1200) => page.waitForTimeout(ms);

export async function caption(page, text) {
  await page.evaluate((t) => { try { sessionStorage.setItem('__cap', t ?? ''); } catch {} window.__setCap?.(t ?? ''); }, text);
}

// Glide the pointer to an element so the viewer can follow what is about to be clicked.
export async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
}

export async function click(page, locator, { after = 700 } = {}) {
  await moveTo(page, locator);
  await page.waitForTimeout(250);
  await locator.click();
  await page.waitForTimeout(after);
}

export async function type(page, locator, text, { delay = 55, after = 400 } = {}) {
  await moveTo(page, locator);
  await locator.click();
  await locator.fill('');
  await page.keyboard.type(text, { delay });
  await page.waitForTimeout(after);
}

export async function go(page, path, { wait = 1500 } = {}) {
  await page.goto(path.startsWith('http') ? path : `${BASE}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
}

export async function login(page, email, password) {
  await go(page, '/login', { wait: 800 });
  await type(page, page.locator('input[type="email"]').first(), email);
  await type(page, page.locator('input[type="password"]').first(), password);
  await click(page, page.getByRole('button', { name: /^log in$/i }), { after: 1800 });
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  await page.waitForTimeout(800);
}

export async function logout(page) {
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.removeItem('__cap'); } catch {} });
}

// A full-screen title/summary slide (plain HTML, no app involved).
export async function slide(page, { title, lines = [], foot = '' }, ms = 4000) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;
    padding:0 90px;background:linear-gradient(135deg,#102a3f,#1a3a52);color:#f5f7f8;font-family:system-ui,sans-serif">
    <div style="font:600 14px system-ui;letter-spacing:.14em;text-transform:uppercase;color:#8ab4c4;margin-bottom:14px">Booking platform · walkthrough</div>
    <h1 style="font:600 46px/1.15 Georgia,serif;margin:0 0 26px">${title}</h1>
    <ul style="margin:0;padding:0;list-style:none;font-size:22px;line-height:1.7">${lines.map((l) => `<li style="margin:4px 0">${l}</li>`).join('')}</ul>
    <div style="margin-top:34px;color:#8ab4c4;font-size:16px">${foot}</div></body>`;
  await page.setContent(html);
  await page.waitForTimeout(ms);
}
