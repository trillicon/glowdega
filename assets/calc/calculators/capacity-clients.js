import { mountCalculator } from '../ui/framework.js';
import { calculateCapacity } from '../core/capacity.js';
import { formatMoney as money, formatNumber } from '../core/money.js';
import { formatPercent } from '../core/percentages.js';
import { clientsForGoal, MAX_TIERS } from '../core/commission.js';
import { parseNumber } from '../core/validation.js';
import { toRate as rate } from '../core/percentages.js';
import { serviceText } from '../ui/professions.js';

const radio = (root, name, fallback) => root?.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
const minutesOf = (root) => Number(radio(root, 'serviceMinutes', 60));
const PAY_MODEL_NAMES = { flat: 'Flat commission %', sales: 'Tiered by sales', services: 'Tiered by services per week' };
const FROM_RULE = { sales: { name: 'where this tier starts', unit: 'money', required: true, max: 100_000_000 },
  services: { name: 'where this tier starts', unit: 'number', required: true, max: 10000, integer: true } };
const RATE_RULE = { name: 'a tier rate', unit: 'percent', required: true, max: 100 };
// placeholders for tiers 2–6, by what the tiers count
const FROM_EXAMPLE = { week: ['2,000', '3,000', '4,000', '5,000', '6,000'], month: ['8,000', '12,000', '16,000', '20,000', '24,000'],
  services: ['20', '30', '40', '50', '60'] };
const RATE_EXAMPLE = ['40', '45', '50', '55', '60', '65'];

/** Tier rows (employees on tiers only). Blank rows after the first are skipped; a half-filled row is an error, never a 0. */
function readTiers(root, model) {
  const errors = {}, tiers = [];
  for (const row of root.querySelectorAll('.calc-tiers .calc-row')) {
    const [from, pct] = ['from', 'rate'].map((c) => row.querySelector(`[data-col="${c}"]`));
    from.dataset.key = ''; pct.dataset.key = '';
    if (tiers.length && !from.value.trim() && !pct.value.trim()) continue;
    const i = tiers.length;
    from.dataset.key = `tierFrom-${i}`; pct.dataset.key = `tierRate-${i}`;
    const f = parseNumber(from.value, FROM_RULE[model]), r = parseNumber(pct.value, RATE_RULE);
    if (!f.ok) errors[`tierFrom-${i}`] = f.error;
    if (!r.ok) errors[`tierRate-${i}`] = r.error;
    tiers.push({ from: f.ok ? f.value : 0, rate: r.ok ? r.value : 0 });
  }
  return { tiers, errors };
}

/** Labels, the $ sign and placeholders follow what the tiers count: sales a week, sales a month or services a week. */
function relabelTiers(root) {
  const model = radio(root, 'payModel', 'flat'), period = radio(root, 'tierPeriod', 'week');
  const label = model === 'services' ? 'From services a week' : `From sales a ${period}`;
  const examples = FROM_EXAMPLE[model === 'services' ? 'services' : period];
  const rows = [...root.querySelectorAll('.calc-tiers .calc-row')];
  rows.forEach((row, i) => {
    row.querySelector('label[data-for="from"]').textContent = label;
    row.querySelector('[data-tier-money]').hidden = model === 'services';
    const from = row.querySelector('[data-col="from"]');
    if (i > 0) from.placeholder = examples[(i - 1) % examples.length];
    row.querySelector('[data-col="rate"]').placeholder = RATE_EXAMPLE[i % RATE_EXAMPLE.length];
    row.querySelector('[data-action="remove-tier"]').hidden = i === 0;
  });
  const add = root.querySelector('[data-action="add-tier"]');
  if (add) add.hidden = rows.length >= MAX_TIERS;
}

let uid = 0;
function addTier(root) {
  const rows = root.querySelector('.calc-tiers');
  if (!rows || rows.children.length >= MAX_TIERS) return null;
  const row = root.querySelector('#calc-tier-template').content.firstElementChild.cloneNode(true);
  const n = ++uid;
  for (const input of row.querySelectorAll('[data-col]')) {
    const id = `tier${n}-${input.dataset.col}`;
    input.id = id;
    row.querySelector(`label[data-for="${input.dataset.col}"]`).setAttribute('for', id);
    const err = input.closest('.calc-row__cell').querySelector('.calc-error');
    err.id = id + '-error';
    input.setAttribute('aria-describedby', err.id);
  }
  if (!rows.children.length) { const from = row.querySelector('[data-col="from"]'); from.value = '0'; from.readOnly = true; }
  rows.append(row);
  relabelTiers(root);
  return row;
}

