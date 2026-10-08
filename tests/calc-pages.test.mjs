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

const LICENSES = [['esthetician', 'Esthetician'], ['cosmetologist', 'Cosmetologist/Hairstylist'], ['manicurist', 'Manicurist/Nail Technician'], ['barber', 'Barber']];
const optionsOf = (select) => [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);

test('hub: hero, four categories, 5 live calculators and 5 unlinked coming-soon cards, all in the HTML', () => {
  const html = read('resources/index.html');
  assert.match(html, /<h1>Beauty Business Calculators<\/h1>/);
  for (const cat of ['Pricing', 'Profitability', 'Growth', 'Promotions']) assert.match(html, new RegExp(`<h2 id="cat-${cat.toLowerCase()}">${cat}</h2>`));
  // the cards are plain links in the static HTML (crawlable); JavaScript only adds ?type=&profession=
  for (const c of CALCS) assert.match(html, new RegExp(`<a class="hub-card" href="${c}/" data-audiences="[a-z ]+"[^>]* data-types="[a-z ]+"`), c);
  const soon = [...html.matchAll(/<div class="hub-card is-soon" aria-disabled="true"[^>]*>(.*?)<\/div>/gs)];
  assert.equal(soon.length, SOON.length);
  for (const s of SOON) assert.doesNotMatch(html, new RegExp(`href="[^"]*${s}`), `${s} must not be clickable yet`);
  assert.match(html, /Additional Resources/);
  for (const m of ['Pricing Guides', 'Business Templates', 'Marketing Tools']) assert.match(html, new RegExp(`<li class="hub-soon" aria-disabled="true"><span>${m}</span><span class="soon-pill">Coming soon</span></li>`));
  assert.doesNotMatch(html, /ad-slot|data-ad-/);
  assert.doesNotMatch(html, /data-audience=|aria-pressed/, 'the old "I’m a…" buttons are replaced by the gate');
  // no card is hidden in the HTML itself: hiding happens only once the hub script can run
  assert.doesNotMatch(one(html, /<div class="hub-body">(.*)<\/div><\/div>/s), /\shidden[\s>]/);
});

test('hub gate: "I’m a Licensed [4 licenses] and a [3 worker types]" sentence picker', () => {
  const html = read('resources/index.html');
  const gate = one(html, /(<form class="hub-gate" data-hub-gate[^>]*>.*?<\/form>)/s);
  assert.ok(gate, 'no gate form');
  assert.match(text(gate).replace(/\s+/g, ' '), /I’m a Licensed .* and a /);
  const sub = one(html, /<p class="hub-sub">(.*?)<\/p>/s);
  for (const who of ['estheticians', 'lash and brow artists', 'hairstylists', 'barbers', 'nail techs']) assert.match(sub, new RegExp(who), `hub subheading leaves out ${who}`);
  const prof = one(gate, /(<select name="profession"[^>]*>.*?<\/select>)/s);
  const type = one(gate, /(<select name="type"[^>]*>.*?<\/select>)/s);
  assert.deepEqual(optionsOf(prof), [['', 'choose your license'], ...LICENSES]);
  assert.deepEqual(optionsOf(type), [['', 'choose how you work'], ['solo', 'Solo Provider'], ['employee', 'Employee'], ['owner', 'Business Owner']]);
  assert.match(prof, /aria-label="Your license"/);
  assert.match(type, /aria-label="How you work"/);
  assert.match(html, /<p class="hub-chosen" data-hub-chosen tabindex="-1" hidden>.*?<button type="button" class="hub-change" data-hub-change>Change<\/button><\/p>/s);
  assert.ok(html.indexOf('data-hub-gate') < html.indexOf('class="hub-body"'), 'the picker sits above the cards');
});

