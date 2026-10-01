// Records the walkthrough video of what was built on 2026-10-01 and 2026-10-02 (docs/demo/README.md).
// A browser (Playwright) drives the real dashboard and customer pages against demo data; captions
// explain each step. Run:  npm run demo:record
//
// Needs: the backend (npm run dev or start) and the dashboard (npm run build && npm start in dashboard/)
// running against the SAME MongoDB as this script (MONGODB_URI / MONGODB_DB_NAME), and Playwright's
// browser and ffmpeg (npx playwright install chromium ffmpeg, unless already cached).
// The demo businesses are created at the start and removed at the end.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { startBrowser, go, click, type, moveTo, pause, caption, login, logout, slide, openPhone, phoneGo, BASE } from './lib.mjs';
import { seedDemo, cleanupDemo, DEMO, DEMO_PASSWORD } from './seedDemo.mjs';
import { client } from '../../src/db.js';

const OUT_DIR = path.resolve('docs/demo');
const OUT = path.join(OUT_DIR, process.env.DEMO_VIDEO_NAME || 'walkthrough-2026-10-02.webm');
const TMP = path.join(OUT_DIR, '.tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const demo = await seedDemo();
const { browser, context, page } = await startBrowser({ videoDir: TMP });
const cap = (t) => caption(page, t);
const failures = [];
// DEMO_ONLY="booking,portal" records just those scenes (for fixing one scene without a 6 minute run).
const ONLY = process.env.DEMO_ONLY?.split(',').map((x) => x.trim());
const FAIL_DIR = path.resolve('scratch-demo');

async function scene(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  console.log(`scene: ${name}`);
  try {
    await fn();
  } catch (err) {
    failures.push(`${name}: ${err.message.split('\n')[0]}`);
    console.error(`  FAILED ${name}: ${err.message.split('\n')[0]}`);
    fs.mkdirSync(FAIL_DIR, { recursive: true });
    await page.screenshot({ path: path.join(FAIL_DIR, `failed-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
  }
}
const choose = async (locator, value) => { await moveTo(page, locator); await locator.selectOption(value); await pause(page, 800); };
const tomorrow = DateTime.now().setZone('America/New_York').plus({ days: 1 }).toISODate();
const inFiveDays = DateTime.now().setZone('America/New_York').plus({ days: 5 }).toISODate();

try {
  // ------------------------------------------------------------------------------------------ intro
  await go(page, '/find', { wait: 300 });
  if (!ONLY) await slide(page, {
    title: 'What was built: customers, reliability and a clearer dashboard',
    lines: [
      '1. Customers find a business and book online, with no phone call',
      '2. Customers sign in to see and change their own appointments',
      '3. Staff tools: duplicate customers, branch booking, honest message status',
      '4. Reliability fixes for calls, reminders, bookings and recordings',
      '5. A new look for the dashboard: simpler words, accessible, works on phones',
    ],
    foot: 'Recorded on a demo copy with test data · 2 October 2026',
  }, 6500);

  // ------------------------------------------------------------------------------- 1. directory
  await scene('directory', async () => {
    await go(page, '/find', { wait: 1500 });
    await cap('Part 1: a customer with no link searches the public directory');
    await pause(page, 2200);
    await type(page, page.locator('#q'), 'Glow', { delay: 110 });
    await pause(page, 1800);
    await cap('Two studios with the same name are told apart by city and street address');
    await pause(page, 3800);
    await page.locator('#q').fill('');
    await pause(page, 600);
    await choose(page.locator('#cat'), 'dentist');
    await cap('Filter by type of business');
    await pause(page, 2400);
    await choose(page.locator('#cat'), '');
    await type(page, page.locator('#q'), 'xyzzy', { delay: 110 });
    await cap('Nothing found? Clear the filters, or leave a request for the team');
    await pause(page, 3200);
    await click(page, page.getByRole('button', { name: 'Clear filters' }), { after: 1200 });
    await cap('Back to the full list. Now Glow Studio in Tampa');
    await type(page, page.locator('#q'), 'Glow Studio', { delay: 90 });
    await pause(page, 1500);
    await click(page, page.locator('.card').filter({ hasText: 'Bayshore Blvd' }).getByRole('button', { name: 'Book' }), { after: 2200 });
  });

  // ----------------------------------------------------------------------------- 2. booking wizard
  await scene('booking', async () => {
    await go(page, `/book/${DEMO.slug}`, { wait: 1500 });
    await cap('Part 2: every business has its own booking page, with its name and address on every screen');
    await pause(page, 3000);
    await cap('This business has two branches, so it asks where first');
    await click(page, page.getByRole('button', { name: /Downtown Branch/ }), { after: 1500 });
    await click(page, page.locator('button.choice', { hasText: 'Haircut' }), { after: 1500 });
    await cap('Only the stylists who work at that branch and do that service are offered');
    await pause(page, 3000);
    await click(page, page.locator('button.choice', { hasText: 'Sam' }), { after: 1500 });
    await cap('Pick a day and a time, shown in the business time zone');
    await moveTo(page, page.locator('#date'));
    await page.locator('#date').fill(tomorrow);
    await pause(page, 2200);
    await click(page, page.locator('button[aria-pressed]').nth(2), { after: 1200 });
    await click(page, page.getByRole('button', { name: 'Continue' }), { after: 1200 });
    await cap('Mistakes are caught as you type, with an example of what is expected');
    await type(page, page.getByLabel('Your name'), 'Layla Hassan');
    await type(page, page.getByLabel('Mobile number'), '555', { delay: 120 });
    await page.keyboard.press('Tab');
    await pause(page, 2600);
    await type(page, page.getByLabel('Mobile number'), '(555) 010-2024', { delay: 80 });
    await type(page, page.locator('input[type="email"]'), 'layla@', { delay: 90 });
    await page.keyboard.press('Tab');
    await pause(page, 2400);
    await type(page, page.locator('input[type="email"]'), 'layla@example.test', { delay: 70 });
    await click(page, page.getByRole('button', { name: 'Confirm booking' }), { after: 2500 });
    await cap('Done: a booking reference, Add to calendar, and directions to the branch');
    await moveTo(page, page.getByRole('button', { name: /Add to calendar/ }));
    await pause(page, 4200);
  });

  // ----------------------------------------------------------------------------- 3. customer portal
  await scene('portal', async () => {
    await go(page, `/my/${DEMO.slug}`, { wait: 1500 });
    await cap('Part 3: customers sign in with a code sent to their own phone. No password, no account to create');
    await pause(page, 3000);
    await type(page, page.locator('#who'), '(555) 010-0001', { delay: 90 });
    await click(page, page.getByRole('button', { name: 'Send me a code' }), { after: 1800 });
    await cap('No SMS provider is set up on this test server, so the page says so honestly');
    await pause(page, 3600);
    await cap('For the demo we continue as a signed-in customer');
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [`customer_token:${DEMO.slug}`, demo.saraToken]);
    await go(page, `/my/${DEMO.slug}`, { wait: 2200 });
    await cap('My appointments: upcoming and past, only this customer, only this business');
    await pause(page, 3200);
    await click(page, page.getByRole('button', { name: 'Reschedule' }).first(), { after: 1800 });
    await cap('Reschedule or cancel on their own, within the business rules');
    await pause(page, 3000);
    await click(page, page.getByRole('button', { name: 'Back' }).first(), { after: 800 });
    await choose(page.locator('#lang'), 'ur');
    await click(page, page.getByRole('button', { name: 'Save' }), { after: 1500 });
    await cap('Details, message preferences and language');
    await pause(page, 2200);
    await click(page, page.getByRole('button', { name: 'Ask to delete my data' }), { after: 1500 });
    await cap('Data rights: download or ask for deletion, with a clear confirmation');
    await pause(page, 3000);
    await click(page, page.getByRole('dialog').getByRole('button', { name: 'Cancel' }), { after: 800 });
  });

  // ----------------------------------------------------------------------------- 4. business dashboard
  await scene('dashboard', async () => {
    await logout(page);
    await cap('');
    await login(page, DEMO.owner, DEMO_PASSWORD);
    await cap('Part 4: the business owner has a separate login. Customers can never reach these pages');
    await pause(page, 3800);
    await go(page, '/bookings', { wait: 2200 });
    await cap('Bookings: where each one came from, and whether its confirmation message really went out');
    await pause(page, 4800);
    await go(page, '/calendar', { wait: 2500 });
    await cap('The calendar marks web and phone bookings');
    await pause(page, 3500);
    await go(page, '/customers', { wait: 2000 });
    await click(page, page.getByRole('link', { name: 'Sara Ahmed' }).first(), { after: 2200 });
    await cap('The same person on two phone numbers? The system suggests a merge');
    await pause(page, 3200);
    await click(page, page.getByRole('button', { name: /Merge into this customer/ }), { after: 1500 });
    await cap('A proper confirmation dialog explains what will happen');
    await pause(page, 3500);
    await click(page, page.getByRole('dialog').getByRole('button', { name: 'Merge' }), { after: 2000 });
    await cap('Bookings and calls now sit on one customer record');
    await pause(page, 3200);
  });

  // ----------------------------------------------------------------------------- 5. team time off
  await scene('time off', async () => {
    await go(page, '/team', { wait: 2200 });
    await cap('Adding time off on a day that already has bookings');
    await click(page, page.getByRole('row').filter({ hasText: 'Jessica' }).getByTitle('Schedule'), { after: 1800 });
    const dt = page.locator('input[type="datetime-local"]');
    await moveTo(page, dt.first());
    await dt.nth(0).fill(`${inFiveDays}T09:00`);
    await dt.nth(1).fill(`${inFiveDays}T17:00`);
    await pause(page, 900);
    await click(page, page.locator('form').filter({ has: dt.first() }).getByRole('button', { name: 'Add' }), { after: 1500 });
    await cap('It warns who is already booked, instead of silently double-booking');
    await pause(page, 4500);
    await click(page, page.getByRole('dialog').getByRole('button', { name: 'Cancel' }), { after: 800 });
  });

  // ----------------------------------------------------------------------------- 6. settings
  await scene('settings', async () => {
    await go(page, '/settings', { wait: 2200 });
    await cap('Part 5: the dashboard. Settings is split into tabs instead of one very long page');
    await pause(page, 3200);
    const tip = page.locator('.infotip-btn').first();
    await moveTo(page, tip);
    await tip.hover();
    await cap('A small ? explains each setting in plain words');
    await pause(page, 3800);
    await click(page, page.getByRole('tab', { name: 'Booking & hours' }), { after: 1800 });
    await cap('Your booking link, directory listing, opening hours and holidays');
    await pause(page, 3200);
    await click(page, page.getByRole('tab', { name: 'Calls & AI' }), { after: 1800 });
    await cap('Plain names: "What your AI should know" and "Call transfer"');
    await pause(page, 3000);
    await click(page, page.getByRole('tab', { name: 'Help' }), { after: 1800 });
    await cap('A glossary of every term, in everyday language');
    await pause(page, 3000);
  });

  await scene('needs attention', async () => {
    await go(page, '/exceptions', { wait: 2200 });
    await cap('"Needs attention": messages that could not be sent and other problems, in one list');
    await pause(page, 4200);
  });

  // ----------------------------------------------------------------------------- 7. phone
  await scene('phone', async () => {
    const phone = await openPhone(page, '/');
    await cap('Phones: a menu button, a slide-in menu, and tables that scroll inside their card');
    await pause(page, 2200);
    await click(page, phone.getByRole('button', { name: 'Open menu' }), { after: 1800 });
    await click(page, phone.getByRole('link', { name: 'Bookings' }), { after: 2800 });
    await pause(page, 1500);
    await phoneGo(page, '/settings');
    await cap('Settings tabs and forms also fit a phone screen');
    await pause(page, 3000);
  });

  // ----------------------------------------------------------------------------- 8. platform admin
  await scene('platform', async () => {
    await logout(page);
    await cap('');
    await login(page, DEMO.platform, DEMO_PASSWORD);
    await cap('Part 6: the platform team has its own console, for all companies');
    await pause(page, 3200);
    await go(page, '/platform/companies', { wait: 2000 });
    await type(page, page.locator('input[placeholder="Search..."]'), 'Glow', { delay: 100 });
    await pause(page, 1500);
    await click(page, page.getByRole('row').filter({ hasText: 'Glow Studio' }).filter({ hasText: '—' }).first(), { after: 2400 });
    await cap('Moderation: hide a misleading listing from the public directory');
    await click(page, page.getByRole('button', { name: 'Hide from directory' }), { after: 2200 });
    await pause(page, 1800);
    await go(page, '/find', { wait: 1500 });
    await type(page, page.locator('#q'), 'Glow', { delay: 100 });
    await cap('Hidden: only one Glow Studio is left in search (its booking link still works)');
    await pause(page, 4000);
    await go(page, '/platform/leads', { wait: 2000 });
    await cap('Requests from customers who found nothing land here for the team');
    await pause(page, 3200);
  });

  // ----------------------------------------------------------------------------- 9. new owner
  await scene('new owner', async () => {
    await logout(page);
    await cap('');
    await go(page, '/signup', { wait: 1200 });
    await cap('Part 7: a new business signs up. Forms explain mistakes before the button is pressed');
    await type(page, page.getByLabel('Business name'), 'Sunrise Dental', { delay: 80 });
    await click(page, page.getByRole('button', { name: 'Continue' }), { after: 900 });
    await click(page, page.getByRole('button', { name: 'Continue' }), { after: 900 });
    await type(page, page.locator('input[type="email"]'), 'newbie', { delay: 100 });
    await type(page, page.locator('input[type="tel"]'), '123', { delay: 100 });
    await page.keyboard.press('Tab');
    await pause(page, 1500);
    await type(page, page.locator('input[type="password"]').first(), 'abc', { delay: 100 });
    await page.keyboard.press('Tab');
    await pause(page, 3800);
    await login(page, DEMO.newOwner, DEMO_PASSWORD);
    await cap('First login: a short tour of what to do and in what order');
    await pause(page, 3200);
    await click(page, page.getByRole('button', { name: 'Next' }), { after: 2200 });
    await click(page, page.getByRole('button', { name: 'Next' }), { after: 2200 });
    await click(page, page.getByRole('button', { name: 'Skip tour' }), { after: 1000 });
    await cap('Setup progress on the dashboard, and a step counter on the Setup guide menu item');
    await pause(page, 4500);
  });

  // ------------------------------------------------------------------------------------------ outro
  await go(page, '/find', { wait: 300 });
  if (!ONLY) await slide(page, {
    title: 'Under the hood: fixes you cannot see on screen',
    lines: [
      'Call recordings play through a short-lived link for that one recording',
      'Cancelled bookings can be rebooked; old slot locks clean themselves up',
      'Time off warns about booked customers; reminders are sent exactly once',
      'Dead phone lines hang up; restarts wait for live calls to finish',
      'If a call is cut by the server, its transcript and summary are still saved',
      'Message delivery (SMS / email) is recorded and shown, honestly',
    ],
    foot: 'Each of these has automated tests',
  }, 8500);
  if (!ONLY) await slide(page, {
    title: 'Checked automatically',
    lines: [
      '212 automated tests pass (bookings, voice, customers, portal, accessibility colours)',
      'GitHub runs the tests and a production build on every push',
      'Load test: 20 people on one slot, exactly 1 wins; 40 different slots, 40 of 40 booked',
      '38 browser checks for accessibility and phone layout; 12 screenshot comparisons',
      'Still needs a real SMS / email provider on the server to send codes and messages',
    ],
    foot: 'Docs: docs/GUI_DESIGN_REVIEW.md · docs/testing/TEST_CASES.md · docs/customer/',
  }, 8500);
} finally {
  const video = page.video();
  await context.close();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await video.saveAs(OUT);
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  await cleanupDemo();
  await client.close();
}

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`\nsaved ${path.relative('.', OUT)} (${mb} MB)`);
if (failures.length) { console.error(`\n${failures.length} scene(s) failed:\n  ${failures.join('\n  ')}`); process.exitCode = 1; }
