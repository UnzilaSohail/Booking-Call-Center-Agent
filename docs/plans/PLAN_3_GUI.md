# PLAN 3 — GUI (plan only; "self-explanatory" UI)

**Status 2026-10-02: built** (Jira 24d to 26f). What changed, how it is checked and the limits: `docs/GUI_DESIGN_REVIEW.md`. The text below is the original plan.

Findings from the code review: single 378-line CSS with good tokens but only 2 breakpoints; ~17 plain "Loading..." texts; empty states have no call-to-action; Settings is 9 stacked sections with no navigation;
native `confirm()` dialogs; jargon (Transfer departments, Knowledge base, Exceptions, raw permission slugs); 0 `htmlFor` vs 110 labels, no `aria-live` toasts, no dialog role/focus trap on BookingModal, faint text ~3:1 contrast; tables/forms overflow on phones; invite success toast is misleading and the link is unrecoverable.
Approach: stay on plain CSS tokens (no Tailwind/shadcn migration). Tools/skills: `frontend:design-system` (extract DESIGN.md from the live site), `frontend:design-review`, `ui-ux-pro-max`, `frontend:react-patterns`, built-in browser pane for screenshots + axe-core accessibility scan, `dataviz` for charts, `motion-dev-animations` only for small micro-interactions if you want them.

| # | Step | NOW | TOMORROW |
|---|---|---|---|
| G1 | `docs/GUI_ENHANCEMENT_PLAN.md` (audit -> fix -> tool) | yes | — |
| G2 | Extract DESIGN.md tokens from the live UI | yes | — |
| G3 | Quick wins: empty-state CTAs, skeleton loaders, modal instead of `confirm()`, invite UX (with Plan 4) | code + browser check | deploy |
| G4 | Settings navigation (tabs/anchors), plain-language labels + tooltips, inline validation | code | deploy |
| G5 | Accessibility: `htmlFor`, `aria-live` toasts, focus trap, contrast, skip link | code + axe scan | deploy |
| G6 | Mobile pass: tables/forms/sidebar menu | code + mobile viewport check | deploy |
| G7 | Onboarding progress on Overview + first-run tour | code | deploy |
| G8 | Customer-facing design (`/find`, `/book`) polished with Plan 1 | with Plan 1 | deploy |
| G9 | Visual regression screenshots | later | — |
Jira parents 24-26:
- **24. GUI Audit & Foundations**: 24a UX audit doc; 24b skills/tools selection; 24c DESIGN.md tokens; 24d skeleton loaders; 24e empty states with CTA; 24f modal instead of confirm(); 24g inline validation+formats.
- **25. GUI Settings, Accessibility & Mobile**: 25a Settings tabs/anchors; 25b plain-language labels; 25c tooltips/glossary; 25d label htmlFor; 25e aria-live toasts; 25f contrast+focus+skip link; 25g modal focus trap; 25h table overflow wrappers; 25i responsive forms; 25j mobile sidebar menu.
- **26. GUI Onboarding & Customer-facing**: 26a onboarding progress on Overview; 26b first-run tour; 26c `/find` design review; 26d `/book` wizard design review; 26e customer confirmation screen polish; 26f screenshot regression [T].
