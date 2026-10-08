import { mountCalculator } from '../ui/framework.js';
import { calculateServiceCost } from '../core/costs.js';
import { parseNumber } from '../core/validation.js';
import { formatMoney as money, formatNumber } from '../core/money.js';
import { formatPercent, toRate } from '../core/percentages.js';
import { serviceText, signatureService } from '../ui/professions.js';

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
    const err = input.closest('.calc-row__cell').querySelector('.calc-error'); // the $-wrapped input's error sits beside its wrapper
    if (err) { err.id = id + '-error'; input.setAttribute('aria-describedby', err.id); }
  }
  row.querySelector('select').value = category;
  root.querySelector('.calc-rows').append(row);
  return row;
}

export const config = mountCalculator({
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
  compute({ values: v, type, profession }) {
    // solo providers and owners only: an employee's business pays the rent and labor, so there is no employee option here
    const owner = type === 'owner';
    // labor, each type in its own field: solo = monthly pay ÷ hours a month × duration; owner = wage × duration + commission
    const r = calculateServiceCost({ items: v.items, monthlyRent: v.monthlyRent,
      hoursPerMonth: v.hoursPerMonth, durationMinutes: v.durationMinutes,
      monthlyPay: owner ? 0 : v.monthlyPay, providerWage: owner ? v.providerWage : 0,
      commissionRate: owner ? toRate(v.commissionRate) : 0, price: owner ? v.price : 0 });
    if (!r.ok) return r;
    if (!(r.trueCost > 0)) return { ok: false, errors: { _: 'Add at least one item with a cost to see your total.' } };
    const hasRent = r.rentShare > 0;
    const hasLabor = r.labor > 0;
    const top = r.largestIndex;
    const service = serviceText(profession, v.durationMinutes || signatureService(profession).minutes);
    let insight = r.consumableCost > 0 && v.items.length > 1
      ? `${v.meta[top].name} is the biggest product or supply cost in this ${service.name} at ${money(r.lines[top], { cents: true })}, ${formatPercent(r.largestShare)} of products and supplies.`
      : `This ${service.name} uses ${money(r.consumableCost, { cents: true })} in products and supplies every time you perform it.`;
    if (hasRent || hasLabor) {
      const adds = [hasRent ? `rent adds ${money(r.rentShare, { cents: true })}` : '', hasLabor ? `${owner ? 'labor' : 'your pay'} adds ${money(r.labor, { cents: true })}` : ''].filter(Boolean).join(' and ');
      insight += ` ${adds[0].toUpperCase()}${adds.slice(1)}, for a true cost of ${money(r.trueCost, { cents: true })}.`;
    }
    if (r.commissionNeedsPrice) insight += ' Commission is a share of the price, so enter the service price to include it.';
    const mins = `${formatNumber(v.durationMinutes, 0)} minutes`;
    const cards = [
      { label: 'Total product cost', value: money(r.productCost, { cents: true }) },
      { label: 'Total supply cost', value: money(r.supplyCost, { cents: true }), note: r.otherCost > 0 ? `Includes ${money(r.otherCost, { cents: true })} other consumables` : 'Supplies and other consumables' },
    ];
    {
      cards.push({ label: 'Rent share', value: money(r.rentShare, { cents: true }),
        note: hasRent ? `${money(r.rentPerHour, { cents: true })}/hour × ${mins}` : 'No rent entered' });
      const laborNote = owner
        ? [r.laborTime > 0 ? `${money(r.laborPerHour, { cents: true })}/hour wage × ${mins}` : '', r.commission > 0 ? `${money(r.commission, { cents: true })} commission` : '',
          r.commissionNeedsPrice ? 'commission needs a service price' : ''].filter(Boolean).join(' + ') || 'No wage or commission entered'
        : hasLabor ? `${money(r.payPerHour, { cents: true })}/hour × ${mins}` : 'No monthly pay entered';
      cards.push({ label: owner ? 'Labor' : 'Your pay (labor)', value: money(r.labor, { cents: true }), note: laborNote });
    }
    cards.push({ label: 'Items counted', value: formatNumber(r.itemCount, 0) });
    const method = [
      'Each line: quantity used × unit cost. For a product you buy in bulk, unit cost is the price of one use (bottle price ÷ number of uses).',
      'Total product cost adds every “Product” line; total supply cost adds “Supplies” and “Other consumable” lines.',
    ];
    {
      method.push(hasRent
        ? `Rent share: ${money(v.monthlyRent)} rent ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(r.rentPerHour, { cents: true })}/hour, × ${mins} = ${money(r.rentShare, { cents: true })}.`
        : 'No rent was entered, so the rent share is $0.');
      method.push(owner
        ? `Labor: ${money(r.laborPerHour, { cents: true })}/hour provider wage × ${mins} = ${money(r.laborTime, { cents: true })}` +
          (r.commissionNeedsPrice ? '. Commission is a share of the price; no price was entered, so it is not included yet.'
            : `, + ${formatPercent(toRate(v.commissionRate), 1)} commission on a ${money(v.price)} price = ${money(r.commission, { cents: true })}.`)
        : hasLabor
          ? `Your pay (labor): ${money(v.monthlyPay)} monthly pay ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(r.payPerHour, { cents: true })}/hour, × ${mins} = ${money(r.labor, { cents: true })}.`
          : 'No monthly pay was entered, so your time adds $0. Add it to see the full cost of your time.');
      method.push('True cost = product cost + supply cost + rent share + labor. Other expenses, card fees and profit are added by the Service Pricing Calculator.');
    }
    // Pricing gets each part in its own field: products and supplies as product cost, rent with its hours and duration,
    // and labor as pay per hour (solo) or wage + commission (owner), so nothing is counted twice.
    const pricing = new URLSearchParams({ productCost: r.consumableCost.toFixed(2) });
    {
      if (v.durationMinutes > 0) pricing.set('durationMinutes', String(v.durationMinutes));
      if (hasRent) { pricing.set('monthlyRent', String(v.monthlyRent)); pricing.set('hoursPerMonth', String(v.hoursPerMonth)); }
      if (owner) {
        if (v.providerWage > 0) pricing.set('providerWage', String(v.providerWage));
        if (v.commissionRate > 0) pricing.set('commissionRate', String(v.commissionRate));
        if (v.price > 0) pricing.set('currentPrice', String(v.price));
      } else if (r.payPerHour > 0) {
        pricing.set('targetHourly', r.payPerHour.toFixed(2));
      }
      pricing.set('type', type);
    }
    if (profession) pricing.set('profession', profession);
    const parts = [hasRent ? 'rent' : '', hasLabor ? 'labor' : ''].filter(Boolean).join(' and ');
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(r.trueCost, { cents: true }), label: !hasRent && !hasLabor ? 'True product and supply cost per service' : `True cost per service (products, supplies, ${parts})` },
        cards, insight, method,
        cta: { href: `../service-pricing/?${pricing}`, text: 'Use this cost in the Service Pricing Calculator →' },
        share: { value: money(r.trueCost, { cents: true }), label: hasRent || hasLabor ? `True cost of a ${service.phrase}, ${parts} included` : `True cost of products and supplies for a ${service.phrase}`, insight: 'Every service has a cost before it has a price.' },
      },
    };
  },
});
