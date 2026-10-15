# Booking dashboard: UI review (2026-10-15, Jira 56l / AIN-548)

Checked in a real browser (Next.js 16.4.1 production build, a seeded business, phone width 375 px and desktop). It is a
measured pass, not a design critique: what a script can see on each page, plus a look at the screenshots.

## Pages checked

Login, Overview, Calendar, Customers, Team, Settings (all five tabs), Find. Not checked: `/book/<slug>`, `/my/<slug>` and
the platform console, because they need a public listing and a signed-in customer or platform admin; do them next with the demo
data (`npm run demo:seed`).

## What was measured at 375 px wide

| Page | Page scrolls sideways | Touch targets under 32 px | Text under 11 px | Controls with no name |
|---|---|---|---|---|
| Login | no | 2 | 0 | 0 |
| Overview | no | 3 | 3 | 0 |
| Calendar | no | 0 | 10 | 0 |
| Customers | no | 0 | 3 | 1 (the search box) |
| Team | no (the table scrolls inside its box) | 0 | 7 | 0 |
| Find | no | 3 | 0 | 0 |

Good: no page scrolls sideways on a phone, every image has alt text, every icon-only button has a name, and the five Settings
tabs show all of their sections with no console errors.

## Fixes to make, most useful first

1. **Customers search box has no label** (screen readers announce just "edit text"). Fixed in this change (`aria-label`).
2. **Text under 11 px**: 10 pieces on the Calendar, 7 on Team, 3 each on Overview and Customers. Raise the small captions to 11-12 px (same fix as the SparkMind dashboards, AIN-538).
3. **Small touch targets** on Login (2), Overview (3) and Find (3): give links and icon buttons a 36 px minimum height on phones.
4. **Team table on a phone** scrolls sideways inside its box; a card per person would read better below 600 px.
5. **First visit**: the product tour dims the whole Overview. Fine for a new account, but make sure "Skip" is reachable by keyboard first.

## Notes for whoever repeats this

* The pane's browser does not run `requestAnimationFrame`, so `components/A11yLabels.jsx` (which links form labels to their
  inputs using it) looked broken here: 0 of 19 labels linked. In a normal browser it runs. Do not trust "unlabeled input" counts
  from this pane; use a real browser for that check. Using a timer instead of `requestAnimationFrame` there would make it work everywhere.
* Colour contrast was not measured by script; `test/contrast.test.js` already covers the theme colours.
