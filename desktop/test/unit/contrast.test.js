'use strict';

// WCAG 2.2 AA contrast for the editor's color tokens, in light and dark.
// Text needs 4.5:1. Control borders, focus rings and the selected ring need 3:1.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'editor', 'editor.css'), 'utf8');

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2];
  return out;
}
const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))));
const darkStart = css.indexOf(':root {', css.indexOf('prefers-color-scheme: dark'));
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('}', darkStart))) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = [
  ['fg', 'bg'], ['fg', 'card'], ['fg', 'surface'], ['fg', 'sunken'],
  ['muted', 'bg'], ['muted', 'card'], ['muted', 'surface'], ['muted', 'sunken'],
  ['accent-ink', 'accent'], ['danger-ink', 'danger'],
  ['danger', 'card'], ['danger', 'surface'], ['ok', 'card'],
];
const UI = [
  ['field', 'surface'], ['field', 'card'], ['field', 'bg'],
  ['accent', 'surface'], ['accent', 'card'], ['accent', 'sunken'],
  ['focus', 'bg'], ['focus', 'card'], ['focus', 'surface'], ['focus', 'sunken'],
];

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`${name} theme meets AA contrast`, () => {
    const fails = [];
    for (const [pairs, min] of [[TEXT, 4.5], [UI, 3]]) {
      for (const [fg, bg] of pairs) {
        assert.ok(theme[fg] && theme[bg], `missing --${fg} or --${bg}`);
        const r = ratio(theme[fg], theme[bg]);
        if (r < min) fails.push(`--${fg} on --${bg}: ${r.toFixed(2)} < ${min}`);
      }
    }
    assert.deepStrictEqual(fails, []);
  });
}
