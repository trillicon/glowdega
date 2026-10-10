import { mountCalculator } from '../ui/framework.js';
import { calculateMenuProfitability, MAX_MENU_SERVICES, SIMILAR_SHARE } from '../core/menu.js';
import { parseNumber } from '../core/validation.js';
import { formatMoney as money, formatNumber, describeProfit } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';
import { signatureService, sampleServices, professionOf } from '../ui/professions.js';
import { MIN_PROFIT_MARGIN, marginBelowText } from '../core/pricing.js';

const MONEY = (name) => ({ name, unit: 'money', max: 10_000_000 });
// [column, engine key, rule, required, owner only]
const COLS = [
  ['price', 'price', { ...MONEY('a price'), minExclusive: true, required: true }],
  ['duration', 'durationMinutes', { name: 'a duration in minutes', unit: 'minutes', minExclusive: true, required: true, max: 1440 }],
  ['product', 'productCost', MONEY('a product cost')],
  ['supply', 'supplyCost', MONEY('a supply cost')],
  ['wage', 'laborHourly', MONEY('an hourly wage'), true],
  ['commission', 'commissionRate', { name: 'a commission', unit: 'percent', max: 100, maxExclusive: true }, true],
];
let uid = 0;

/** One service per row. Rows with no name, price or duration are skipped; a half-filled row is an error, never a silent 0. */
function readRows(root) {
  const owner = root.dataset.type === 'owner';
  const errors = {}, services = [];
  for (const row of root.querySelectorAll('.calc-row')) {
    const cell = (c) => row.querySelector(`[data-col="${c}"]`);
    for (const [c] of COLS) cell(c).dataset.key = '';
    const used = ['name', 'price', 'duration', 'product', 'supply'].some((c) => cell(c).value.trim());
    if (!used) continue;
    const i = services.length;
    const s = { name: cell('name').value.trim() };
    for (const [c, key, rule, ownerOnly] of COLS) {
      if (ownerOnly && !owner) continue;
      const input = cell(c);
      input.dataset.key = `${key}-${i}`;
      const res = parseNumber(input.value, rule);
      if (res.ok) s[key] = res.value; else { errors[`${key}-${i}`] = res.error; s[key] = 0; }
    }
    services.push(s);
  }
  return { values: { services }, errors };
}

/** Row placeholders are the license's own services, in list order: Silk Press 90, Curly Cut 90… for a hairstylist. */
function onProfession(root, profession) {
  const samples = sampleServices(profession, Infinity);
  [...root.querySelectorAll('.calc-row')].forEach((row, i) => {
    const s = samples[i % samples.length];
    row.querySelector('[data-col="name"]').placeholder = `e.g. ${s.name}`;
    row.querySelector('[data-col="duration"]').placeholder = String(s.minutes);
  });
}
const professionIn = (root) => professionOf(root.querySelector('select[name="profession"]')?.value);

function addRow(root) {
  const rows = root.querySelector('.calc-rows');
  if (rows.children.length >= MAX_MENU_SERVICES) return null;
  const row = root.querySelector('#calc-row-template').content.firstElementChild.cloneNode(true);
  const n = ++uid;
  for (const input of row.querySelectorAll('[data-col]')) {
    const id = `svc${n}-${input.dataset.col}`;
    input.id = id;
    row.querySelector(`label[data-for="${input.dataset.col}"]`)?.setAttribute('for', id);
    const err = input.closest('.calc-row__cell').querySelector('.calc-error');
    if (err) { err.id = id + '-error'; input.setAttribute('aria-describedby', err.id); }
  }
  rows.append(row);
  onProfession(root, professionIn(root));
  return row;
}

const quote = (s) => `“${s.name}”`;
const names = (r, idx) => idx.map((i) => quote(r.services.find((s) => s.index === i)));
const perAppt = (x) => { const d = describeProfit(x); return d.loss ? `loss of ${money(d.amount, { cents: true })} an appointment` : `${money(d.amount, { cents: true })} an appointment`; };
const perHour = (x) => { const d = describeProfit(x); return d.loss ? `loss of ${money(d.amount)}/hour` : `${money(d.amount)}/hour`; };

/**
 * Plain observations from the rankings. Wording stays descriptive ("may be worth a look") because a lower-earning
 * service can still have a reason to be on the menu; only a loss is called out more firmly.
 */
/** The orange-box line for a menu with a problem service: losses first, then break-even, then margins under 30%. */
export function menuWarning(r) {
  const by = (i) => r.services.find((s) => s.index === i);
  if (r.lossIndexes.length) return `${names(r, r.lossIndexes).join(', ')} ${r.lossIndexes.length === 1 ? 'loses' : 'lose'} money at current numbers, so ${r.lossIndexes.length === 1 ? 'it may be the first one' : 'they may be the first ones'} worth reviewing.`;
  const even = r.services.filter((s) => s.status === 'even');
  if (even.length) return `${even.map(quote).join(', ')} ${even.length === 1 ? 'breaks' : 'break'} even: costs and labor are covered with nothing left over.`;
  const i = r.belowMinimumIndexes[0];
  return i === undefined ? null : `${quote(by(i))} earns a profit, but its ${marginBelowText(by(i).margin)} margin is below the ${formatPercent(MIN_PROFIT_MARGIN)} minimum. The Service Pricing Calculator finds a price that keeps at least ${formatPercent(MIN_PROFIT_MARGIN)}.`;
}