const periodWord = (p) => (p === 'week' ? 'week' : 'month');
const moreClients = (n) => `${formatNumber(n, 0)} more ${n === 1 ? 'client' : 'clients'}`;
const clientsText = (n) => `${formatNumber(n, 0)} ${n === 1 ? 'client' : 'clients'}`;
const fromText = (model, period, from) => (model === 'services' ? `${formatNumber(from, 0)} services a week` : `${money(from)} in sales a ${period}`);

/** Each tier: where it starts, its rate, the fewest clients a week that reach it and the pay there. Display only. */
function tierTable(r) {
  const wrap = document.createElement('div');
  wrap.className = 'calc-table-wrap';
  const t = document.createElement('table');
  t.className = 'calc-table';
  t.createCaption().textContent = 'Your tiers: the rate is paid on all sales once a tier is reached';
  const head = t.createTHead().insertRow();
  for (const h of ['Tier', 'Starts at', 'Rate', 'Clients a week', 'Pay a week']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.append(th); }
  const body = t.createTBody();
  for (const s of r.steps) {
    const row = body.insertRow();
    if (s.index === r.tier.index) row.className = 'is-yours';
    [`${s.number}${s.index === r.tier.index ? ' (your goal)' : ''}`, fromText(r.model, r.tierPeriod, s.from), formatPercent(s.rate, 1),
      s.reachable ? formatNumber(s.clients, 0) : 'Out of reach', s.reachable ? money(s.payWeekly) : '—'].forEach((x) => { row.insertCell().textContent = x; });
  }
  wrap.append(t);
  return wrap;
}

