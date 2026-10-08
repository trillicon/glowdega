// node --test tests/  — the /resources/ pages built by tools/build.py (tools/resources_site.py): SEO, structure,
// accessibility hooks, the site-wide Resources link, and that calculator UI files hold no formulas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestGet as sitemap, RESOURCES } from '../functions/sitemap.xml.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CALCS = ['service-pricing', 'hourly-rate', 'service-cost', 'service-profitability', 'break-even'];
const SOON = ['profit-take-home', 'capacity-clients', 'price-increase', 'discount-promotion', 'menu-profitability'];
const PAGES = ['resources/index.html', ...CALCS.map((c) => `resources/${c}/index.html`)];
const one = (html, re) => html.match(re)?.[1];
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

function allPages() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'admin' || name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else if (name.endsWith('.html')) out.push(p.slice(ROOT.length + 1));
    }
  };
  walk(ROOT);
  return out;
}

test('every resources page exists with a unique title, description and a single H1', () => {
  const titles = new Set(), descs = new Set();
  for (const p of PAGES) {
    assert.ok(existsSync(join(ROOT, p)), `${p} missing: run tools/build.py`);
    const html = read(p);
    const title = one(html, /<title>([^<]+)<\/title>/);
    const desc = one(html, /<meta name="description" content="([^"]+)"/);
    assert.match(title, / \| GLOWDEGA$/, p);
    assert.ok(desc && desc.length >= 70 && desc.length <= 200, `${p}: description length ${desc?.length}`);
    assert.ok(!titles.has(title) && !descs.has(desc), `${p}: duplicate title or description`);
    titles.add(title); descs.add(desc);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${p}: one H1`);
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.glowdega\.com\/resources\//, p);
  }
  // titles are unique across the whole site, not just among the calculators
  for (const p of allPages().filter((p) => !p.startsWith('resources/'))) assert.ok(!titles.has(one(read(p), /<title>([^<]+)<\/title>/)), p);
});

test('calculator pages: 100–250 word intro, JSON-LD WebPage + WebApplication + BreadcrumbList, no advice claims', () => {
  for (const c of CALCS) {
    const html = read(`resources/${c}/index.html`);
    const intro = text(one(html, /<div class="calc-intro">(.*?)<\/div>/s) || '');
    const words = intro.split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 100 && words <= 250, `${c}: intro has ${words} words`);
    const lds = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    const nodes = lds.flatMap((ld) => ld['@graph'] || [ld]);
    for (const t of ['WebPage', 'WebApplication', 'BreadcrumbList']) assert.ok(nodes.some((n) => n['@type'] === t), `${c}: no ${t}`);
    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.item);
    assert.deepEqual(crumbs, ['https://www.glowdega.com/', 'https://www.glowdega.com/resources/', `https://www.glowdega.com/resources/${c}/`]);
    assert.doesNotMatch(text(html), /financial advice from|professional financial advice|guaranteed/i, c);
    assert.match(html, /not tax, accounting, or legal advice/, c);
  }
});

test('calculator pages: shared framework hooks (labels, numeric keyboards, live results, actions, coaching, no ads)', () => {
  for (const c of CALCS) {
    const html = read(`resources/${c}/index.html`);
    assert.doesNotMatch(html, /ad-slot|data-ad-|ad-rail/, `${c}: calculator pages carry no ad slots`);
    assert.match(html, /class="calc-output" aria-live="polite"/, c);
    for (const a of ['print', 'share', 'email']) assert.match(html, new RegExp(`data-action="${a}"`), `${c}: ${a}`);
    for (const s of ['story', 'social', 'copy', 'email']) assert.match(html, new RegExp(`data-share="${s}"`), `${c}: share ${s}`);
    assert.match(html, /Instagram Story[\s\S]*TikTok[\s\S]*Threads/, `${c}: platform guidance`);
    assert.doesNotMatch(text(html), /we('ll| will) post|auto-?post/i, `${c}: never promise posting`);
    assert.match(html, /<a class="cta" href="mailto:book@fairyglowmother\.com[^"]*">Learn About Coaching<\/a>/, c);
    assert.match(html, /<details class="calc-advanced">|data-action="add-row"/, `${c}: advanced inputs or line items`);
    for (const input of html.matchAll(/<input id="(f-[^"]+)"([^>]*)>/g)) {
      const [, id, attrs] = input;
      assert.match(attrs, /inputmode="decimal"/, `${c} ${id}`);
      assert.match(html, new RegExp(`<label for="${id}">`), `${c} ${id}: no label`);
      assert.match(html, new RegExp(`<p class="calc-error" id="${id}-error" hidden></p>`), `${c} ${id}: no adjacent error`);
      if (/data-unit="percent"/.test(attrs)) assert.match(attrs, /data-max="100" data-max-exclusive/, `${c} ${id}: 100% must be rejected`);
    }
    const src = one(html, /<script type="module" src="\.\.\/\.\.\/([^"?]+)\?v=[0-9a-f]{10}"><\/script>/);
    assert.ok(src && existsSync(join(ROOT, src)), `${c}: module script missing`);
  }
  assert.match(read('resources/service-pricing/index.html'), /name="businessType" value="owner"/);
  // service-cost now has rent, which employees never see, so it carries the selector with all three types
  const cost = read('resources/service-cost/index.html');
  for (const t of ['solo', 'employee', 'owner']) assert.match(cost, new RegExp(`name="businessType" value="${t}"`), `service-cost: ${t}`);
});

