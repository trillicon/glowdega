// node --test tests/  — the official logo in every header and the brand icons on every page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = ['favicon.ico', 'assets/img/brand/favicon-32.png', 'assets/img/brand/apple-touch-icon.png', 'assets/img/brand/glowdega-logo.png'];

const pages = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else if (name.endsWith('.html')) pages.push(p);
  }
};
walk(ROOT);

test('brand files exist and are real images', () => {
  for (const f of ICONS) {
    assert.ok(existsSync(join(ROOT, f)), `${f} missing`);
    assert.ok(readFileSync(join(ROOT, f)).length > 500, `${f} is empty`);
  }
});

test('every page (admin included) links each brand icon exactly once, by root-absolute path', () => {
  assert.ok(pages.length > 150, `only ${pages.length} pages found`);
  const bad = [];
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    const icons = [...html.matchAll(/<link rel="(icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[2]);
    const want = ['/favicon.ico', '/assets/img/brand/favicon-32.png', '/assets/img/brand/apple-touch-icon.png'];
    if (icons.length !== want.length || want.some((w) => !icons.includes(w))) bad.push(p.slice(ROOT.length + 1));
  }
  assert.deepEqual(bad, [], 'run tools/build.py');
});

test('every site header shows the official logo image with GLOWDEGA® as its text alternative', () => {
  const bad = [];
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    const logo = html.match(/<a class="logo"[^>]*>(.*?)<\/a>/s);
    if (!logo) continue;
    if (!/<img src="[^"]*assets\/img\/brand\/glowdega-logo\.png" alt="GLOWDEGA®" width="766" height="114">/.test(logo[1])) bad.push(p.slice(ROOT.length + 1));
  }
  assert.deepEqual(bad, []);
  assert.match(readFileSync(join(ROOT, 'assets/style.css'), 'utf8'), /\.logo img\{[^}]*height:/, 'logo image has a set height');
});

test('every page has a link preview: the logo card (1200×630) with title and description, for iMessage, Facebook and X', () => {
  assert.ok(readFileSync(join(ROOT, 'assets/img/brand/share-card.png')).length > 5000, 'share card missing');
  const bad = [];
  for (const p of pages) {
    if (p.includes('/admin/')) continue;
    const html = readFileSync(p, 'utf8');
    const head = html.split('</head>')[0];
    const need = [
      /<meta property="og:image" content="https:\/\/www\.glowdega\.com\/assets\/img\/brand\/share-card\.png">/,
      /<meta property="og:image:width" content="1200">/, /<meta property="og:image:height" content="630">/,
      /<meta name="twitter:card" content="summary_large_image">/,
      /<meta property="og:title" content="[^"]+">/, /<meta property="og:description" content="[^"]+">/,
    ];
    const missing = need.filter((re) => !re.test(head));
    if (missing.length || (head.match(/property="og:image"/g) || []).length !== 1) bad.push(p.slice(ROOT.length + 1));
  }
  assert.deepEqual(bad, [], 'run tools/build.py');
});
