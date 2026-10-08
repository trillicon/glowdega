// node --test tests/  — home page card order, the affiliate note size and headline letter-spacing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeCards, HOME_NEWEST, HOME_TRENDING } from '../functions/_lib/posts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const slugsOf = (html) => [...html.matchAll(/href="\/blog\/([^"]+)"/g)].map((m) => m[1]);

// p0 is the newest, p19 the oldest
const posts = Array.from({ length: 20 }, (_, i) => ({ slug: `p${i}`, title: `P${i}`, excerpt: '', date: `2026-01-${String(20 - i).padStart(2, '0')}T00:00:00` }));

test('home: 6 newest first, then the 6 best-ranked of the rest', () => {
  assert.equal(HOME_NEWEST, 6);
  assert.equal(HOME_TRENDING, 6);
  // p2 is ranked but already among the newest, so it is not repeated
  const ranked = ['p15', 'p2', 'p9', 'p19', 'p7', 'p12', 'p11', 'p8'];
  assert.deepEqual(slugsOf(homeCards(posts, ranked)),
    ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p15', 'p9', 'p19', 'p7', 'p12', 'p11']);
});

test('home: a short ranking is topped up newest first; no ranking = newest 12', () => {
  assert.deepEqual(slugsOf(homeCards(posts, ['p18'])),
    ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p18', 'p6', 'p7', 'p8', 'p9', 'p10']);
  assert.deepEqual(slugsOf(homeCards(posts)), posts.slice(0, 12).map((p) => p.slug));
});

test('home: the static index.html built by tools/build.py follows the same rule', () => {
  const archive = JSON.parse(read('assets/posts.json'));
  const popular = JSON.parse(read('assets/popular.json'));
  const newest = [...archive].sort((a, b) => (a.date < b.date ? 1 : -1));
  const grid = read('index.html').split('<div class="post-grid">')[1].split('</div><p')[0];
  assert.deepEqual(slugsOf(grid), slugsOf(homeCards(newest, popular)));
});

test('affiliate note is italic and 8pt on every screen size', () => {
  const css = read('assets/style.css');
  const rules = [...css.matchAll(/\.affiliate-note\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 1);
  assert.match(rules[0], /font-style:italic/);
  for (const r of rules) if (/font-size/.test(r)) assert.match(r, /font-size:8pt/);
});

test('headlines are never letter-spaced tighter than -0.02em', () => {
  const css = read('assets/style.css');
  const tight = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, sel, body] = m;
    const ls = body.match(/letter-spacing:(-?[\d.]+)em/);
    if (!ls || !/\bh1\b|\bh2\b|house-ad__title/.test(sel) || /\.logo/.test(sel) || /\.prose h2/.test(sel)) continue;
    if (Number(ls[1]) < -0.02) tight.push(`${sel.trim()} ${ls[1]}em`);
  }
  assert.deepEqual(tight, []);
});

test('book page carries no build notes (the second section is removed until there is content)', () => {
  const book = read('book.html');
  assert.doesNotMatch(book, /intentionally built|this destination can be updated/i);
  assert.match(book, /<section class="book">/);
});

test('every page links the stylesheet as style.css?v=<hash of the current CSS>, so browsers never keep a stale copy', async () => {
  const { createHash } = await import('node:crypto');
  const { readdirSync, statSync } = await import('node:fs');
  const version = createHash('sha256').update(readFileSync(join(ROOT, 'assets/style.css'))).digest('hex').slice(0, 10);
  const pages = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'admin' || name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else if (name.endsWith('.html')) pages.push(p);
    }
  };
  walk(ROOT);
  const stale = [];
  for (const p of pages) {
    for (const m of readFileSync(p, 'utf8').matchAll(/assets\/style\.css(\?v=[0-9a-f]+)?"/g)) {
      if (m[1] !== `?v=${version}`) stale.push(p.slice(ROOT.length + 1));
    }
  }
  assert.ok(pages.length > 140, `only ${pages.length} pages found`);
  assert.deepEqual(stale, [], 'run tools/build.py after changing assets/style.css');
});