const fieldOf = (html, name) => one(html, new RegExp(`(<div class="calc-field"[^>]*>(?:(?!<div class="calc-field").)*?name="${name}"[^>]*>)`, 's'));
const wrapperOf = (html, name) => one(fieldOf(html, name) || '', /^(<div class="calc-field"[^>]*>)/);

test('rent: a "Monthly rent" input on all five calculators, for solo providers and owners only (employees never see it)', () => {
  for (const c of CALCS) {
    const html = read(`resources/${c}/index.html`);
    assert.match(html, /<span class="calc-label">Monthly rent<\/span>/, `${c}: no Monthly rent field`);
    for (const name of ['monthlyRent', 'hoursPerMonth']) {
      const wrap = wrapperOf(html, name);
      // break-even and hourly-rate add rent whole (monthly, or × 12), so only they have no hours field
      if (!wrap) { assert.equal(name, 'hoursPerMonth', `${c}: ${name} missing`); assert.ok(['break-even', 'hourly-rate'].includes(c), `${c}: hours missing`); continue; }
      const types = one(wrap, /data-types="([^"]*)"/);
      assert.deepEqual(types?.split(' ').sort(), ['owner', 'solo'], `${c} ${name}: must be solo/owner only, got ${types}`);
    }
    // rent is never mixed into the other-expense fields: their hints say so
    for (const name of ['monthlyFixed', 'monthlyVariable', 'annualExpenses', 'fixedCosts', 'overhead']) {
      const f = fieldOf(html, name);
      if (f) assert.match(one(html, new RegExp(`id="f-${name}-hint">([^<]*)<`)), /not rent/, `${c} ${name}: hint must say "not rent"`);
    }
  }
  const hours = fieldOf(read('resources/service-pricing/index.html'), 'hoursPerMonth');
  assert.match(hours, /value="160"/);
  assert.match(read('resources/service-pricing/index.html'), /id="f-hoursPerMonth-hint">Defaults to 160/);
  assert.doesNotMatch(read('resources/break-even/index.html'), /name="hoursPerMonth"/, 'break-even adds rent whole: no hours field');
});

test('service pricing: profit margin defaults to 30% and the page rejects anything below it with the exact message', () => {
  const f = fieldOf(read('resources/service-pricing/index.html'), 'profitMargin');
  assert.match(f, /value="30"/);
  assert.match(f, /data-min="30"/);
  assert.match(f, /data-min-message="Enter a profit margin of at least 30%\."/);
  assert.match(f, /data-required/);
});