export function recommendations(r) {
  const by = (i) => r.services.find((s) => s.index === i);
  const thin = (i) => `${quote(by(i))} earns a profit, but its ${marginBelowText(by(i).margin)} margin is below the ${formatPercent(MIN_PROFIT_MARGIN)} minimum. The Service Pricing Calculator finds a price that keeps at least ${formatPercent(MIN_PROFIT_MARGIN)}.`;
  if (!r.comparing) {
    const only = r.services[0];
    const first = r.lossIndexes.length ? [`${quote(only)} loses money at its current price, length and costs.`]
      : only.status === 'even' ? [`${quote(only)} breaks even: it covers its costs and labor with nothing left over.`]
        : r.belowMinimumIndexes.length ? [thin(only.index)] : [];
    return [...first, `Add another service to compare and rank your menu.`];
  }
  const k = r.rankings;
  const out = [];
  const lead = (rank, what) => (rank.tiedWith.length
    ? `${[quote(by(rank.index)), ...names(r, rank.tiedWith)].join(' and ')} tie for ${what}.`
    : `Your ${quote(by(rank.index))} service generates ${what}.`);
  if (r.similar) {
    out.push(`Your services earn a similar profit per hour (within ${formatPercent(SIMILAR_SHARE)} of each other), so none stands out as clearly stronger or weaker.`);
  } else if (k.profit.index === k.profitPerHour.index && !k.profit.tiedWith.length && !k.profitPerHour.tiedWith.length) {
    out.push(`Your ${quote(by(k.profit.index))} service leads on both profit per appointment and profit per hour.`);
  } else {
    out.push(lead(k.profit, 'the most profit per appointment'), lead(k.profitPerHour, 'the highest profit per hour'));
  }
  const low = by(k.lowest.index);
  if (r.lossIndexes.includes(low.index)) out.push(`${quote(low)} loses money at its current price, length and costs, so it may be the first one worth reviewing.`);
  else if (!r.similar) out.push(`${quote(low)} earns the least per hour (${perHour(low.profitPerHour)}). If that gap matters to you, its price or duration may be worth a look.`);
  const otherLosses = r.lossIndexes.filter((i) => i !== low.index);
  if (otherLosses.length) out.push(`${names(r, otherLosses).join(', ')} ${otherLosses.length === 1 ? 'also loses' : 'also lose'} money at current numbers.`);
  // the shared 30% rule: a service that makes money on a thinner margin is not counted as profitable
  for (const i of r.belowMinimumIndexes) out.push(thin(i));
  return out;
}

function menuNode(r, recs) {
  const frag = document.createElement('div');
  const ul = document.createElement('ul');
  ul.className = 'calc-recs';
  for (const t of recs) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
  const wrap = document.createElement('div');
  wrap.className = 'calc-table-wrap';
  const t = document.createElement('table');
  t.className = 'calc-table';
  t.createCaption().textContent = 'Your services, highest profit per hour first';
  const head = t.createTHead().insertRow();
  for (const h of ['Service', 'Price', 'Minutes', 'Profit', 'Margin', 'Profit/hour', 'Revenue/hour']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.append(th); }
  const body = t.createTBody();
  for (const i of r.order) {
    const s = r.services.find((x) => x.index === i);
    const p = describeProfit(s.profit), ph = describeProfit(s.profitPerHour);
    const row = body.insertRow();
    const cells = [s.name, money(s.revenue), formatNumber(s.durationMinutes, 0), p.loss ? `Loss ${money(p.amount, { cents: true })}` : money(p.amount, { cents: true }),
      p.loss ? `${formatPercent(-s.margin)} loss` : formatPercent(s.margin), ph.loss ? `Loss ${money(ph.amount)}` : money(ph.amount), money(s.revenuePerHour)];
    cells.forEach((text, n) => { const c = row.insertCell(); c.textContent = text; if (p.loss && [3, 4, 5].includes(n)) c.className = 'is-loss'; });
  }
  wrap.append(t);
  frag.append(ul, wrap);
  return frag;
}

