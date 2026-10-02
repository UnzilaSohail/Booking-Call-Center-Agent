// Colour contrast of the dashboard's design tokens (Jira 25f): reads the real CSS variables from
// dashboard/app/globals.css and checks WCAG AA (4.5:1 for normal text) for the pairs the UI actually
// uses. Pure, needs no database. If someone lightens a token, this fails with the pair and ratio.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../dashboard/app/globals.css', import.meta.url), 'utf8');
const block = (open) => { const i = css.indexOf(open); return css.slice(i, css.indexOf('}', i)); };
const light = block(':root {');
const dark = block(':root[data-theme="dark"]');
// A theme only restates the tokens it changes, so dark falls back to the light value for the rest.
const tokenIn = (theme) => (name) => {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`);
  const m = re.exec(theme === 'dark' ? dark : light) ?? re.exec(light);
  assert.ok(m, `token --${name} not found`);
  return m[1];
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [text token, background token] pairs, each used somewhere in the UI.
const PAIRS = [
  ['text', 'surface'], ['text', 'bg'], ['text-muted', 'surface'], ['text-muted', 'bg'], ['text-muted', 'surface-alt'],
  ['text-faint', 'surface'], ['text-faint', 'bg'], ['text-faint', 'surface-alt'],
  ['accent', 'surface'], ['accent', 'bg'],
  ['ink-text', 'ink'], ['ink-text', 'ink-hover'],
  ['success-text', 'success-soft'], ['warning-text', 'warning-soft'], ['danger-text', 'danger-soft'],
  ['info-text', 'info-soft'], ['violet-text', 'violet-soft'],
  ['success-text', 'surface'], ['danger-text', 'surface'],
  ['danger', 'surface'], // danger buttons and links
];

for (const theme of ['light', 'dark']) {
  const token = tokenIn(theme);
  describe(`design token contrast (${theme})`, () => {
    for (const [fg, bg] of PAIRS) {
      it(`${fg} on ${bg} is at least 4.5:1`, () => {
        const r = ratio(token(fg), token(bg));
        assert.ok(r >= 4.5, `--${fg} (${token(fg)}) on --${bg} (${token(bg)}) is only ${r.toFixed(2)}:1`);
      });
    }

    it('white text on the toast fills is at least 4.5:1', () => {
      for (const fill of ['success-strong', 'warning-strong', 'danger-strong']) {
        const r = ratio('#ffffff', token(fill));
        assert.ok(r >= 4.5, `white on --${fill} is only ${r.toFixed(2)}:1`);
      }
    });
  });
}