test('hub gate: progressive enhancement, cards visible with JavaScript off (noscript), hidden only by the hub-js class', () => {
  const html = read('resources/index.html');
  const css = read('assets/style.css');
  // the flag is set inline before the cards render, and only where module scripts (the hub script) can run
  assert.match(html, /<script>if\('noModule' in HTMLScriptElement\.prototype\)document\.documentElement\.classList\.add\('hub-js'\)<\/script><form class="hub-gate"/);
  assert.match(html, /<noscript><p class="hub-status">Every calculator is listed below\.[^<]*<\/p><\/noscript>/);
  assert.match(css, /\.hub-gate\{display:none[;}]/, 'without the flag (JavaScript off) the gate is not shown');
  assert.match(css, /\.hub-js \.hub-gate:not\(\[hidden\]\)\{display:block\}/);
  assert.match(css, /\.hub-js \.hub-body:not\(\.is-chosen\) \.hub-cat\{display:none\}/, 'cards hide until both are chosen, only with JS');
  // nothing else hides the categories or cards unconditionally
  for (const rule of css.matchAll(/([^{}]+)\{[^}]*display:none[^}]*\}/g)) {
    for (const sel of rule[1].split(',')) {
      if (/\.hub-(cat|card|body)\b/.test(sel)) assert.match(sel, /\.hub-js|\[hidden\]/, `"${sel.trim()}" would hide cards without JavaScript`);
    }
  }
  assert.match(read('assets/calc/hub.js'), /savedChoice\(PROFESSION_KEY\)[\s\S]*savedChoice\(TYPE_KEY\)/, 'returning visitors skip the gate');
});

test('hub links: matching cards link with ?type=&profession=; ?type only where the calculator supports it', async () => {
  const { cardHref, cardMatches, chosenSentence } = await import('../assets/calc/hub.js');
  assert.equal(cardHref('service-pricing/', { type: 'owner', profession: 'barber', types: ['solo', 'owner'] }), 'service-pricing/?type=owner&profession=barber');
  assert.equal(cardHref('hourly-rate/', { type: 'employee', profession: 'manicurist', types: ['solo', 'employee', 'owner'] }), 'hourly-rate/?type=employee&profession=manicurist');
  assert.equal(cardHref('service-pricing/', { type: 'employee', profession: 'esthetician', types: ['solo', 'owner'] }), 'service-pricing/?profession=esthetician');
  assert.equal(cardHref('break-even/?type=solo&profession=barber', { type: 'owner', profession: 'cosmetologist', types: ['solo', 'owner'] }), 'break-even/?type=owner&profession=cosmetologist', 'a new choice replaces the old');
  assert.equal(cardHref('break-even/', { type: 'nope', profession: 'nope', types: ['solo'] }), 'break-even/');
  assert.equal(cardMatches('solo owner', 'owner'), true);
  assert.equal(cardMatches('solo owner', 'employee'), false);
  assert.equal(cardMatches('solo owner', null), false, 'nothing matches until a type is chosen');
  assert.equal(chosenSentence('cosmetologist', 'employee'), 'Showing the calculators for a licensed Cosmetologist/Hairstylist working as an Employee.');
  // the hub's cards declare the types their calculator supports, which is what the links use
  const html = read('resources/index.html');
  assert.equal(one(html, /href="service-pricing\/"[^>]* data-types="([^"]+)"/), 'solo owner');
  assert.equal(one(html, /href="hourly-rate\/"[^>]* data-types="([^"]+)"/), 'solo employee owner');
});