export const config = mountCalculator({
  readExtra: readRows,
  onProfession,
  printExtra: (root) => readRows(root).values.services.map((s, i) => [s.name || `Service ${i + 1}`, `$${s.price} · ${s.durationMinutes} min`]),
  onReady(root, recalc) {
    const rows = root.querySelector('.calc-rows');
    for (let k = 0; k < 3; k++) addRow(root);
    root.querySelector('[data-action="add-row"]').addEventListener('click', () => addRow(root)?.querySelector('[data-col="name"]').focus());
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
    const owner = type === 'owner';
    // labor: solo = your pay per hour on every service; owner = each service's provider wage + commission (a share of its price)
    const services = (v.services || []).map((s) => ({ name: s.name, price: s.price, durationMinutes: s.durationMinutes, productCost: s.productCost,
      supplyCost: s.supplyCost, laborHourly: (owner ? s.laborHourly : v.targetHourly) || 0, commissionRate: owner ? toRate(s.commissionRate) : 0 }));
    const r = calculateMenuProfitability({ services, monthlyRent: v.monthlyRent, hoursPerMonth: v.hoursPerMonth, processingRate: toRate(v.processingRate) });
    if (!r.ok) return r;
    const recs = recommendations(r);
    const by = (i) => r.services.find((s) => s.index === i);
    const sig = signatureService(profession);
    let primary, cards;
    if (r.comparing) {
      const k = r.rankings;
      const top = by(k.profitPerHour.index), low = by(k.lowest.index);
      primary = { value: top.name, label: k.profitPerHour.tiedWith.length ? 'Ties for the highest profit per hour' : 'Highest profit per hour', note: perHour(top.profitPerHour) };
      const p = (s) => describeProfit(s.profit);
      cards = [
        { label: 'Highest profit per appointment', value: by(k.profit.index).name, note: perAppt(by(k.profit.index).profit) },
        { label: 'Highest profit per hour', value: top.name, note: perHour(top.profitPerHour) },
        { label: 'Highest margin', value: by(k.margin.index).name, note: formatPercent(by(k.margin.index).margin) },
        { label: 'Lowest-performing service', value: low.name, note: perHour(low.profitPerHour), loss: p(low).loss },
        { label: 'Services compared', value: formatNumber(r.count, 0), note: r.lossIndexes.length ? `${formatNumber(r.lossIndexes.length, 0)} at a loss` : 'None at a loss' },
      ];
    } else {
      const s = r.services[0];
      const p = describeProfit(s.profit);
      primary = { value: money(p.amount, { cents: true }), label: `${p.loss ? 'Loss' : p.even ? 'Break-even' : 'Profit'} per appointment: ${s.name}`, loss: p.loss };
      cards = [{ label: 'Profit per hour', value: perHour(s.profitPerHour), loss: p.loss }, { label: 'Margin', value: p.loss ? `${formatPercent(-s.margin)} loss` : formatPercent(s.margin), loss: p.loss },
        { label: 'Revenue per hour', value: `${money(s.revenuePerHour)}/hour` }];
    }
    const rentRow = r.services[0];
    const method = [
      rentRow.rentShare > 0
        ? `Rent per service: ${money(v.monthlyRent)} rent ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(rentRow.rentPerHour, { cents: true })}/hour, × each service’s length. Longer services carry more rent.`
        : 'No rent was entered, so no rent is added.',
      owner ? 'Labor per service: its provider wage × its length, + its commission × its price.' : `Your pay (labor): ${money(v.targetHourly, { cents: true })}/hour × each service’s length. Profit is what is left after you are paid.`,
      'Profit = price − product − supplies − rent share − card processing − labor. Margin = profit ÷ price. Per hour = ÷ the service’s hours.',
      `Rankings compare profit per appointment, profit per hour and margin. The lowest performer is the lowest profit per hour. Services within ${formatPercent(SIMILAR_SHARE)} of the best per hour count as similar.`,
    ];
    // the lowest earner (or the only service) goes to the pricing calculator with each part in its own field
    const focus = r.comparing ? by(r.rankings.lowest.index) : r.services[0];
    const src = v.services[focus.index];
    const pricing = new URLSearchParams({ currentPrice: String(src.price), durationMinutes: String(src.durationMinutes), productCost: focus.consumables.toFixed(2), type });
    if (focus.rentShare > 0) { pricing.set('monthlyRent', String(v.monthlyRent)); pricing.set('hoursPerMonth', String(v.hoursPerMonth)); }
    if (owner) { if (src.laborHourly > 0) pricing.set('providerWage', String(src.laborHourly)); if (src.commissionRate > 0) pricing.set('commissionRate', String(src.commissionRate)); }
    else if (v.targetHourly > 0) pricing.set('targetHourly', String(v.targetHourly));
    if (profession) pricing.set('profession', profession);
    return {
      ok: true, raw: r,
      view: {
        primary, cards, insight: (r.tone === 'warn' && menuWarning(r)) || recs[0], method, recommendations: recs, tone: r.tone,
        extraNode: () => menuNode(r, recs),
        cta: { href: `../service-pricing/?${pricing}`, text: `Find a recommended price for ${quote(focus)} →` },
        share: { value: r.comparing ? by(r.rankings.profitPerHour.index).name : primary.value, label: r.comparing ? 'My most profitable service per hour' : 'Profit per appointment',
          insight: `From a ${sig.text} to a quick add-on: know what every service on the menu earns.` },
      },
    };
  },
});