/** Employees: a pre-tax pay goal → whole clients a week, the tier it reaches, the next tier, and the hours. */
function employeeView(v, profession) {
  const model = v.payModel || 'flat';
  const r = clientsForGoal({ goal: v.incomeGoal, goalPeriod: v.goalPeriod || 'month', model, flatRate: rate(v.flatRate),
    tiers: (v.tiers || []).map((t) => ({ from: t.from, rate: rate(t.rate) })), tierPeriod: v.tierPeriod || 'week', averageTicket: v.averageTicket,
    baseWage: v.baseWage || 0, tipPerClient: v.tipPerClient || 0, serviceMinutes: v.serviceMinutes || 60, nonClientHours: v.nonClientHours || 0,
    hoursPerDay: v.hoursPerDay || 8 });
  if (!r.ok) return r;
  const service = serviceText(profession, r.serviceMinutes);
  const per = periodWord(r.goalPeriod);
  const w = r.week, m = r.month, nx = r.next;
  const tierWord = model === 'flat' ? `${formatPercent(r.tier.rate, 1)} flat commission` : `tier ${r.tier.number} (${formatPercent(r.tier.rate, 1)})`;
  const payParts = [w.commission > 0 ? `${money(w.commission)} commission` : '', w.wage > 0 ? `${money(w.wage)} wage` : '', w.tips > 0 ? `${money(w.tips)} tips` : '']
    .filter(Boolean).join(' + ') || 'Nothing yet';
  const cards = [
    { label: 'Clients a month', value: `About ${formatNumber(r.clientsPerMonth, 0)}`, note: `${clientsText(r.clientsPerWeek)} a week × 4.33 weeks` },
    { label: 'Sales needed', value: `${money(r.salesPerWeek)} a week`, note: `About ${money(r.salesPerMonth)} a month at ${money(r.averageTicket)} a client` },
    { label: model === 'flat' ? 'Commission rate' : 'Tier reached', value: model === 'flat' ? formatPercent(r.tier.rate, 1) : `Tier ${r.tier.number}: ${formatPercent(r.tier.rate, 1)}`,
      note: model === 'flat' ? 'On every sale' : `From ${fromText(model, r.tierPeriod, r.tier.from)}, paid on all sales` },
    { label: 'Pay before tax', value: `${money(w.total)} a week`, note: `${payParts}; about ${money(m.total)} a month` },
    { label: 'Hours a week', value: formatNumber(r.hoursPerWeek, 1), note: `${formatNumber(r.clientHoursPerWeek, 1)} with clients` + (r.nonClientHours > 0 ? ` + ${formatNumber(r.nonClientHours, 1)} other` : '') },
    { label: 'Days a week', value: formatNumber(r.daysPerWeek, 1), note: `At ${formatNumber(r.hoursPerDay, 1)} hours a day` },
  ];
  if (nx) cards.push({ label: 'Next tier', value: `${formatPercent(nx.rate, 1)} at ${clientsText(nx.clients)}`, note: `${formatNumber(nx.extraClients, 0)} more a week: +${money(nx.gainWeekly)} a week` });
  let insight = `To make ${money(r.goal)} a ${per} before tax at a ${money(r.averageTicket)} average ticket, you need ${clientsText(r.clientsPerWeek)} a week `
    + `(about ${formatNumber(r.clientsPerMonth, 0)} a month), or ${money(r.salesPerWeek)} in sales a week. That pays ${tierWord}.`;
  if (nx?.cliff) {
    insight += ` Just ${moreClients(nx.extraClients)} a week (${formatNumber(nx.clients, 0)} in all) reaches tier ${nx.number}: ${formatPercent(nx.rate, 1)} on all your sales, `
      + `${money(nx.payWeekly)} a week. That is ${money(nx.gainWeekly)} more, about ${money(nx.perExtraClient)} for each extra client against ${money(nx.perClientNow)} a client now, so stopping just short of it leaves money on the table.`;
  } else if (nx) {
    insight += ` ${moreClients(nx.extraClients)[0].toUpperCase()}${moreClients(nx.extraClients).slice(1)} a week reaches tier ${nx.number} (${formatPercent(nx.rate, 1)}): ${money(nx.gainWeekly)} more a week.`;
  } else if (r.tier.top) {
    insight += ' That is your top tier.';
  }
  if (!r.fitsInWeek) insight += ` That is more than 7 days at ${formatNumber(r.hoursPerDay, 1)} hours a day, so a higher ticket, rate or wage may be easier to reach than more bookings.`;
  const rateLine = model === 'flat' ? `Commission = sales × ${formatPercent(r.tier.rate, 1)}.`
    : `Tiers are not marginal: reaching a tier pays its rate on all sales in that ${model === 'services' ? 'week' : r.tierPeriod}, not only on the sales above it. `
      + (model === 'services' ? 'Tiers count services a week.' : `Tiers count sales a ${r.tierPeriod} (a month = a week × 4.33).`);
  const method = [
    `Your goal: ${money(r.goal)} a ${per} before tax` + (r.goalPeriod === 'month' ? ` = ${money(r.weeklyGoal, { cents: true })} a week (a month ÷ 4.33 weeks).` : '.'),
    `We count up one whole client a week at a time, from 0, until pay reaches the goal: ${clientsText(r.clientsPerWeek)}. Whole clients, never fractions, so a tier’s jump is never missed.`,
    `Sales = ${formatNumber(r.clientsPerWeek, 0)} clients × ${money(r.averageTicket, { cents: true })} average ticket = ${money(r.salesPerWeek)} a week.`,
    rateLine,
    `Pay = commission ${money(w.commission)}` + (w.wage > 0 ? ` + base wage ${money(v.baseWage, { cents: true })}/hour × ${formatNumber(w.hours, 1)} hours = ${money(w.wage)}` : '')
      + (w.tips > 0 ? ` + tips ${money(v.tipPerClient, { cents: true })} × ${formatNumber(r.clientsPerWeek, 0)} clients = ${money(w.tips)}` : '') + ` = ${money(w.total)} a week, before tax.`,
    `Hours = ${formatNumber(r.clientsPerWeek, 0)} clients × ${r.serviceMinutes} minutes` + (r.nonClientHours > 0 ? ` + ${formatNumber(r.nonClientHours, 1)} non-client hours` : '')
      + ` = ${formatNumber(r.hoursPerWeek, 1)} hours a week; days = hours ÷ ${formatNumber(r.hoursPerDay, 1)} hours a day.`,
    'A month is a week × 52 ÷ 12 (4.33 weeks). This is pay before tax; the Profit & Take-Home Calculator estimates what you keep.',
  ];
  if (nx) method.push(`Next tier: the first whole client count above yours that reaches tier ${nx.number} is ${formatNumber(nx.clients, 0)} a week, paying ${money(nx.payWeekly)} a week.`);
  return {
    ok: true, raw: r,
    view: {
      primary: { value: formatNumber(r.clientsPerWeek, 0), label: 'Clients a week to reach your pay goal', note: `About ${formatNumber(r.clientsPerMonth, 0)} a month for ${money(r.goal)} a ${per} before tax` },
      cards, insight, method, tone: r.fitsInWeek ? 'ok' : 'warn', // no margin: orange only when the goal doesn't fit in a week
      extraNode: r.steps.length ? () => tierTable(r) : null,
      share: { value: formatNumber(r.clientsPerWeek, 0), label: `clients a week to make ${money(r.goal)} a ${per}`,
        insight: `Every pay goal is a number of bookings. Know how many ${service.phrase} appointments yours takes.` },
    },
  };
}
const plural = (n, one, many) => `${formatNumber(n, 0)} ${n === 1 ? one : many}`;

