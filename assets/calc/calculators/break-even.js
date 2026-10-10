import { mountCalculator } from '../ui/framework.js';
import { calculateBreakEven, breakEvenChart } from '../core/breakeven.js';
import { formatMoney as money, formatNumber, describeProfit } from '../core/money.js';
import { toRate, formatPercent, formatMargin } from '../core/percentages.js';
import { signatureService } from '../ui/professions.js';

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, text) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

/** Revenue and cost lines from the engine, drawn as a simple SVG. Only geometry here, no money math. */
function chartNode(r) {
  const c = breakEvenChart(r);
  const fig = document.createElement('figure');
  fig.className = 'calc-chart';
  if (!c) return null;
  const W = 600, H = 300, L = 16, R = 16, T = 16, B = 40;
  const sx = (n) => L + (n / c.maxAppointments) * (W - L - R);
  const sy = (m) => T + (1 - m / c.maxValue) * (H - T - B);
  const line = (pts) => pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
  const [bx, by] = c.point;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Break-even chart: revenue and total costs meet at about ${formatNumber(bx, 0)} appointments a month. Fewer appointments mean a loss; more mean a profit.` });
  svg.append(
    svgEl('rect', { x: L, y: T, width: sx(bx) - L, height: H - T - B, class: 'calc-chart__loss' }),
    svgEl('rect', { x: sx(bx), y: T, width: W - R - sx(bx), height: H - T - B, class: 'calc-chart__profit' }),
    svgEl('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'calc-chart__axis' }),
    svgEl('polyline', { points: line(c.cost), class: 'calc-chart__cost' }),
    svgEl('polyline', { points: line(c.revenue), class: 'calc-chart__revenue' }),
    svgEl('line', { x1: sx(bx), y1: T, x2: sx(bx), y2: H - B, class: 'calc-chart__marker' }),
    svgEl('circle', { cx: sx(bx), cy: sy(by), r: 7, class: 'calc-chart__point' }),
    svgEl('text', { x: Math.max(L + 4, sx(bx) / 2 - 20), y: T + 22, class: 'calc-chart__zone' }, 'LOSS'),
    svgEl('text', { x: Math.min(W - R - 70, sx(bx) + (W - R - sx(bx)) / 2 - 30), y: T + 22, class: 'calc-chart__zone' }, 'PROFIT'),
    svgEl('text', { x: L, y: H - 12, class: 'calc-chart__tick' }, '0'),
    svgEl('text', { x: sx(bx), y: H - 12, class: 'calc-chart__tick', 'text-anchor': 'middle' }, `${formatNumber(bx, 0)} appts`),
    svgEl('text', { x: W - R, y: H - 12, class: 'calc-chart__tick', 'text-anchor': 'end' }, `${c.maxAppointments}`),
  );
  const cap = document.createElement('figcaption');
  cap.innerHTML = '<span class="calc-key calc-key--revenue"></span> Revenue <span class="calc-key calc-key--cost"></span> Total costs (fixed + per appointment)';
  const p = document.createElement('p');
  p.textContent = `Each appointment adds ${money(r.contribution, { cents: true })} toward your fixed costs of ${money(r.fixedCosts)}. Below ${formatNumber(bx, 1)} appointments a month the cost line is above the revenue line (a loss); past it, every appointment adds profit.`;
  fig.append(svg, cap, p);
  return fig;
}

export const config = mountCalculator({
  unsupportedTypes: ['employee'],
  compute({ values: v, type, profession }) {
    const owner = type === 'owner';
    // labor: solo pay is a fixed cost; owner payroll + owner pay are fixed costs and commission is a cost per service.
    // Each type passes only its own labor fields, so nothing is counted twice.
    const r = calculateBreakEven({
      fixedCosts: v.fixedCosts, monthlyRent: v.monthlyRent, servicePrice: v.servicePrice, variableCost: v.variableCost, processingRate: toRate(v.processingRate),
      retailRevenue: v.retailRevenue, retailCostRate: toRate(v.retailCostRate), workingDaysPerWeek: v.workingDaysPerWeek,
      monthlyPay: owner ? 0 : v.monthlyPay, monthlyPayroll: owner ? v.monthlyPayroll : 0, ownerPay: owner ? v.ownerPay : 0,
      commissionRate: owner ? toRate(v.commissionRate) : 0,
    });
    if (!r.ok) return r;
    const contribution = describeProfit(r.contribution);
    const sig = signatureService(profession);
    const laborWords = owner ? 'payroll and owner pay' : 'your pay';
    const fixedNote = `${money(r.rent)} rent + ${money(r.laborFixed)} ${laborWords} + ${money(r.otherFixedCosts)} other`;
    const laborCard = { label: owner ? 'Labor a month' : 'Your pay a month', value: money(r.laborFixed),
      note: owner ? `${money(v.monthlyPayroll)} payroll + ${money(v.ownerPay)} owner pay` + (r.commission > 0 ? `; commission ${money(r.commission, { cents: true })} per service` : '')
        : r.laborFixed > 0 ? 'Counted as a fixed cost' : 'No monthly pay entered' };
    const method = [
      `Net price after card processing: ${money(v.servicePrice, { cents: true })} × (1 − ${formatPercent(toRate(v.processingRate), 1)}) = ${money(r.netPrice, { cents: true })}.`,
      `Contribution per appointment: net price` + (owner ? ` − ${money(r.commission, { cents: true })} commission (${formatPercent(toRate(v.commissionRate), 1)} of the price)` : '') +
        ` − ${money(v.variableCost, { cents: true })} variable cost` + (v.retailRevenue > 0 ? ' + retail after its product cost and processing' : '') + ` = ${contribution.loss ? '−' : ''}${money(contribution.amount, { cents: true })}.`,
      owner
        ? `Labor: ${money(v.monthlyPayroll)} payroll (wages + payroll taxes) + ${money(v.ownerPay)} your owner pay = ${money(r.laborFixed)} a month, a fixed cost. Commission is paid per service, so it comes off each appointment’s contribution instead.`
        : `Labor: ${money(r.laborFixed)} your monthly pay, a fixed cost, so break-even means you are paid too.`,
      `Monthly fixed costs: ${fixedNote} = ${money(r.fixedCosts)}.`,
      'Break-even appointments = monthly fixed costs (rent and labor included) ÷ contribution per appointment.',
      'Break-even revenue = break-even appointments × average ticket (service price' + (v.retailRevenue > 0 ? ' + retail' : '') + ').',
      `Weekly = monthly ÷ 4.33 weeks; daily = weekly ÷ ${formatNumber(v.workingDaysPerWeek)} working days.`,
    ];
    if (!r.possible) {
      return {
        ok: true, raw: r,
        view: {
          primary: { value: 'Not possible', label: 'Break-even at these prices', loss: true },
          insight: `Your current price does not cover the variable cost${owner && r.commission > 0 ? ' and commission' : ''} of this service. Increase the price or reduce the service cost before calculating break-even.`,
          cards: [{ label: 'Monthly fixed costs', value: money(r.fixedCosts), note: fixedNote }, laborCard,
            { label: r.reason === 'zero' ? 'Contribution per appointment' : 'Loss per appointment (before fixed costs)', value: money(contribution.amount, { cents: true }), loss: r.reason !== 'zero' }],
          method, tone: 'warn', // the price doesn't cover the service's own costs
          share: { value: 'Not yet', label: 'Break-even', insight: 'Prices need to cover costs before a business can break even.' },
        },
      };
    }
    const insight = r.fixedCosts === 0
      ? 'With no fixed costs, every appointment that covers its own costs is already profitable.'
      : `You need about ${formatNumber(r.appointmentsWhole, 0)} appointments a month, roughly ${formatNumber(r.dailyAppointments, 1)} a day, to cover your rent, ${laborWords} and other fixed costs.`;
    return {
      ok: true, raw: r,
      view: {
        primary: { value: formatNumber(r.appointmentsWhole, 0), label: 'Appointments a month to break even' },
        cards: [
          { label: 'Break-even revenue', value: money(r.revenue), note: 'a month' },
          { label: 'Appointments a week', value: formatNumber(r.weeklyAppointments, 1) },
          { label: 'Appointments a day', value: formatNumber(r.dailyAppointments, 1) },
          { label: 'Contribution per appointment', value: money(r.contribution, { cents: true }), note: `${formatMargin(r.contributionMargin)} of each ticket` },
          { label: 'Monthly fixed costs', value: money(r.fixedCosts), note: fixedNote },
          laborCard,
        ],
        insight, method, tone: 'ok', // a target to reach, not a profit verdict: the default box
        extraNode: r.fixedCosts > 0 ? () => chartNode(r) : null,
        share: { value: formatNumber(r.appointmentsWhole, 0), label: 'appointments a month to break even', insight: `Know how many ${sig.text} appointments cover the rent and the pay.` },
      },
    };
  },
});
