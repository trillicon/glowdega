// Shared calculator framework: business-type selector, input reading + validation, result panel, print, share, email.
// Calculator files (assets/calc/calculators/*.js) only map inputs to an engine function and its result to a view.
// No financial formulas live here.
import { parseNumber, hasBadNumber } from '../core/validation.js';
import { shareResults, wireSharePanel, emailHref } from './share.js';
import { PROFESSIONS, PROFESSION_KEY, TYPE_KEY as AUDIENCE_KEY, TYPES, professionOf, profText, savedChoice, saveChoice } from './professions.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const savedAudience = () => savedChoice(AUDIENCE_KEY);
const saveAudience = (type) => saveChoice(AUDIENCE_KEY, type);

function ruleOf(input) {
  const d = input.dataset;
  return {
    name: d.name || input.name, unit: d.unit || 'number', required: 'required' in d,
    min: d.min !== undefined ? Number(d.min) : 0, minExclusive: 'minExclusive' in d, minMessage: d.minMessage,
    max: d.max !== undefined ? Number(d.max) : undefined, maxExclusive: 'maxExclusive' in d, integer: 'integer' in d,
  };
}

/** Text of a view must never show NaN, Infinity or undefined. */
const badText = (s) => /NaN|Infinity|undefined/.test(s);

/**
 * Mounts the calculator on the page and returns its config. Outside a browser (the Node tests import the calculator
 * modules to run their compute() directly) there is no document, so it only returns the config.
 */
