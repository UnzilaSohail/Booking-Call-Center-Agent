// GUI acceptance check (Jira 25 and 26): drives the real dashboard in a browser and asserts the
// accessibility and phone-layout behaviour the GUI plan promised. Seeds the demo businesses
// (scripts/demo/seedDemo.mjs) and removes them afterwards.
//
//   npm run gui:check     (backend and dashboard running, same MONGODB_URI / MONGODB_DB_NAME as the backend)
import 'dotenv/config';
import { startBrowser, go, login, logout } from './lib.mjs';
import { seedDemo, cleanupDemo, DEMO, DEMO_PASSWORD } from './seedDemo.mjs';
import { client } from '../../src/db.js';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };

// Form controls with no accessible name (no label, no aria-label).
const unnamed = (page) => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
  .filter((c) => !c.closest('label') && !(c.id && document.querySelector(`label[for="${c.id}"]`)) && !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby') && !c.getAttribute('aria-hidden'))
  .map((c) => `${c.tagName.toLowerCase()}${c.type ? `[${c.type}]` : ''}`));
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

await seedDemo();
const { browser, page } = await startBrowser({ overlay: false });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
// A blocked script, style or connection (Content-Security-Policy) is a real bug for the person using the page.
page.on('console', (m) => { if (/content security policy/i.test(m.text())) errors.push(`CSP: ${m.text().slice(0, 160)}`); });
try {
  await login(page, DEMO.owner, DEMO_PASSWORD);

  // ---- settings: tabs, tooltips, names ----
  await go(page, '/settings', { wait: 2000 });
  check('settings has five tabs', (await page.getByRole('tab').count()) === 5);
  check('skip link and main landmark', (await page.locator('a.skip-link').count()) === 1 && (await page.locator('main#main-content').count()) === 1);
  for (const tab of ['Business', 'Booking & hours', 'Calls & AI', 'Account & security', 'Help']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(1200);
    const bad = await unnamed(page);
    check(`settings > ${tab}: every field has a name`, bad.length === 0, bad.join(', '));
  }
  await page.getByRole('tab', { name: 'Calls & AI' }).click();
  await page.waitForTimeout(800);
  check('tab choice is kept in the address', page.url().endsWith('#calls'));
  await page.getByRole('tab', { name: 'Booking & hours' }).click();
  await page.locator('.infotip-btn').first().hover();
  check('? tooltip explains a term', await page.getByRole('tooltip').first().isVisible());

  // ---- dialog behaviour ----
  await go(page, '/customers', { wait: 1800 });
  await page.getByRole('link', { name: 'Sara Ahmed' }).first().click();
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: /merge into this customer/i }).click();
  await page.waitForTimeout(400);
  const dialog = page.getByRole('dialog');
  check('confirm opens as a modal dialog', (await dialog.isVisible()) && (await dialog.getAttribute('aria-modal')) === 'true');
  check('focus moves into the dialog', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')));
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  check('Tab stays inside the dialog', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape closes it', (await page.getByRole('dialog').count()) === 0);
  check('focus returns to the button that opened it', await page.evaluate(() => /merge/i.test(document.activeElement?.textContent ?? '')));

  // ---- plain-language names and delivery columns ----
  for (const name of ['Needs attention', 'Setup guide', 'Activity history']) {
    check(`sidebar says "${name}"`, (await page.getByRole('link', { name: new RegExp(name) }).count()) > 0);
  }
  await go(page, '/bookings', { wait: 2000 });
  check('Bookings shows "Booked via" and the delivery status of confirmations', (await page.getByText('Booked via').count()) > 0 && (await page.getByText(/SMS (sent|failed|not sent)/).count()) > 0);

  // ---- phone width: no sideways scroll, menu works ----
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/bookings', '/customers', '/team', '/calls', '/settings', '/services']) {
    await go(page, path, { wait: 1800 });
    const extra = await sideways(page);
    check(`phone: ${path} does not scroll sideways`, extra <= 1, `${extra}px too wide`);
  }
  // public pages on a small phone (360 wide): a visitor must never have to scroll sideways
  await page.setViewportSize({ width: 360, height: 740 });
  await logout(page);
  for (const path of ['/find', '/login', '/signup', `/book/${DEMO.slug}`, '/my/' + DEMO.slug]) {
    await go(page, path, { wait: 1800 });
    const extra = await sideways(page);
    check(`phone 360: ${path} does not scroll sideways`, extra <= 1, `${extra}px too wide`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO.owner, DEMO_PASSWORD);
  await go(page, '/', { wait: 1500 });
  check('phone: sidebar is hidden until the menu is opened', !(await page.locator('aside.sidebar').isVisible()));
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForTimeout(500);
  check('phone: menu button opens the sidebar', await page.locator('aside.sidebar').isVisible());
  await page.locator('.sidebar-backdrop').click({ position: { x: 380, y: 400 } });
  await page.waitForTimeout(500);
  check('phone: tapping outside closes it', !(await page.locator('aside.sidebar').isVisible()));
  await page.setViewportSize({ width: 1280, height: 720 });

  // ---- first-run tour and setup progress ----
  await logout(page);
  await login(page, DEMO.newOwner, DEMO_PASSWORD);
  await page.waitForTimeout(2200);
  check('first visit opens the tour', await page.getByRole('dialog').isVisible());
  await page.getByRole('button', { name: 'Next' }).click();
  check('tour moves to the next step', await page.getByRole('heading', { name: '1. Add your services' }).isVisible());
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await page.waitForTimeout(400);
  check('"Finish setting up" card shows progress', await page.getByRole('heading', { name: 'Finish setting up' }).isVisible() && (await page.getByRole('progressbar').count()) === 1);
  check('sidebar Setup guide shows the step count', /\d\/9/.test(await page.locator('.sidebar-link .count').first().textContent()));
  await page.reload();
  await page.waitForTimeout(2000);
  check('the tour does not open again on the next visit', (await page.getByRole('dialog').count()) === 0);

  // ---- customer pages ----
  await logout(page);
  await go(page, `/book/${DEMO.slug}`, { wait: 1800 });
  check('booking page asks for a location first when there are two', await page.getByText('Which location?').isVisible());
  await page.getByRole('button', { name: /Bayshore Branch/ }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.waitForTimeout(1200);
  const names = await page.locator('button.choice').allTextContents();
  check('stylist list is limited to that branch', names.some((n) => /Jessica/.test(n)) && !names.some((n) => /Sam/.test(n)), names.join(' | '));
  await go(page, '/find', { wait: 1800 });
  check('find page counts the results', await page.getByText(/businesses? found/).isVisible());
  await go(page, `/my/${DEMO.slug}`, { wait: 1500 });
  check('portal sign-in page is a labelled form', (await unnamed(page)).length === 0);
} finally {
  await browser.close();
  await cleanupDemo();
  await client.close();
}

check('no JavaScript errors on any page', errors.length === 0, errors.join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `  [${r.detail}]` : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
