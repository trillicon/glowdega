import { mountCalculator } from '../ui/framework.js';
import { calculateServiceCost } from '../core/costs.js';
import { parseNumber } from '../core/validation.js';
import { formatMoney as money, formatNumber } from '../core/money.js';
import { formatPercent } from '../core/percentages.js';

const LABEL = { product: 'Product', supply: 'Supplies', other: 'Other consumable' };
const QTY = { name: 'a quantity', unit: 'number', max: 100000 };
const COST = { name: 'a unit cost', unit: 'money', max: 1000000 };
let uid = 0;

/** Line items: rows that are completely blank are skipped; a cost with no quantity is an error, never a silent 0. */
function readRows(root) {
  const values = {}, errors = {}, items = [], meta = [];
  for (const row of root.querySelectorAll('.calc-row')) {
    const [cat, name, qty, cost] = ['select', '[data-col="name"]', '[data-col="qty"]', '[data-col="cost"]'].map((s) => row.querySelector(s));
    qty.dataset.key = ''; cost.dataset.key = '';
    if (!qty.value.trim() && !cost.value.trim()) continue;
    const i = items.length;
    qty.dataset.key = `quantity-${i}`; cost.dataset.key = `unitCost-${i}`;
    const q = qty.value.trim() ? parseNumber(qty.value, QTY) : { ok: false, error: 'Enter a quantity (for example 1, or 0.5 for half).' };
    const c = parseNumber(cost.value, COST);
    if (!q.ok) errors[`quantity-${i}`] = q.error;
    if (!c.ok) errors[`unitCost-${i}`] = c.error;
    items.push({ category: cat.value, quantity: q.ok ? q.value : 0, unitCost: c.ok ? c.value : 0 });
    meta.push({ name: name.value.trim() || LABEL[cat.value], category: cat.value, qty: qty.value.trim(), cost: cost.value.trim() });
  }
  values.items = items; values.meta = meta;
  return { values, errors };
}

function addRow(root, category = 'product') {
  const tpl = root.querySelector('#calc-row-template');
  const row = tpl.content.firstElementChild.cloneNode(true);
  const n = ++uid;
  for (const input of row.querySelectorAll('[data-col]')) {
    const id = `row${n}-${input.dataset.col}`;
    input.id = id;
    row.querySelector(`label[data-for="${input.dataset.col}"]`)?.setAttribute('for', id);
    const err = input.parentElement.querySelector('.calc-error');
    if (err) { err.id = id + '-error'; input.setAttribute('aria-describedby', err.id); }
  }
  row.querySelector('select').value = category;
  root.querySelector('.calc-rows').append(row);
  return row;
}

mountCalculator({
  readExtra: readRows,
  printExtra: (root) => readRows(root).values.meta.map((m) => [`${m.name} (${LABEL[m.category].toLowerCase()})`, `${m.qty} × $${m.cost}`]),
  onReady(root, recalc) {
    const rows = root.querySelector('.calc-rows');
    for (const cat of ['product', 'product', 'supply', 'other']) addRow(root, cat);
    root.querySelector('[data-action="add-row"]').addEventListener('click', () => addRow(root).querySelector('[data-col="name"]').focus());
    rows.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action="remove-row"]');
      if (!b) return;
      const row = b.closest('.calc-row');
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      if (!rows.children.length) addRow(root);
      (next || rows.querySelector('.calc-row'))?.querySelector('[data-col="name"]')?.focus();
      recalc();
    });
  },
  compute({ values: v, type }) {
    const employee = type === 'employee'; // the business pays the rent: employees see products and supplies only
    const r = calculateServiceCost({ items: v.items, monthlyRent: employee ? 0 : v.monthlyRent,
      hoursPerMonth: employee ? undefined : v.hoursPerMonth, durationMinutes: employee ? 0 : v.durationMinutes });
    if (!r.ok) return r;
    if (!(r.trueCost > 0)) return { ok: false, errors: { _: 'Add at least one item with a cost to see your total.' } };
    const hasRent = r.rentShare > 0;
    const top = r.largestIndex;
    let insight = r.consumableCost > 0 && v.items.length > 1
      ? `${v.meta[top].name} is the biggest product or supply cost in this service at ${money(r.lines[top], { cents: true })}, ${formatPercent(r.largestShare)} of products and supplies.`
      : `This service uses ${money(r.consumableCost, { cents: true })} in products and supplies every time you perform it.`;
    if (hasRent) insight += ` Rent adds ${money(r.rentShare, { cents: true })}, for a true cost of ${money(r.trueCost, { cents: true })}.`;
    const cards = [
      { label: 'Total product cost', value: money(r.productCost, { cents: true }) },
      { label: 'Total supply cost', value: money(r.supplyCost, { cents: true }), note: r.otherCost > 0 ? `Includes ${money(r.otherCost, { cents: true })} other consumables` : 'Supplies and other consumables' },
    ];
    if (!employee) cards.push({ label: 'Rent share', value: money(r.rentShare, { cents: true }),
      note: hasRent ? `${money(r.rentPerHour, { cents: true })}/hour × ${formatNumber(v.durationMinutes, 0)} minutes` : 'No rent entered' });
    cards.push({ label: 'Items counted', value: formatNumber(r.itemCount, 0) });
    const method = [
      'Each line: quantity used × unit cost. For a product you buy in bulk, unit cost is the price of one use (bottle price ÷ number of uses).',
      'Total product cost adds every “Product” line; total supply cost adds “Supplies” and “Other consumable” lines.',
    ];
    if (employee) {
      method.push('True cost = product cost + supply cost. Rent is paid by the business you work for, so it is not added here.');
    } else {
      method.push(hasRent
        ? `Rent share: ${money(v.monthlyRent)} rent ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(r.rentPerHour, { cents: true })}/hour, × ${formatNumber(v.durationMinutes, 0)} minutes = ${money(r.rentShare, { cents: true })}.`
        : 'No rent was entered, so the rent share is $0.');
      method.push('True cost = product cost + supply cost + rent share. It does not include your time, other expenses or card fees; the Service Pricing Calculator adds those.');
    }
    // Pricing gets each part in its own field: products and supplies as product cost, rent with its hours and duration,
    // so nothing is counted twice.
    const pricing = new URLSearchParams({ productCost: r.consumableCost.toFixed(2) });
    if (!employee) {
      if (v.durationMinutes > 0) pricing.set('durationMinutes', String(v.durationMinutes));
      if (hasRent) { pricing.set('monthlyRent', String(v.monthlyRent)); pricing.set('hoursPerMonth', String(v.hoursPerMonth)); }
      pricing.set('type', type);
    }
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(r.trueCost, { cents: true }), label: employee || !hasRent ? 'True product and supply cost per service' : 'True cost per service (products, supplies and rent)' },
        cards, insight, method,
        cta: { href: `../service-pricing/?${pricing}`, text: 'Use this cost in the Service Pricing Calculator →' },
        share: { value: money(r.trueCost, { cents: true }), label: hasRent ? 'True cost per service, rent included' : 'True cost of products and supplies per service', insight: 'Every service has a cost before it has a price.' },
      },
    };
  },
});