test('hourly rate: employee pay types, each field shown only for its pay type; employees get no rent or expenses', () => {
  const html = read('resources/hourly-rate/index.html');
  const pay = one(html, /(<fieldset class="calc-type calc-choice"[^>]*>.*?<\/fieldset>)/s);
  assert.match(pay, /data-types="employee"/);
  assert.deepEqual([...pay.matchAll(/name="payType" value="(\w+)"/g)].map((m) => m[1]), ['hourly', 'commission', 'mixed']);
  assert.match(pay, /value="hourly" checked/);
  assert.match(pay, /Hourly \+ commission/);
  assert.equal(one(wrapperOf(html, 'baseHourlyWage'), /data-when="([^"]*)"/), 'payType:mixed');
  assert.equal(one(wrapperOf(html, 'commissionRate'), /data-when="([^"]*)"/), 'payType:commission mixed');
  for (const n of ['baseHourlyWage', 'commissionRate', 'monthlyTips']) assert.match(wrapperOf(html, n), /data-types="employee"/, n);
  assert.doesNotMatch(wrapperOf(html, 'monthlyTips'), /data-when/, 'tips apply to every pay type');
  for (const n of ['monthlyRent', 'annualExpenses']) assert.doesNotMatch(wrapperOf(html, n), /employee/, `${n} must not show for employees`);
  assert.match(fieldOf(html, 'commissionRate'), /data-min-exclusive/, '0% commission is rejected on the page too');
  assert.match(html, /take-home/);
});

test('hub: hero, audience selector, four categories, 5 live calculators and 5 unlinked coming-soon cards', () => {
  const html = read('resources/index.html');
  assert.match(html, /<h1>Beauty Business Calculators<\/h1>/);
  for (const t of ['solo', 'employee', 'owner']) assert.match(html, new RegExp(`data-audience="${t}" aria-pressed="false"`));
  for (const cat of ['Pricing', 'Profitability', 'Growth', 'Promotions']) assert.match(html, new RegExp(`<h2 id="cat-${cat.toLowerCase()}">${cat}</h2>`));
  for (const c of CALCS) assert.match(html, new RegExp(`<a class="hub-card" href="${c}/" data-audiences="[a-z ]+"`), c);
  const soon = [...html.matchAll(/<div class="hub-card is-soon" aria-disabled="true"[^>]*>(.*?)<\/div>/gs)];
  assert.equal(soon.length, SOON.length);
  for (const s of SOON) assert.doesNotMatch(html, new RegExp(`href="[^"]*${s}`), `${s} must not be clickable yet`);
  assert.match(html, /Additional Resources/);
  for (const m of ['Pricing Guides', 'Business Templates', 'Marketing Tools']) assert.match(html, new RegExp(`<li class="hub-soon" aria-disabled="true"><span>${m}</span><span class="soon-pill">Coming soon</span></li>`));
  assert.doesNotMatch(html, /ad-slot|data-ad-/);
});

test('Resources is the 4th header link and a footer link on every page, including the article template', () => {
  const pages = [...allPages(), 'assets/templates/article.html'];
  assert.ok(pages.length > 150, `only ${pages.length} pages`);
  for (const p of pages) {
    const html = read(p);
    const nav = one(html, /<nav class="nav">(.*?)<\/nav>/s) || '';
    assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]),
      ['The Glow Gazette', 'About Hadiyah', 'Esthetician Directory', 'Resources'], p);
    assert.match(nav, /<a href="(\/|(\.\.\/)*)resources\/">Resources<\/a>$/, p);
    assert.match(one(html, /<footer>(.*?)<\/footer>/s) || '', /<a href="(\/|(\.\.\/)*)resources\/">Resources<\/a>/, p);
  }
});

test('sitemap lists the hub and every live calculator', async () => {
  const built = PAGES.map((p) => '/' + p.replace(/index\.html$/, ''));
  assert.deepEqual([...RESOURCES].sort(), built.sort());
  const fakeAssets = { async fetch(req) {
    const file = join(ROOT, new URL(req.url).pathname);
    return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
  } };
  const xml = await (await sitemap({ env: { ASSETS: fakeAssets }, request: new Request('https://www.glowdega.com/sitemap.xml') })).text();
  for (const path of built) assert.ok(xml.includes(`<loc>https://www.glowdega.com${path}</loc>`), path);
});

test('UI and calculator files hold no financial formulas (they call assets/calc/core)', () => {
  const dirs = ['assets/calc/ui', 'assets/calc/calculators'];
  const files = [...dirs.flatMap((d) => readdirSync(join(ROOT, d)).map((f) => `${d}/${f}`)), 'assets/calc/hub.js'];
  for (const f of files) {
    const code = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /\b(v|r|at|values)\.[\w.[\]]+\s*[-+*/]\s*[\w(]/, `${f}: arithmetic on inputs/results belongs in assets/calc/core`);
  }
  for (const c of CALCS) assert.match(read(`assets/calc/calculators/${c}.js`), /from '\.\.\/core\/(pricing|profit|breakeven|costs)\.js'/, c);
});