/** The scenario table (ticket → clients and hours), built from the engine's rows. Display only. */
function scenarioTable(r) {
  const wrap = document.createElement('div');
  wrap.className = 'calc-table-wrap';
  const t = document.createElement('table');
  t.className = 'calc-table';
  t.createCaption().textContent = `What ${money(r.revenueGoal)} a month takes at different average tickets`;
  const head = t.createTHead().insertRow();
  for (const h of ['Average ticket', 'Clients a month', 'Hours with clients']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.append(th); }
  const body = t.createTBody();
  for (const s of r.scenarios) {
    const row = body.insertRow();
    if (s.yours) row.className = 'is-yours';
    row.insertCell().textContent = money(s.ticket) + (s.yours ? ' (yours)' : '');
    row.insertCell().textContent = formatNumber(s.clientsWhole, 0);
    row.insertCell().textContent = formatNumber(s.hours, 0);
  }
  wrap.append(t);
  return wrap;
}

export const config = mountCalculator({
  readExtra(root) {
    const values = { serviceMinutes: minutesOf(root), goalPeriod: radio(root, 'goalPeriod', 'month'), payModel: radio(root, 'payModel', 'flat'),
      tierPeriod: radio(root, 'tierPeriod', 'week') };
    if (root.dataset.type !== 'employee' || values.payModel === 'flat') return { values, errors: {} };
    const { tiers, errors } = readTiers(root, values.payModel);
    return { values: { ...values, tiers }, errors };
  },
  printExtra: (root) => [['Average service length', `${minutesOf(root)} minutes`],
    ...(root.dataset.type === 'employee' ? [['Commission', PAY_MODEL_NAMES[radio(root, 'payModel', 'flat')]],
      ...readTiers(root, radio(root, 'payModel', 'flat') === 'services' ? 'services' : 'sales').tiers.map((t, i) => [`Tier ${i + 1}`, `from ${t.from}: ${t.rate}%`])] : [])],
  onReady(root, recalc) {
    if (!root.querySelector('.calc-tiers')) return;
    addTier(root); addTier(root);
    root.querySelector('[data-action="add-tier"]').addEventListener('click', () => addTier(root)?.querySelector('[data-col="from"]').focus());
    root.querySelector('.calc-tiers').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action="remove-tier"]');
      if (!b) return;
      const row = b.closest('.calc-row');
      const prev = row.previousElementSibling;
      row.remove();
      relabelTiers(root);
      prev?.querySelector('[data-col="rate"]')?.focus();
      recalc();
    });
    root.querySelector('.calc-form').addEventListener('change', (e) => { if (['payModel', 'tierPeriod'].includes(e.target.name)) relabelTiers(root); });
  },
  compute({ values: v, type, profession }) {
    if (type === 'employee') return employeeView(v, profession);
    const r = calculateCapacity({ revenueGoal: v.revenueGoal, averageTicket: v.averageTicket, workingDaysPerMonth: v.workingDaysPerMonth,
      serviceMinutes: v.serviceMinutes || 60, currentClients: v.currentClients, currentTicket: v.currentTicket });
    if (!r.ok) return r;
    const employee = type === 'employee';
    const service = serviceText(profession, r.serviceMinutes);
    const goalWord = employee ? 'service revenue goal' : 'revenue goal';
    const cards = [
      { label: 'Clients a week', value: formatNumber(r.clientsPerWeek, 1) },
      { label: 'Clients a day', value: formatNumber(r.clientsPerDay, 1), note: `Over ${plural(r.workingDaysPerMonth, 'working day', 'working days')} a month` },
      { label: 'Working hours with clients', value: `${formatNumber(r.hoursPerMonth, 0)} a month`, note: `About ${formatNumber(r.hoursPerDay, 1)} a day at ${r.serviceMinutes} minutes each` },
      { label: 'Average ticket', value: money(r.averageTicket) },
    ];
    let insight = `To reach ${money(r.revenueGoal)} a month at a ${money(r.averageTicket)} average ticket, you need about ${plural(r.clientsWhole, 'client', 'clients')} a month, or ${formatNumber(r.clientsPerDay, 1)} a day.`;
    if (r.hoursPerDay > 10) insight += ` That is more than 10 hours with clients a day, so a higher average ticket may be easier to reach than more bookings.`;
    const c = r.current;
    if (c) {
      cards.push({ label: 'Revenue now', value: money(c.revenue), note: `${plural(c.clients, 'client', 'clients')} × ${money(c.ticket)}${c.ticketEntered ? '' : ' (your average service price)'}` });
      if (c.goalMet) {
        cards.push({ label: 'Goal', value: 'Met', note: `${formatPercent(c.share)} of your ${goalWord}` });
        insight += ` Your current ${plural(c.clients, 'client', 'clients')} already bring in ${money(c.revenue)}, which meets it.`;
      } else {
        cards.push({ label: 'Clients to add', value: formatNumber(c.moreClients, 0), note: `${money(c.revenueGap)} short, at ${money(c.ticket)} a visit` });
        insight += ` You are at ${formatPercent(c.share)} of your goal now: about ${plural(c.moreClients, 'more client', 'more clients')} a month at ${money(c.ticket)} closes the gap.`;
      }
    }
    const method = [
      `Clients a month = ${money(r.revenueGoal)} ${goalWord} ÷ ${money(r.averageTicket, { cents: true })} average ticket = ${formatNumber(r.clients, 2)}, rounded up to ${formatNumber(r.clientsWhole, 0)} (you can’t book part of a client).`,
      `A week = clients a month ÷ 4.33 weeks; a day = clients a month ÷ ${plural(r.workingDaysPerMonth, 'working day', 'working days')}.`,
      `Working hours with clients = ${formatNumber(r.clientsWhole, 0)} clients × ${r.serviceMinutes} minutes = ${formatNumber(r.hoursPerMonth, 1)} hours a month. Set-up, admin and breaks are on top of this.`,
      'The table repeats the same goal at average tickets about 20% apart, around yours, so you can see what a higher ticket saves in bookings.',
    ];
    if (c) method.push(`Revenue now = ${formatNumber(c.clients, 0)} clients × ${money(c.ticket, { cents: true })} = ${money(c.revenue)}. Clients to add = clients your goal takes at that ticket (${formatNumber(c.neededAtTicket, 0)}) − clients now.`);
    method.push(employee ? 'This plans the services you perform. Your pay depends on how you are paid; the Profit & Take-Home Calculator shows it.'
      : 'This plans bookings only. Rent, pay and other costs are covered by the Break-Even and Profit & Take-Home calculators.');
    return {
      ok: true, raw: r,
      view: {
        primary: { value: formatNumber(r.clientsWhole, 0), label: `Clients a month to reach your ${goalWord}` },
        cards, insight, method, tone: c && !c.goalMet ? 'warn' : 'ok', // no margin: orange when current clients fall short
        extraNode: () => scenarioTable(r),
        share: { value: formatNumber(r.clientsWhole, 0), label: `clients a month to reach ${money(r.revenueGoal)}`,
          insight: `Every revenue goal is a number of bookings. Know how many ${service.phrase} appointments yours takes.` },
      },
    };
  },
});