export function mountCalculator(config) {
  if (typeof document === 'undefined') return config;
  const root = document.querySelector('[data-calc]');
  if (!root) return config;
  const form = root.querySelector('.calc-form');
  const output = root.querySelector('.calc-output');
  const actions = root.querySelector('.calc-actions');
  const panel = root.querySelector('.calc-share-panel');
  const name = root.dataset.calcName;
  const pageUrl = location.origin + location.pathname;
  const fieldInputs = () => [...form.querySelectorAll('.calc-field input[data-name]')].filter((i) => !i.closest('[hidden]') && !i.disabled);
  let calculated = false, lastView = null, timer = 0;

  // ---------- prefill from the URL (?productCost=12.50&type=owner); values are validated like typed input ----------
  const params = new URLSearchParams(location.search);
  for (const input of form.querySelectorAll('.calc-field input[data-name]')) {
    const v = params.get(input.name);
    if (v !== null && v.length < 30) input.value = v;
    if (v !== null) input.closest('details')?.setAttribute('open', '');
  }

  // ---------- business type ----------
  const radios = [...form.querySelectorAll('input[name="businessType"]')];
  const typeOf = () => radios.find((r) => r.checked)?.value || null;
  function applyType(type) {
    root.dataset.type = type || '';
    const unsupported = (config.unsupportedTypes || []).includes(type);
    // data-types="solo owner": only for those business types. data-when="payType:commission mixed": only while that
    // choice is selected. An element with both needs both.
    for (const f of form.querySelectorAll('[data-types], [data-when]')) {
      const typeOk = !f.dataset.types || (!unsupported && f.dataset.types.split(' ').includes(type));
      const [choice, wanted = ''] = (f.dataset.when || '').split(':');
      const whenOk = !choice || wanted.split(' ').includes(form.querySelector(`input[name="${choice}"]:checked`)?.value);
      const show = typeOk && whenOk;
      f.hidden = !show;
      for (const i of f.querySelectorAll('input,select,button')) i.disabled = !show;
    }
    for (const lab of form.querySelectorAll('[data-label-' + type + ']')) lab.textContent = lab.dataset['label' + type[0].toUpperCase() + type.slice(1)];
    for (const lab of form.querySelectorAll('[data-label-default]')) if (!lab.hasAttribute('data-label-' + type)) lab.textContent = lab.dataset.labelDefault;
    for (const n of root.querySelectorAll('[data-for-type]')) n.hidden = n.dataset.forType !== type;
    const body = form.querySelector('.calc-body');
    if (body) body.hidden = unsupported;
    if (unsupported) { clearResult(); calculated = false; }
    else if (calculated) run(false);
  }
  if (radios.length) {
    for (const lab of form.querySelectorAll('[data-label-solo],[data-label-owner],[data-label-employee]')) lab.dataset.labelDefault = lab.textContent;
    const wanted = [params.get('type'), savedAudience()].find((t) => TYPES.includes(t) && radios.some((r) => r.value === t));
    (radios.find((r) => r.value === wanted) || radios[0]).checked = true;
    radios.forEach((r) => r.addEventListener('change', () => { saveAudience(r.value); applyType(r.value); }));
    applyType(typeOf());
  }
  // ---------- profession: wording only (example services in hints, insights and share text); never the numbers ----------
  const profSelect = form.querySelector('select[name="profession"]');
  const professionNow = () => professionOf(profSelect?.value);
  // A 60/90 choice marked data-prof-default follows the license's signature length until the visitor picks one.
  const profDefaults = [...form.querySelectorAll('[data-prof-default]')];
  for (const g of profDefaults) g.addEventListener('change', (e) => { if (e.isTrusted) g.dataset.touched = '1'; });
  function applyProfession() {
    const p = professionNow();
    for (const n of root.querySelectorAll('[data-prof]')) n.textContent = profText(n.dataset.prof, p);
    for (const i of root.querySelectorAll('[data-prof-placeholder]')) i.placeholder = profText(i.dataset.profPlaceholder, p);
    for (const g of profDefaults) {
      if (g.dataset.touched || params.has(g.querySelector('input')?.name)) continue;
      const want = g.querySelector(`input[value="${CSS.escape(profText(g.dataset.profDefault, p))}"]`);
      if (want) want.checked = true;
    }
    config.onProfession?.(root, p);
  }
  if (profSelect) {
    const wanted = [params.get('profession'), savedChoice(PROFESSION_KEY)].find((p) => Object.hasOwn(PROFESSIONS, p || ''));
    if (wanted) profSelect.value = wanted;
    profSelect.addEventListener('change', () => { saveChoice(PROFESSION_KEY, profSelect.value); applyProfession(); if (calculated) run(false); });
    applyProfession();
  }

  // a choice other fields depend on (data-when) re-applies visibility and recalculates
  form.addEventListener('change', (e) => {
    const n = e.target.name;
    if (n && n !== 'businessType' && e.target.type === 'radio' && form.querySelector(`[data-when^="${n}:"]`)) applyType(typeOf());
  });

  // ---------- validation ----------
  function showError(input, message) {
    const err = document.getElementById(input.id + '-error');
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    input.closest('.calc-field, .calc-row')?.classList.toggle('has-error', !!message);
    if (err) { err.textContent = message || ''; err.hidden = !message; }
  }
  function read() {
    const values = {}, errors = {};
    for (const input of fieldInputs()) {
      const r = parseNumber(input.value, ruleOf(input));
      if (r.ok) values[input.name] = r.value; else errors[input.name] = r.error;
    }
    if (config.readExtra) {
      const extra = config.readExtra(root);
      Object.assign(values, extra.values);
      Object.assign(errors, extra.errors);
    }
    return { values, errors };
  }
  function markErrors(errors) {
    for (const input of form.querySelectorAll('input[data-name], .calc-row input, .calc-row select')) showError(input, errors[input.name] || errors[input.dataset.key]);
    const first = Object.keys(errors).length ? form.querySelector('[aria-invalid="true"]') : null;
    return first;
  }

  // ---------- results ----------
  function clearResult(message) {
    output.replaceChildren(el('p', 'calc-empty', message || 'Enter your numbers and select Calculate to see your results.'));
    actions.hidden = true;
    if (panel) panel.hidden = true;
    lastView = null;
  }
  function card({ label, value, note, loss }) {
    const c = el('div', 'calc-card' + (loss ? ' is-loss' : ''));
    c.append(el('div', 'calc-card__label', label), el('div', 'calc-card__value', value));
    if (note) c.append(el('div', 'calc-card__note', note));
    return c;
  }
  function render(view) {
    const nodes = [];
    const primary = el('div', 'calc-primary' + (view.primary.loss ? ' is-loss' : ''));
    primary.append(el('div', 'calc-primary__value', view.primary.value), el('div', 'calc-primary__label', view.primary.label));
    if (view.primary.note) primary.append(el('div', 'calc-primary__note', view.primary.note));
    nodes.push(primary);
    if (view.insight) nodes.push(el('p', 'calc-insight', view.insight));
    if (view.cards?.length) {
      const grid = el('div', 'calc-cards');
      grid.append(...view.cards.map(card));
      nodes.push(grid);
    }
    // extraNode is built lazily (it needs the DOM), so compute() stays runnable outside a browser
    const extra = typeof view.extraNode === 'function' ? view.extraNode() : view.extraNode;
    if (extra) nodes.push(extra);
    if (view.cta) {
      const p = el('p', 'calc-next');
      const a = el('a', 'cta', view.cta.text);
      a.href = view.cta.href;
      p.append(a);
      nodes.push(p);
    }
    if (view.method?.length) {
      const d = el('details', 'calc-method');
      d.append(el('summary', '', 'How we calculated this'));
      const ul = el('ul');
      ul.append(...view.method.map((m) => el('li', '', m)));
      d.append(ul);
      nodes.push(d);
    }
    nodes.push(printInputs());
    output.replaceChildren(...nodes);
    actions.hidden = false;
  }
  function printInputs() {
    const wrap = el('div', 'calc-print-inputs print-only');
    wrap.append(el('h3', '', 'Your inputs'));
    const dl = el('dl');
    const type = radios.find((r) => r.checked);
    if (type) dl.append(el('dt', '', 'You are'), el('dd', '', type.closest('label').textContent.trim()));
    if (profSelect) dl.append(el('dt', '', 'License'), el('dd', '', PROFESSIONS[professionNow()].label));
    for (const input of fieldInputs()) {
      if (!input.value.trim()) continue;
      const label = form.querySelector(`label[for="${input.id}"] .calc-label`)?.textContent || input.name;
      const unit = input.dataset.unit;
      dl.append(el('dt', '', label), el('dd', '', (unit === 'money' ? '$' : '') + input.value.trim() + (unit === 'percent' ? '%' : '')));
    }
    for (const line of config.printExtra?.(root) || []) dl.append(el('dt', '', line[0]), el('dd', '', line[1]));
    wrap.append(dl);
    return wrap;
  }

  function run(focusOnError) {
    if ((config.unsupportedTypes || []).includes(typeOf())) return;
    const { values, errors } = read();
    let first = markErrors(errors);
    if (!first) {
      const res = config.compute({ values, type: typeOf(), root, profession: professionNow() });
      if (!res.ok) {
        first = markErrors(res.errors);
        if (!first) { clearResult(Object.values(res.errors)[0]); return false; }
      } else {
        const text = JSON.stringify(res.view);
        if (badText(text) || (res.raw && hasBadNumber(res.raw))) {
          clearResult('Something in these numbers can’t be calculated. Check your inputs and try again.');
          return false;
        }
        lastView = res.view;
        render(res.view);
        calculated = true;
        return true;
      }
    }
    clearResult('Fix the highlighted ' + (Object.keys(errors).length > 1 ? 'fields' : 'field') + ' to see your results.');
    if (focusOnError && first) first.focus();
    return false;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (run(true)) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // on phones the results sit below the form: bring them into view so nobody scrolls hunting for them
      if (matchMedia('(max-width: 900px)').matches) root.querySelector('.calc-results').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  });
  form.addEventListener('input', () => {
    if (!calculated) return;
    clearTimeout(timer);
    timer = setTimeout(() => run(false), 350);
  });
  config.onReady?.(root, () => { if (calculated) run(false); });
  config.onProfession?.(root, professionNow()); // rows added by onReady take the license's examples too

  // ---------- actions ----------
  const shareData = () => ({ name, url: pageUrl, view: lastView });
  // Printouts carry the date and the full method, whether printed from the button or the browser menu.
  window.addEventListener('beforeprint', () => {
    const stamp = document.querySelector('.calc-print-date');
    if (stamp) stamp.textContent = 'Generated ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    for (const d of output.querySelectorAll('details.calc-method')) d.open = true;
  });
  root.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
  root.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
    if (!lastView) return;
    const shared = await shareResults(shareData());
    if (!shared && panel) { panel.hidden = false; panel.querySelector('button, a')?.focus(); }
  });
  root.querySelector('[data-action="more"]')?.addEventListener('click', () => { if (panel) { panel.hidden = !panel.hidden; } });
  root.querySelector('[data-action="email"]')?.addEventListener('click', (e) => {
    if (!lastView) { e.preventDefault(); return; }
    e.currentTarget.href = emailHref(shareData());
  });
  if (panel) wireSharePanel(panel, shareData);

  // If the page opened with prefilled values, show their result straight away.
  if ([...params.keys()].some((k) => form.querySelector(`.calc-field input[name="${CSS.escape(k)}"]`))) run(false);
}