test('calculator pages are not gated: worker-type selector plus a small profession selector, pre-set by the framework', async () => {
  const { PROFESSIONS } = await import('../assets/calc/ui/professions.js');
  assert.deepEqual(Object.entries(PROFESSIONS).map(([k, v]) => [k, v.label]), LICENSES, 'page options and the wording module agree');
  for (const c of CALCS) {
    const html = read(`resources/${c}/index.html`);
    assert.doesNotMatch(html, /data-hub-gate/, `${c}: never gated`);
    for (const t of ['solo', 'employee', 'owner']) assert.match(html, new RegExp(`name="businessType" value="${t}"`), `${c}: ${t}`);
    const sel = one(html, /(<select id="f-profession" name="profession">.*?<\/select>)/s);
    assert.ok(sel, `${c}: no profession selector`);
    assert.deepEqual(optionsOf(sel), LICENSES, c);
    assert.match(sel, /value="esthetician" selected/);
    assert.match(html, /<label for="f-profession">Your license<\/label>/);
    assert.match(html, /The math is the same for every license\./);
  }
  const fw = read('assets/calc/ui/framework.js');
  assert.match(fw, /params\.get\('profession'\), savedChoice\(PROFESSION_KEY\)/, 'profession pre-set from the URL, then the hub choice');
  assert.match(fw, /params\.get\('type'\), savedAudience\(\)/, 'type pre-set from the URL, then the hub choice');
});

// labor fields: [calculator, field, label, types]
const LABOR = [
  ['service-pricing', 'targetHourly', 'Your pay per hour', 'solo'],
  ['service-pricing', 'providerWage', 'Provider’s hourly wage', 'owner'],
  ['service-pricing', 'commissionRate', 'Commission paid per service (%)', 'owner'],
  ['hourly-rate', 'monthlyPayroll', 'Monthly payroll (wages + payroll taxes)', 'owner'],
  ['service-cost', 'monthlyPay', 'Your monthly pay', 'solo'],
  ['service-cost', 'providerWage', 'Provider’s hourly wage', 'owner'],
  ['service-cost', 'commissionRate', 'Commission paid per service (%)', 'owner'],
  ['service-cost', 'price', 'Service price', 'owner'],
  ['service-profitability', 'targetHourly', 'Your pay per hour', 'solo'],
  ['service-profitability', 'providerWage', 'Provider’s hourly wage', 'owner'],
  ['service-profitability', 'commissionRate', 'Commission paid per service (%)', 'owner'],
  ['break-even', 'monthlyPay', 'Your monthly pay', 'solo'],
  ['break-even', 'monthlyPayroll', 'Monthly payroll (wages + payroll taxes)', 'owner'],
  ['break-even', 'ownerPay', 'Your monthly owner pay', 'owner'],
  ['break-even', 'commissionRate', 'Commission paid per service (%)', 'owner'],
];

test('labor fields: solo pay and owner payroll/wage/commission on every calculator with costs; never shown to employees', () => {
  for (const [c, name, label, types] of LABOR) {
    const html = read(`resources/${c}/index.html`);
    const f = fieldOf(html, name);
    assert.ok(f, `${c}: no ${name}`);
    assert.equal(one(wrapperOf(html, name), /data-types="([^"]*)"/), types, `${c} ${name}: only for ${types}`);
    assert.match(f, new RegExp(`<span class="calc-label">${label.replace(/[()+]/g, '\\$&')}</span>`), `${c} ${name}: label`);
  }
  // nothing labor-like is ever shown to employees on any calculator (hourly-rate's commission is the employee's own pay)
  for (const c of CALCS) {
    const html = read(`resources/${c}/index.html`);
    for (const name of ['monthlyPay', 'monthlyPayroll', 'ownerPay', 'providerWage', ...(c === 'hourly-rate' ? [] : ['commissionRate', 'targetHourly'])]) {
      const wrap = wrapperOf(html, name);
      if (wrap) assert.doesNotMatch(wrap, /employee/, `${c} ${name}: employees never see labor`);
    }
  }
  // solo pricing has one labor input (pay per hour); there is no monthly pay to count twice
  assert.doesNotMatch(read('resources/service-pricing/index.html'), /name="monthlyPay"|name="laborCost"/);
  assert.doesNotMatch(read('resources/service-profitability/index.html'), /name="laborCost"/);
  assert.match(fieldOf(read('resources/service-pricing/index.html'), 'targetHourly'), /data-required/, 'solo pricing still needs your pay per hour');
  assert.match(one(read('resources/break-even/index.html'), /id="f-fixedCosts-hint">([^<]*)</), /not rent or pay/, 'pay is never typed into other fixed costs too');
});

