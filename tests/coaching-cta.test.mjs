// The coaching upsell gets the same yellow-green attention as the result box (owner, 2026-10-09).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/style.css', import.meta.url), 'utf8');
const rule = (sel) => css.match(new RegExp(`(?:^|}|\\s)${sel.replace(/[.]/g, '\\.')}\\{([^}]*)\\}`))?.[1] ?? '';

test('coaching CTA is a yellow-green box with a solid button', () => {
  assert.match(rule('.coaching-cta'), /background:var\(--acid\)/);
  assert.match(rule('.coaching-cta'), /border:1px solid var\(--ink\)/);
  assert.match(rule('.coaching-cta .cta'), /background:var\(--ink\);color:var\(--acid\)/);
});
