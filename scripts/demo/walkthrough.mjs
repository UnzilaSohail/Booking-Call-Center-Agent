// The sales walkthrough (~10 minutes, English captions): the whole product from the customer's first click to the
// platform console, in the new design, on demo data. For the boss and for prospective clients.
//   npm run demo:walkthrough
//
// Needs the backend and the dashboard running against the SAME MongoDB as this script (see docs/demo/README.md),
// and Playwright's browser + ffmpeg. The demo businesses are created at the start and removed at the end.
// DEMO_ONLY="booking,calls" records only those scenes (to fix one scene without a 10 minute run).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { startBrowser, go, click, type, moveTo, pause, caption, login, logout, slide, openPhone, phoneGo } from './lib.mjs';
import { seedDemo, cleanupDemo, DEMO, DEMO_PASSWORD } from './seedDemo.mjs';
import { client } from '../../src/db.js';

const OUT_DIR = path.resolve('docs/demo');
const OUT = path.join(OUT_DIR, process.env.DEMO_VIDEO_NAME || 'walkthrough-full.webm');
const TMP = path.join(OUT_DIR, '.tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const demo = await seedDemo();
const { browser, context, page } = await startBrowser({ videoDir: TMP });
const cap = (t) => caption(page, t);
const failures = [];
const ONLY = process.env.DEMO_ONLY?.split(',').map((x) => x.trim());
const FAIL_DIR = path.resolve('scratch-demo');
const inFiveDays = DateTime.now().setZone('America/New_York').plus({ days: 5 }).toISODate();

async function scene(name, fn) {
  if (ONLY && !ONLY.includes(name)) return;
  console.log(`scene: ${name}`);
  try { await fn(); } catch (err) {
    failures.push(`${name}: ${err.message.split('\n')[0]}`);
    console.error(`  FAILED ${name}: ${err.message.split('\n')[0]}`);
    fs.mkdirSync(FAIL_DIR, { recursive: true });
    await page.screenshot({ path: path.join(FAIL_DIR, `failed-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
  }
}
const choose = async (locator, value) => { await moveTo(page, locator); await locator.selectOption(value); await pause(page, 800); };
const scrollDown = async (y = 520, wait = 1600) => { await page.mouse.move(760, 420); await page.mouse.wheel(0, y); await pause(page, wait); };
const toggleTheme = () => click(page, page.locator('button.theme-toggle').first(), { after: 1500 });

try {
  // ------------------------------------------------------------------------------------------ intro
  await go(page, '/find', { wait: 300 });
  if (!ONLY) {
    await slide(page, {
      title: 'An AI receptionist that answers every call and keeps your calendar full',
      lines: ['Customers phone, or book online. Bookings land in your calendar by themselves.', 'No missed calls. No double bookings. No front-desk staff needed after hours.'],
      foot: 'Product walkthrough · about 10 minutes · all data shown here is demo data',
    }, 7000);
    await slide(page, {
      kicker: 'What you will see',
      title: 'From a customer’s first click to the platform console',
      lines: ['1. The customer: find a business, book in under a minute, manage the appointment', '2. The AI receptionist: a phone call becomes a booking, with a written summary', '3. The business owner: calendar, customers, calls, billing, settings',
        '   plus reminders customers can answer, a waiting list, review requests and no-show tracking', '4. The platform team: every company in one console, with moderation', '5. A new business signing up, and why this is safe to rely on'],
    }, 8000);
  }

  // ------------------------------------------------------------------------------ 1. customer: find
  await scene('find', async () => {
    await go(page, '/find', { wait: 1800 });
    await cap('Part 1: the customer. They open one page and search for what they need, no account, no app');
    await pause(page, 4200);
    await type(page, page.locator('#q'), 'Glow', { delay: 110 });
    await cap('Two studios with the same name are told apart by city and street address');
    await pause(page, 4200);
    await page.locator('#q').fill('');
    await click(page, page.getByRole('button', { name: /^Dentist/ }), { after: 1500 });
    await cap('Quick filters by type of business, and a "Near me" button that sorts by distance');
    await pause(page, 3800);
    await click(page, page.getByRole('button', { name: /^All/ }), { after: 800 });
    await cap('Light or dark: the whole product has both, and remembers the choice');
    await toggleTheme();
    await pause(page, 3000);
    await toggleTheme();
    await type(page, page.locator('#q'), 'xyzzy', { delay: 110 });
    await cap('Nothing found? The customer can leave a request, and it reaches the platform team as a lead');
    await pause(page, 4200);
    await click(page, page.getByRole('button', { name: 'Clear filters' }), { after: 1000 });
    await type(page, page.locator('#q'), 'Glow Studio', { delay: 90 });
    await pause(page, 1600);
    await click(page, page.locator('.card').filter({ hasText: 'Bayshore Blvd' }).getByRole('button', { name: 'Book' }), { after: 2200 });
  });

  // ------------------------------------------------------------------------------ 2. customer: book
  await scene('booking', async () => {
    await go(page, `/book/${DEMO.slug}`, { wait: 1800 });
    await cap('Every business has its own booking page. Its name and address stay on screen, so nobody books the wrong place');
    await pause(page, 4500);
    await cap('This business has two branches, so it asks where first');
    await click(page, page.getByRole('button', { name: /Downtown Branch/ }), { after: 1600 });
    await cap('Services with duration and price, and a live summary on the right');
    await click(page, page.locator('button.choice', { hasText: 'Haircut' }), { after: 1600 });
    await cap('Only stylists who work at that branch and do that service are offered');
    await pause(page, 3500);
    await click(page, page.locator('button.choice', { hasText: 'Sam' }), { after: 1600 });
    await cap('Pick a day from the next two weeks, then a time, grouped as morning, afternoon and evening');
    await click(page, page.locator('.date-pill').nth(1), { after: 1500 });
    await pause(page, 1800);
    await click(page, page.locator('.slot-btn').nth(1), { after: 1200 });
    await click(page, page.getByRole('button', { name: 'Continue' }), { after: 1200 });
    await cap('Mistakes are caught as you type, with an example of what is expected');
    await type(page, page.getByLabel('Your name'), 'Layla Hassan');
    await type(page, page.getByLabel('Mobile number'), '555', { delay: 120 });
    await page.keyboard.press('Tab');
    await pause(page, 2800);
    await type(page, page.getByLabel('Mobile number'), '(555) 010-2024', { delay: 80 });
    await type(page, page.locator('input[type="email"]'), 'layla@example.test', { delay: 60 });
    await click(page, page.getByRole('button', { name: 'Confirm booking' }), { after: 2800 });
    await cap('Booked. A reference code, Add to calendar, directions, and a confirmation text. All in about a minute');
    await moveTo(page, page.getByRole('button', { name: /Add to calendar/ }));
    await pause(page, 6000);
  });

  // ------------------------------------------------------------------------------ 3. customer: portal
  await scene('portal', async () => {
    await go(page, `/my/${DEMO.slug}`, { wait: 1800 });
    await cap('Customers manage their own appointments. They sign in with a code sent to their phone: no password to forget');
    await pause(page, 4500);
    await type(page, page.locator('#who'), '(555) 010-0001', { delay: 90 });
    await click(page, page.getByRole('button', { name: 'Send me a code' }), { after: 1800 });
    await cap('This demo server has no SMS provider yet, so the page says so honestly. We continue as a signed-in customer');
    await pause(page, 4200);
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [`customer_token:${DEMO.slug}`, demo.saraToken]);
    await go(page, `/my/${DEMO.slug}`, { wait: 2200 });
    await cap('Upcoming and past appointments. Only this customer, only this business');
    await pause(page, 4000);
    await click(page, page.getByRole('button', { name: 'Reschedule' }).first(), { after: 1800 });
    await cap('Reschedule or cancel on their own, within the business’s rules. Fewer no-shows, fewer phone calls');
    await pause(page, 4000);
    await click(page, page.getByRole('button', { name: 'Back' }).first(), { after: 800 });
    await cap('Language, message preferences, and data rights: download everything, or ask for deletion');
    await pause(page, 4500);
  });

  // ------------------------------------------------------------------------------ 4. the AI receptionist
  await scene('ai call', async () => {
    await logout(page);
    await cap('');
    await go(page, '/login', { wait: 1200 });
    await slide(page, {
      kicker: 'Part 2: the AI receptionist',
      title: 'When a customer phones, the AI answers',
      lines: ['It greets the caller in the business’s name', 'It checks real availability, offers times and books the appointment', 'It sends a confirmation text, and writes a summary of the call', 'Anything it cannot handle is transferred to a person, or logged for a call back'],
    }, 9000);
    await go(page, '/login', { wait: 800 });
    await cap('A call, as the owner would imagine it: the conversation becomes a booking, with nobody at the desk');
    await pause(page, 9500);
  });

  // ------------------------------------------------------------------------------ 5. owner dashboard
  await scene('overview', async () => {
    await login(page, DEMO.owner, DEMO_PASSWORD);
    await cap('Part 3: the business owner. A separate login. Customers can never reach these pages');
    await pause(page, 3000);
    await cap('Overview: the AI receptionist’s status, calls answered, bookings it made, and how many calls turned into bookings');
    await pause(page, 6500);
    await cap('Today, this week, revenue, and the value of bookings the AI made on its own');
    await scrollDown(380, 5500);
    await cap('Two cards owners love: the money the AI earned while the business was closed, and customers who cancelled in time after a reminder');
    await pause(page, 7500);
    await cap('Bookings and cancellations over time, and what happens to every call');
    await scrollDown(520, 6000);
    await cap('Top services, team performance, and what is coming up');
    await scrollDown(620, 5500);
  });

  await scene('calls', async () => {
    await go(page, '/calls', { wait: 2200 });
    await cap('Calls: every call the AI handled, what the caller wanted, and whether it ended in a booking');
    await pause(page, 4500);
    await click(page, page.locator('tbody tr').filter({ hasText: 'details' }).first(), { after: 1800 });
    await cap('A written summary and the full conversation. Staff can read it in seconds instead of listening to the recording');
    await scrollDown(260, 8000);
  });

  await scene('reminders', async () => {
    await go(page, '/find', { wait: 300 });
    await slide(page, {
      kicker: 'Fewer no-shows',
      title: 'Reminders customers can answer',
      lines: [
        '24 hours before: "Reminder: your Haircut at Glow Studio is tomorrow, 2:30 PM. Reply C to cancel, or change it here: ..."',
        '2 hours before: the same, "in about 2 hours"',
        'The customer replies C: the visit is cancelled and the time is free for someone else',
        'If someone is on the waiting list, they are texted the moment a time opens up',
        'After the visit: one text asking for a Google review, and an invitation to book again',
      ],
      foot: 'Texts respect STOP and are never sent between 9pm and 8am',
    }, 15000);
  });

  await scene('calendar', async () => {
    await go(page, '/calendar', { wait: 2500 });
    await cap('The calendar, colour-coded by team member. Bookings from phone, web and staff all land here');
    await pause(page, 5500);
    await go(page, '/bookings', { wait: 2200 });
    await cap('Bookings: where each one came from, and whether its confirmation message really went out');
    await pause(page, 4500);
    await type(page, page.getByPlaceholder(/Search name, phone or email/), 'Sara', { delay: 120 });
    await cap('Someone phones asking about their appointment? Find it by name, number or email');
    await pause(page, 4500);
    await page.getByPlaceholder(/Search name, phone or email/).fill('');
    await pause(page, 1500);
    await cap('Full day? Customers join a waiting list, and the first in line are texted when someone cancels');
    await page.mouse.move(760, 420);
    await page.mouse.wheel(0, 99999);
    await pause(page, 6500);
    // past visits come after the upcoming ones: reveal more rows until one has the button
    for (let i = 0; i < 6 && !(await page.getByRole('button', { name: 'Mark no-show' }).count()); i++) {
      await page.getByRole('button', { name: 'Show more' }).click().catch(() => {});
      await pause(page, 500);
    }
    const noShow = page.getByRole('button', { name: 'Mark no-show' }).first();
    if (await noShow.count()) {
      await cap('After a visit, one click records a no-show. Overview and the monthly report then show the real no-show rate');
      await click(page, noShow, { after: 2500 });
      await pause(page, 3500);
    }
  });

  await scene('customers', async () => {
    await go(page, '/customers', { wait: 2000 });
    await cap('Customers are built automatically from every call and booking, with tags such as VIP and notes');
    await pause(page, 4500);
    await click(page, page.getByRole('link', { name: 'Sara Ahmed' }).first(), { after: 2200 });
    await cap('The same person on two phone numbers? The system spots it and offers to merge');
    await pause(page, 3800);
    await click(page, page.getByRole('button', { name: /Merge into this customer/ }), { after: 1500 });
    await cap('A clear confirmation says what will happen before anything changes');
    await pause(page, 3500);
    await click(page, page.getByRole('dialog').getByRole('button', { name: 'Merge' }), { after: 2000 });
    await cap('Bookings and calls now sit on one customer record');
    await pause(page, 3500);
  });

  await scene('team', async () => {
    await go(page, '/team', { wait: 2200 });
    await cap('Team: staff, their services and time off. Adding time off on a day that already has bookings…');
    await click(page, page.getByRole('row').filter({ hasText: 'Jessica' }).getByTitle('Schedule'), { after: 1800 });
    const dt = page.locator('input[type="datetime-local"]');
    await moveTo(page, dt.first());
    await dt.nth(0).fill(`${inFiveDays}T09:00`);
    await dt.nth(1).fill(`${inFiveDays}T17:00`);
    await pause(page, 900);
    await click(page, page.locator('form').filter({ has: dt.first() }).getByRole('button', { name: 'Add' }), { after: 1500 });
    await cap('…warns who is already booked, instead of silently double-booking');
    await pause(page, 5000);
    await click(page, page.getByRole('dialog').getByRole('button', { name: 'Cancel' }), { after: 800 });
    await go(page, '/services', { wait: 2000 });
    await cap('Services: name, length, price. The AI and the booking page both use this list');
    await pause(page, 4000);
  });

  await scene('billing', async () => {
    await go(page, '/billing', { wait: 2200 });
    await cap('Billing: plan, voice minutes and texts used this period, estimated bill, and invoice history');
    await pause(page, 6500);
  });

  await scene('settings', async () => {
    await go(page, '/settings', { wait: 2200 });
    await cap('Settings is split into tabs, with a small ? that explains each setting in plain words');
    const tip = page.locator('.infotip-btn').first();
    await moveTo(page, tip);
    await tip.hover();
    await pause(page, 4000);
    await page.mouse.move(760, 420);
    await page.mouse.wheel(0, 99999);
    await cap('Paste the Google review link: customers get one polite text after each visit. And a monthly report email arrives on the 1st');
    await pause(page, 8000);
    await page.mouse.wheel(0, -99999);
    await pause(page, 800);
    await click(page, page.getByRole('tab', { name: 'Booking & hours' }), { after: 1800 });
    await cap('The booking link to share, the public directory listing, opening hours and holidays');
    await pause(page, 4000);
    await click(page, page.getByRole('tab', { name: 'Calls & AI' }), { after: 1800 });
    await cap('"What your AI should know": questions and answers it uses on the phone. And when to transfer to a person');
    await pause(page, 4500);
    await go(page, '/exceptions', { wait: 2200 });
    await cap('"Needs attention": a message that could not be sent, a failed booking, a callback request. Nothing gets lost');
    await pause(page, 5500);
  });

  await scene('dark', async () => {
    await go(page, '/', { wait: 1800 });
    await cap('Everything also works in dark mode');
    await toggleTheme();
    await pause(page, 5000);
  });

  await scene('phone', async () => {
    const phone = await openPhone(page, '/');
    await cap('And on a phone: a menu button, a slide-in menu, and tables that scroll inside their card');
    await pause(page, 2600);
    await click(page, phone.getByRole('button', { name: 'Open menu' }), { after: 1800 });
    await click(page, phone.getByRole('link', { name: 'Bookings' }), { after: 2800 });
    await pause(page, 1500);
    await phoneGo(page, '/settings');
    await cap('Settings and forms fit a phone screen too');
    await pause(page, 3500);
  });

  // ------------------------------------------------------------------------------ 6. platform
  await scene('platform', async () => {
    await logout(page);
    await cap('');
    await login(page, DEMO.platform, DEMO_PASSWORD);
    await cap('Part 4: the platform team. One console for every company that uses the product');
    await pause(page, 4000);
    await cap('At the top: what the product delivered to all clients in 30 days, added up. The proof of value');
    await pause(page, 6500);
    await scrollDown(520, 4500);
    await cap('Demo data: one button adds a realistic demo business, one button removes it all. Real clients are never touched');
    await scrollDown(700, 6500);
    await go(page, '/platform/companies', { wait: 2000 });
    await cap('Every company, with its status and upcoming bookings');
    await type(page, page.locator('input[placeholder="Search..."]'), 'Glow', { delay: 100 });
    await pause(page, 2500);
    await click(page, page.getByRole('row').filter({ hasText: 'Glow Studio' }).filter({ hasText: '—' }).first(), { after: 2400 });
    await cap('Moderation: hide a misleading listing from the public directory with one click');
    await click(page, page.getByRole('button', { name: 'Hide from directory' }), { after: 2200 });
    await pause(page, 1800);
    await go(page, '/find', { wait: 1500 });
    await type(page, page.locator('#q'), 'Glow', { delay: 100 });
    await cap('Hidden: only one Glow Studio is left in search. Its booking link still works');
    await pause(page, 4500);
    await go(page, '/platform/leads', { wait: 2000 });
    await cap('Requests from customers who found nothing land here: free leads for the platform team');
    await pause(page, 4500);
  });

  // ------------------------------------------------------------------------------ 7. new business
  await scene('new owner', async () => {
    await logout(page);
    await cap('');
    await go(page, '/signup', { wait: 1500 });
    await cap('Part 5: a new business signs up. The form explains mistakes before the button is pressed');
    await type(page, page.getByLabel('Business name'), 'Sunrise Dental', { delay: 80 });
    await click(page, page.getByRole('button', { name: 'Continue' }), { after: 900 });
    await click(page, page.getByRole('button', { name: 'Continue' }), { after: 900 });
    await type(page, page.locator('input[type="email"]'), 'newbie', { delay: 100 });
    await type(page, page.locator('input[type="tel"]'), '123', { delay: 100 });
    await page.keyboard.press('Tab');
    await pause(page, 1500);
    await type(page, page.locator('input[type="password"]').first(), 'abc', { delay: 100 });
    await page.keyboard.press('Tab');
    await pause(page, 4000);
    await login(page, DEMO.newOwner, DEMO_PASSWORD);
    await cap('First login: a short tour of what to do, and in what order');
    await pause(page, 3500);
    await click(page, page.getByRole('button', { name: 'Next' }), { after: 2200 });
    await click(page, page.getByRole('button', { name: 'Next' }), { after: 2200 });
    await click(page, page.getByRole('button', { name: 'Skip tour' }), { after: 1000 });
    await cap('A setup checklist guides the owner: services, hours, phone number, a test call, then go live');
    await pause(page, 6000);
  });

  // ------------------------------------------------------------------------------ outro
  await go(page, '/find', { wait: 300 });
  if (!ONLY) {
    await slide(page, {
      kicker: 'Built to be trusted',
      title: 'Reliability you do not see, but depend on',
      lines: ['Two people can never book the same slot: 20 tried at once, exactly 1 won', 'Reminders go out exactly once; cancelled slots free up by themselves', 'If a call is cut by the server, its transcript and summary are still saved', 'Restarts wait for live calls to finish; call recordings play through short-lived private links', 'Every text and email is tracked, and failures show up under "Needs attention"'],
      foot: '287 automated tests · browser checks for phones and accessibility · every push is tested on GitHub',
    }, 11000);
    await slide(page, {
      kicker: 'Why it sells',
      title: 'Every missed call is a lost customer. This answers all of them.',
      lines: ['Works 24/7: nights, weekends, lunch rushes', 'Customers book themselves online too, from one link or QR code', 'Owners see everything in one clean dashboard, on any device', 'Ready to demo today: add the demo data with one button, remove it with one click'],
      foot: 'Next: connect a real phone number, SMS/email provider and payments, then onboard the first client',
    }, 10000);
  }
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
