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
const SPRINT1 = ['service-pricing', 'hourly-rate', 'service-cost', 'service-profitability', 'break-even'];
const SPRINT2 = ['profit-take-home', 'menu-profitability', 'capacity-clients', 'price-increase', 'discount-promotion'];
const CALCS = [...SPRINT1, ...SPRINT2];
// calculators for the people who pay rent and labor only: no Employee option at all
const SOLO_OWNER_ONLY = ['service-cost', 'menu-profitability', 'price-increase', 'discount-promotion'];
// Capacity & Clients plans bookings, not costs: the one calculator with no rent, expense or labor inputs
const NO_COSTS = ['capacity-clients'];
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
  // service-cost is for the people who pay rent and labor: solo providers and owners only, never an employee option
  const cost = read('resources/service-cost/index.html');
  for (const t of ['solo', 'owner']) assert.match(cost, new RegExp(`name="businessType" value="${t}"`), `service-cost: ${t}`);
  assert.doesNotMatch(cost, /value="employee"|>Employee</, 'service-cost must not offer an Employee option');
  const card = one(read('resources/index.html'), /(<a class="hub-card" href="service-cost\/"[^>]*>)/);
  assert.match(card, /data-audiences="solo owner"/, 'hub: Cost Per Service is not shown to employees');
});

const fieldOf = (html, name) => one(html, new RegExp(`(<div class="calc-field"[^>]*>(?:(?!<div class="calc-field").)*?name="${name}"[^>]*>)`, 's'));
const wrapperOf = (html, name) => one(fieldOf(html, name) || '', /^(<div class="calc-field"[^>]*>)/);

