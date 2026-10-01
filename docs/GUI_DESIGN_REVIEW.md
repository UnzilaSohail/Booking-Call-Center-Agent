# GUI review and what changed (Jira 24 to 26)

Written 2026-10-02 after the GUI plan (`docs/plans/PLAN_3_GUI.md`) was built. It lists what was wrong, what was done, and how it is checked, so the next change does not undo it.
Stack decision stays as planned: plain CSS tokens in `dashboard/app/globals.css`, no Tailwind or component-library migration.

## 1. Findings and fixes

| Area | Problem found | What was done | Jira |
|---|---|---|---|
| Loading | More than 30 places showed a bare "Loading..." | `components/Skeleton.jsx` (`<Loading />`): shimmer placeholder, announced to screen readers, stops animating for "reduce motion" | 24d |
| Empty pages | A sentence and nothing to do | `components/EmptyState.jsx` gives the next step as a button: add a service / team member, import customers, create a booking, set up the phone number, clear filters | 24e |
| Native `confirm()` | Ugly, not keyboard friendly, no clear danger button | `lib/confirm.jsx` (`useConfirm()`): same one-line call, styled dialog, red button for destructive actions. Used for delete service, remove or suspend staff, merge customers, time-off clashes, delete my data | 24f |
| Forms | Mistakes found only after submit | `components/TextField.jsx` + `lib/validate.js`: hint under the field, inline message after leaving it, examples in the message. Used on signup, the booking page, the New booking window and the customer portal | 24g |
| Settings | 12 sections in one long scroll | Five tabs (Business, Booking and hours, Calls and AI, Account and security, Help). The tab is in the address (`#calls`), arrow keys move between tabs | 25a |
| Jargon | "Exceptions", "Audit log", "Onboarding", "Transfer departments", "Knowledge base", raw permission names, "nulls out ... retentionWorker.js" | Needs attention, Activity history, Setup guide, Call transfer: who answers what, What your AI should know, Bookings and calendar / Customers ..., plain sentences | 25b |
| Help text | Terms like buffer, cutoff, retention unexplained | `lib/glossary.js` + `components/InfoTip.jsx`: a "?" next to the field (hover, focus or tap), and the same list on Settings > Help | 25c |
| Labels | 110 labels, 21 connected to their input | `components/A11yLabels.jsx` connects every `<label>` to its field by id (and on pages that change later); the new components use `htmlFor` directly; time, FAQ and pronunciation inputs got `aria-label`s. Checked: 0 unnamed fields on the Settings tabs | 25d |
| Contrast, focus | Faint text about 3:1, no skip link | Tokens darkened (`--text-faint`, badge text, toast fills); `test/contrast.test.js` fails if a token pair drops under 4.5:1. Visible focus ring everywhere (white on the dark sidebar). "Skip to main content" link and a real `<main>` on every page | 25f |
| Dialogs | BookingModal had no dialog role or focus handling | `components/Modal.jsx`: `role="dialog"`, `aria-modal`, labelled by its title, focus moves in, Tab stays inside, Escape closes, focus returns to the button that opened it. Used by every dialog | 25g |
| Tables on phones | Wide tables pushed the page sideways | A card holding a table scrolls inside itself (`.card:has(table)`) | 25h |
| Forms on phones | Rows of fields overflowed | Fields in a row stack to full width under 640px, controls at least 40px tall | 25i |
| Sidebar on phones | A cramped horizontal strip | A top bar with a menu button; the sidebar slides in over a dim backdrop and is hidden from keyboards while closed (`components/MobileBar.jsx`) | 25j |
| First run | New owners saw an empty dashboard | Overview "Finish setting up" card with progress and the next step, a step counter on the sidebar "Setup guide" link, and a four-step tour shown once on the first visit (`components/SetupProgress.jsx`, `components/Tour.jsx`) | 26a, 26b |

## 2. Customer pages review (`/find`, `/book/<slug>`, confirmation)

What a first-time customer sees was reviewed as a stranger would see it: do I know where I am, what to press, and what happens next?

| Page | Finding | Change | Jira |
|---|---|---|---|
| `/find` | Plain heading, "Loading..." text, no sense of how many results, dead end after a failed search | Hero heading; three skeleton cards while loading; "N businesses found" line (announced politely); "Clear filters" button when nothing matches; the Book button names the business for screen readers | 26c |
| `/book/<slug>` | Easy to lose track of the step; small tap targets; choices not remembered on screen | Segmented step bar; 48px choice buttons; chips that recap service, stylist and time; one question per screen with a heading; time buttons say which is selected; inline validation | 26d |
| Confirmation | A sentence in green | A success mark, the appointment in a card, the booking reference shown big, **Add to calendar** (downloads an .ics file), **Get directions** (opens a map search for the branch address), then Change or cancel and See all my appointments | 26e |

## 3. How it is checked

- `test/contrast.test.js` (21 checks) reads the real CSS tokens and enforces WCAG AA text contrast.
- `npm run screenshots` takes 12 pictures (six public pages at desktop and phone width) and compares them with `docs/screenshots/baseline`; a change you did not intend fails with a highlighted diff in `docs/screenshots/diff`. After an intended design change run `npm run screenshots:update` and commit the new baseline. (Jira 26f)
- The walkthrough video (`docs/demo`, `npm run demo:record`) drives the same screens end to end.
- Browser checks done on 2026-10-02: five Settings tabs and the address hash, tooltip, dialog role and focus trap (Tab three times stays inside, Escape closes), plain sidebar labels, "Needs attention" and "Activity history", mobile menu opens and closes, new-owner tour and setup card, location picker.

## 4. Known limits

- The label fix is a script that links labels after the page renders. It works for every form but the clean long-term fix is `htmlFor` in the source, which new forms should use (`TextField` does).
- Dashboard pages other than Settings, Bookings, Customers, Team, Calls, Services and Overview keep their previous layout.
- Language: the dashboard and customer pages are English only.