test('hourly rate: a visible, optional "Your current hourly wage" for hourly employees; hourly + commission keeps its base wage', () => {
  const html = read('resources/hourly-rate/index.html');
  const cur = fieldOf(html, 'currentHourlyWage');
  assert.match(cur, /<span class="calc-label">Your current hourly wage<\/span> <span class="calc-optional">optional<\/span>/);
  assert.doesNotMatch(cur, /data-required/, 'blank = just show the required wage');
  assert.equal(one(wrapperOf(html, 'currentHourlyWage'), /data-types="([^"]*)"/), 'employee');
  assert.equal(one(wrapperOf(html, 'currentHourlyWage'), /data-when="([^"]*)"/), 'payType:hourly');
  assert.doesNotMatch(wrapperOf(html, 'currentHourlyWage'), /\shidden/, 'not tucked away: it is in the main inputs');
  assert.ok(html.indexOf('name="currentHourlyWage"') < html.indexOf('class="calc-advanced"'), 'shown with the main inputs');
  assert.match(fieldOf(html, 'baseHourlyWage'), /<span class="calc-label">Your current base hourly wage<\/span>/, 'labelled the same way');
});

test('examples are 60 or 90 minutes: no 2-hour (120-minute) service anywhere in pages, hints, methodology or code', () => {
  const files = [...PAGES, ...['assets/calc/core', 'assets/calc/calculators', 'assets/calc/ui'].flatMap((d) => readdirSync(join(ROOT, d)).map((f) => `${d}/${f}`)),
    'tools/resources_site.py', 'tests/calc-engine.test.mjs', 'tests/calc-views.test.mjs'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(2|two)[- ]hour (service|facial|peel|appointment)|\b(2|two)-hour\b|120[- ]minute|exampleServiceMinutes: 120|value='120'/i, f);
    for (const m of text(src).matchAll(/\b(\d+)-minute\b/g)) assert.ok(['60', '90'].includes(m[1]), `${f}: a ${m[1]}-minute example`);
  }
  for (const c of CALCS) {
    const html = read(`resources/${c}/index.html`);
    for (const name of ['durationMinutes', 'exampleServiceMinutes']) {
      const f = fieldOf(html, name);
      if (!f) continue;
      for (const attr of ['placeholder', 'value']) {
        const v = one(f, new RegExp(`${attr}="([^"]*)"`));
        if (v) assert.ok(['60', '90'].includes(v), `${c} ${name} ${attr}=${v}`);
      }
    }
  }
  assert.match(fieldOf(read('resources/hourly-rate/index.html'), 'exampleServiceMinutes'), /value="90"/);
});

test('intros: a mix of esthetician, hairstylist, lash, brow, nail technician and barber scenarios, without keyword stuffing', () => {
  const KINDS = { esthetician: /esthetician|facial|peel/i, hairstylist: /hairstylist|color|cut-and-color|root touch-up/i, lash: /\blash/i,
    brow: /\bbrow/i, nail: /nail technician|manicure/i, barber: /barber/i };
  const seen = new Set();
  for (const c of CALCS) {
    const intro = text(one(read(`resources/${c}/index.html`), /<div class="calc-intro">(.*?)<\/div>/s) || '');
    const kinds = Object.entries(KINDS).filter(([, re]) => re.test(intro)).map(([k]) => k);
    kinds.forEach((k) => seen.add(k));
    assert.ok(kinds.length >= 2, `${c}: only ${kinds.join(', ')} in the intro`);
    for (const word of ['esthetician', 'hairstylist', 'lash', 'brow', 'nail', 'barber', 'calculator', 'beauty']) {
      const n = (intro.match(new RegExp(`\\b${word}`, 'gi')) || []).length;
      assert.ok(n <= 3, `${c}: "${word}" appears ${n} times (keyword stuffing)`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(KINDS).sort(), 'every profession appears somewhere');
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