test('rent: a "Monthly rent" input on every calculator with costs, for solo providers and owners only (employees never see it)', () => {
  for (const c of CALCS.filter((x) => !NO_COSTS.includes(x))) {
    const html = read(`resources/${c}/index.html`);
    assert.match(html, /<span class="calc-label">Monthly rent<\/span>/, `${c}: no Monthly rent field`);
    for (const name of ['monthlyRent', 'hoursPerMonth']) {
      const wrap = wrapperOf(html, name);
      // break-even, hourly-rate and profit & take-home add rent whole (monthly, or × 12), so only they have no hours field
      if (!wrap) { assert.equal(name, 'hoursPerMonth', `${c}: ${name} missing`); assert.ok(['break-even', 'hourly-rate', 'profit-take-home'].includes(c), `${c}: hours missing`); continue; }
      const types = one(wrap, /data-types="([^"]*)"/);
      assert.deepEqual(types?.split(' ').sort(), ['owner', 'solo'], `${c} ${name}: must be solo/owner only, got ${types}`);
    }
    // rent is never mixed into the other-expense fields: their hints say so
    for (const name of ['monthlyFixed', 'monthlyVariable', 'annualExpenses', 'fixedCosts', 'overhead', 'fixedExpenses', 'variableExpenses']) {
      const f = fieldOf(html, name);
      if (f) assert.match(one(html, new RegExp(`id="f-${name}-hint">([^<]*)<`)), /not rent/, `${c} ${name}: hint must say "not rent"`);
    }
  }
  const hours = fieldOf(read('resources/service-pricing/index.html'), 'hoursPerMonth');
  assert.match(hours, /value="160"/);
  assert.match(read('resources/service-pricing/index.html'), /id="f-hoursPerMonth-hint">Defaults to 160/);
  assert.doesNotMatch(read('resources/break-even/index.html'), /name="hoursPerMonth"/, 'break-even adds rent whole: no hours field');
  // per-service calculators share rent by the hour with the same 160-hour default
  for (const c of ['price-increase', 'discount-promotion', 'menu-profitability']) assert.match(fieldOf(read(`resources/${c}/index.html`), 'hoursPerMonth'), /value="160"/, c);
  for (const c of NO_COSTS) {
    const html = read(`resources/${c}/index.html`);
    assert.doesNotMatch(html, /name="(monthlyRent|hoursPerMonth|monthlyPay|monthlyPayroll|ownerPay|providerWage|commissionRate|targetHourly|fixedExpenses|variableExpenses|overhead)"/, `${c}: no cost inputs`);
    assert.match(text(html), /rent, pay and other costs/i, `${c}: says where costs are handled`);
  }
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

test('hub: hero, four categories, all 10 calculators live and linked; only Additional Resources is coming soon', () => {
  const html = read('resources/index.html');
  assert.match(html, /<h1>Beauty Business Calculators<\/h1>/);
  for (const cat of ['Pricing', 'Profitability', 'Growth', 'Promotions']) assert.match(html, new RegExp(`<h2 id="cat-${cat.toLowerCase()}">${cat}</h2>`));
  // the cards are plain links in the static HTML (crawlable); JavaScript only adds ?type=&profession=
  for (const c of CALCS) assert.match(html, new RegExp(`<a class="hub-card" href="${c}/" data-audiences="[a-z ]+"[^>]* data-types="[a-z ]+"`), c);
  assert.equal((html.match(/<a class="hub-card" href="/g) || []).length, CALCS.length, 'exactly one live card per calculator');
  assert.doesNotMatch(html, /hub-card is-soon/, 'no calculator is still "coming soon"');
  const body = one(html, /<div class="hub-body">(.*)<\/div><\/div>/s);
  const cards = [...body.matchAll(/<a class="hub-card"[^>]*>(.*?)<\/a>/gs)].map((m) => m[1]);
  for (const c of cards) {
    assert.doesNotMatch(c, /soon-pill|Coming soon/i, 'a live card never says coming soon');
    assert.match(c, /<span class="hub-card__cta">[^<]+ →<\/span>/, 'every live card has a CTA');
  }
  // the hub lists each category's tools: Pricing 3, Profitability 4, Growth 2, Promotions 1
  for (const [cat, n] of [['pricing', 3], ['profitability', 4], ['growth', 2], ['promotions', 1]]) {
    assert.match(html, new RegExp(`<h2 id="cat-${cat}">[^<]+</h2><span>${n} tools?</span>`), cat);
  }
  assert.match(html, /Additional Resources/);
  for (const m of ['Pricing Guides', 'Business Templates', 'Marketing Tools']) assert.match(html, new RegExp(`<li class="hub-soon" aria-disabled="true"><span>${m}</span><span class="soon-pill">Coming soon</span></li>`));
  assert.doesNotMatch(one(html, /(<section class="hub-more".*?<\/section>)/s), /href=/, 'Additional Resources stay unlinked');
  assert.doesNotMatch(html, /ad-slot|data-ad-/);
  assert.doesNotMatch(html, /data-audience=|aria-pressed/, 'the old "I’m a…" buttons are replaced by the gate');
  // no card is hidden in the HTML itself: hiding happens only once the hub script can run
  assert.doesNotMatch(body, /\shidden[\s>]/);
  // the hub's ItemList names every live calculator
  const ld = JSON.parse(one(html, /<script type="application\/ld\+json">(.*?)<\/script>/s));
  const list = ld['@graph'].find((n) => n['@type'] === 'ItemList').itemListElement.map((i) => i.url);
  assert.deepEqual(list.sort(), CALCS.map((c) => `https://www.glowdega.com/resources/${c}/`).sort());
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
  for (const [c, types] of [['profit-take-home', 'solo employee owner'], ['capacity-clients', 'solo employee owner'], ['price-increase', 'solo owner'],
    ['discount-promotion', 'solo owner'], ['menu-profitability', 'solo owner']]) {
    assert.equal(one(html, new RegExp(`href="${c}/"[^>]* data-types="([^"]+)"`)), types, c);
    assert.equal(one(html, new RegExp(`href="${c}/" data-audiences="([^"]+)"`)), types, `${c}: shown to exactly the types it serves`);
  }
  assert.equal(cardHref('profit-take-home/', { type: 'employee', profession: 'barber', types: ['solo', 'employee', 'owner'] }), 'profit-take-home/?type=employee&profession=barber');
  assert.equal(cardHref('discount-promotion/', { type: 'owner', profession: 'manicurist', types: ['solo', 'owner'] }), 'discount-promotion/?type=owner&profession=manicurist');
  assert.match(one(html, /(<a class="hub-card" href="profit-take-home\/"[^>]*>)/), /data-desc-employee="Estimate your take-home pay/);
});

test('calculator pages are not gated: worker-type selector plus a small profession selector, pre-set by the framework', async () => {
  const { PROFESSIONS } = await import('../assets/calc/ui/professions.js');
  assert.deepEqual(Object.entries(PROFESSIONS).map(([k, v]) => [k, v.label]), LICENSES, 'page options and the wording module agree');
  for (const c of CALCS) {
    const html = read(`resources/${c}/index.html`);
    assert.doesNotMatch(html, /data-hub-gate/, `${c}: never gated`);
    // every calculator offers every worker type except the ones only for those who pay rent and labor
    const types = SOLO_OWNER_ONLY.includes(c) ? ['solo', 'owner'] : ['solo', 'employee', 'owner'];
    for (const t of types) assert.match(html, new RegExp(`name="businessType" value="${t}"`), `${c}: ${t}`);
    if (!types.includes('employee')) assert.doesNotMatch(html, /name="businessType" value="employee"/, `${c}: no employee option`);
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
  ['profit-take-home', 'monthlyPay', 'Your monthly pay', 'solo'],
  ['profit-take-home', 'monthlyPayroll', 'Monthly payroll (wages + payroll taxes)', 'owner'],
  ['profit-take-home', 'commissionRate', 'Commission paid per service (%)', 'owner'],
  ['profit-take-home', 'ownerPay', 'Your monthly owner pay', 'owner'],
  ['price-increase', 'targetHourly', 'Your pay per hour', 'solo'],
  ['price-increase', 'providerWage', 'Provider’s hourly wage', 'owner'],
  ['price-increase', 'commissionRate', 'Commission paid per service (%)', 'owner'],
  ['discount-promotion', 'targetHourly', 'Your pay per hour', 'solo'],
  ['discount-promotion', 'providerWage', 'Provider’s hourly wage', 'owner'],
  ['discount-promotion', 'commissionRate', 'Commission paid per service (%)', 'owner'],
  ['menu-profitability', 'targetHourly', 'Your pay per hour', 'solo'],
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
    for (const name of ['monthlyPay', 'monthlyPayroll', 'ownerPay', 'providerWage', 'commissionRate', 'targetHourly']) {
      if (c === 'hourly-rate' && ['commissionRate', 'targetHourly'].includes(name)) continue; // hourly-rate's commission is the employee's own pay
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
  for (const c of CALCS) assert.match(read(`assets/calc/calculators/${c}.js`), /from '\.\.\/core\/(pricing|profit|breakeven|costs|capacity|discount|menu)\.js'/, c);
});

// ======================= Sprint 2 pages =======================
test('Sprint 2 pages: SEO title, meta description, H1 and JSON-LD name match each calculator', () => {
  const want = {
    'profit-take-home': ['Profit & Take-Home Pay Calculator for Beauty Pros | GLOWDEGA', 'Profit &amp; Take-Home Calculator'],
    'capacity-clients': ['Capacity & Clients Calculator for Beauty Businesses | GLOWDEGA', 'Capacity &amp; Clients Calculator'],
    'price-increase': ['Price Increase Calculator for Salons & Beauty Pros | GLOWDEGA', 'Price Increase Calculator'],
    'discount-promotion': ['Discount & Promotion Calculator for Beauty Businesses | GLOWDEGA', 'Discount &amp; Promotion Calculator'],
    'menu-profitability': ['Service Menu Profitability Analyzer for Beauty Pros | GLOWDEGA', 'Service Menu Profitability Analyzer'],
  };
  for (const [c, [title, h1]] of Object.entries(want)) {
    const html = read(`resources/${c}/index.html`);
    assert.equal(one(html, /<title>([^<]+)<\/title>/).replace(/&amp;/g, '&'), title, c);
    assert.equal(one(html, /<h1>([^<]+)<\/h1>/), h1, c);
    const nodes = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((m) => JSON.parse(m[1])['@graph'] || []);
    assert.equal(nodes.find((n) => n['@type'] === 'WebApplication').url, `https://www.glowdega.com/resources/${c}/`);
    assert.equal(nodes.find((n) => n['@type'] === 'WebApplication').name, h1.replace(/&amp;/g, '&'));
    assert.doesNotMatch(text(html), /coming soon/i, `${c}: a live page never says coming soon`);
  }
  // the pricing page's employee note now links the live take-home calculator instead of promising it
  const note = one(read('resources/service-pricing/index.html'), /<div class="calc-type-note" data-for-type="employee" hidden><p>(.*?)<\/p><\/div>/s);
  assert.match(note, /<a href="\.\.\/profit-take-home\/\?type=employee">Profit &amp; Take-Home Calculator<\/a>/);
});

test('profit & take-home page: accounting model stated in the copy; employee mode replaces the business inputs', () => {
  const html = read('resources/profit-take-home/index.html');
  const intro = text(one(html, /<div class="calc-intro">(.*?)<\/div>/s));
  assert.match(intro, /your pay is a business expense, business profit is what remains after every expense including your pay, and your take-home is your pay plus that profit, minus estimated taxes/);
  assert.match(intro, /counted once, never twice/);
  for (const n of ['monthlyPay', 'ownerPay']) assert.match(one(html, new RegExp(`id="f-${n}-hint">([^<]*)<`)), /counted once/, `${n}: hint explains the model`);
  const pay = one(html, /(<fieldset class="calc-type calc-choice"[^>]*>.*?<\/fieldset>)/s);
  assert.match(pay, /data-types="employee"/);
  assert.deepEqual([...pay.matchAll(/name="payType" value="(\w+)"/g)].map((m) => m[1]), ['hourly', 'commission', 'mixed']);
  const when = { revenueGenerated: 'payType:commission mixed', payCommissionRate: 'payType:commission mixed', hourlyWage: 'payType:hourly mixed',
    hoursWorked: 'payType:hourly mixed', hoursOptional: 'payType:commission' };
  for (const [n, w] of Object.entries(when)) {
    assert.equal(one(wrapperOf(html, n), /data-types="([^"]*)"/), 'employee', n);
    assert.equal(one(wrapperOf(html, n), /data-when="([^"]*)"/), w, n);
  }
  for (const n of ['tips', 'bonuses']) assert.match(wrapperOf(html, n), /data-types="employee"/, n);
  for (const n of ['serviceRevenue', 'productCosts', 'monthlyRent', 'fixedExpenses', 'retailRevenue', 'variableExpenses']) {
    assert.deepEqual(one(wrapperOf(html, n), /data-types="([^"]*)"/).split(' ').sort(), ['owner', 'solo'], `${n}: never for employees`);
  }
  assert.match(fieldOf(html, 'payCommissionRate'), /data-min-exclusive/, '0% commission is rejected on the page too');
  assert.match(fieldOf(html, 'serviceRevenue'), /data-required/);
});

test('capacity page: 60- or 90-minute service length choice, 20 working days, employee wording', () => {
  const html = read('resources/capacity-clients/index.html');
  const len = one(html, /(<fieldset class="calc-type calc-choice"><legend>Average service length<\/legend>.*?<\/fieldset>)/s);
  assert.ok(len, 'no service length choice for every type');
  assert.deepEqual([...len.matchAll(/name="serviceMinutes" value="(\d+)"/g)].map((m) => m[1]), ['60', '90']);
  assert.match(len, /value="60" checked/);
  assert.match(fieldOf(html, 'workingDaysPerMonth'), /value="20"/);
  assert.match(fieldOf(html, 'averageTicket'), /data-min-message="Enter an average service price greater than \$0\."/);
  assert.match(fieldOf(html, 'revenueGoal'), /data-label-employee="Monthly service revenue goal"/);
  for (const n of ['currentClients', 'currentTicket']) assert.ok(html.indexOf(`name="${n}"`) > html.indexOf('class="calc-advanced"'), `${n} is optional, under Customize`);
});

test('discount and price-increase pages: 30% target-margin floor, discount below 100%, per-service rent and labor', () => {
  const disc = read('resources/discount-promotion/index.html');
  const m = fieldOf(disc, 'targetMargin');
  for (const re of [/value="30"/, /data-min="30"/, /data-min-message="Enter a profit margin of at least 30%\."/, /data-required/]) assert.match(m, re);
  assert.match(fieldOf(disc, 'discountRate'), /data-max="100" data-max-exclusive/);
  assert.match(fieldOf(disc, 'promoAppointments'), /placeholder="25"/);
  for (const c of ['discount-promotion', 'price-increase']) {
    const html = read(`resources/${c}/index.html`);
    assert.match(fieldOf(html, 'durationMinutes'), /data-required/, `${c}: rent and labor are shared by time`);
    assert.doesNotMatch(html, /name="monthlyPay"/, `${c}: one solo labor input (pay per hour), never two`);
  }
  assert.match(fieldOf(read('resources/price-increase/index.html'), 'expectedLoss'), /data-max="100" data-max-exclusive/);
});

test('menu page: dynamic service rows; wage and commission columns are owners’ only; solo pay per hour is one field', () => {
  const html = read('resources/menu-profitability/index.html');
  assert.match(html, /<div class="calc-rows calc-rows--menu" role="group" aria-label="Services on your menu"><\/div>/);
  assert.match(html, /data-action="add-row">\+ Add a service<\/button>/);
  const tpl = one(html, /(<template id="calc-row-template">.*?<\/template>)/s);
  assert.deepEqual([...tpl.matchAll(/data-col="(\w+)"/g)].map((m) => m[1]), ['name', 'price', 'duration', 'product', 'supply', 'wage', 'commission']);
  for (const col of ['wage', 'commission']) assert.match(tpl, new RegExp(`<div class="calc-row__cell" data-owner-only><label data-for="${col}">`), col);
  for (const col of ['name', 'price', 'duration', 'product', 'supply']) assert.doesNotMatch(tpl, new RegExp(`data-owner-only><label data-for="${col}"`), col);
  for (const col of ['price', 'duration', 'product', 'supply', 'wage', 'commission']) assert.match(tpl, new RegExp(`data-col="${col}" type="text" inputmode="decimal"`), col);
  assert.match(tpl, /placeholder="60"/, 'example durations stay at 60 minutes');
  assert.match(read('assets/style.css'), /\.calc:not\(\[data-type="owner"\]\) \[data-owner-only\]\{display:none\}/, 'solo providers never see wage or commission');
  assert.match(html, /data-for-type="owner" hidden><p>Enter each service’s provider wage/);
  const mod = read('assets/calc/calculators/menu-profitability.js');
  assert.match(mod, /if \(ownerOnly && !owner\) continue;/, 'row wage and commission are read for owners only');
});
