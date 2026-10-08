import { mountCalculator } from '../ui/framework.js';
import { calculateDiscount } from '../core/discount.js';
import { formatMoney as money, formatNumber, describeProfit } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';
import { serviceText } from '../ui/professions.js';
import { costInputs, costMethod, laborCard } from '../ui/service-costs.js';

const profitText = (x, opts) => { const d = describeProfit(x); return d.loss ? `Loss of ${money(d.amount, opts)}` : money(d.amount, opts); };

/** Promotion scenario table: the same appointments with and without the discount. Display only. */
function promoTable(p, discount) {
  const wrap = document.createElement('div');
  wrap.className = 'calc-table-wrap';
  const t = document.createElement('table');
  t.className = 'calc-table';
  t.createCaption().textContent = `${formatNumber(p.appointments, 0)} appointments, with and without the ${discount} discount`;
  const head = t.createTHead().insertRow();
  for (const h of ['', 'Without promotion', 'With promotion']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.append(th); }
  const body = t.createTBody();
  const line = (label, a, b, lossB) => {
    const row = body.insertRow();
    const th = document.createElement('th'); th.scope = 'row'; th.textContent = label; row.append(th);
    row.insertCell().textContent = a;
    const c = row.insertCell(); c.textContent = b; if (lossB) c.className = 'is-loss';
  };
  line('Revenue', money(p.revenueWithout), money(p.revenueWith));
  line('Profit', profitText(p.profitWithout), profitText(p.profitWith), p.profitWith < -0.005);
  wrap.append(t);
  return wrap;
}

export const config = mountCalculator({
  compute({ values: v, type, profession }) {
    const r = calculateDiscount({ regularPrice: v.regularPrice, discountRate: toRate(v.discountRate), targetMargin: toRate(v.targetMargin),
      promoAppointments: v.promoAppointments, ...costInputs(v, type) });
    if (!r.ok) return r;
    const service = serviceText(profession, v.durationMinutes);
    const d = formatPercent(r.discountRate, 1);
    const before = describeProfit(r.before.profit), after = describeProfit(r.after.profit);
    const cards = [
      { label: 'Profit before discount', value: profitText(r.before.profit, { cents: true }), loss: before.loss, note: `At ${money(r.regularPrice)}` },
      { label: 'Profit after discount', value: profitText(r.after.profit, { cents: true }), loss: after.loss, note: `At ${money(r.salePrice, { cents: true })}` },
      { label: 'Profit lost per appointment', value: money(r.profitLost, { cents: true }),
        note: r.regularProfitable ? `${formatPercent(r.reductionRate)} of the profit` : 'The regular price is not profitable' },
      { label: 'Break-even discount', value: r.regularProfitable ? formatPercent(r.breakEvenDiscount, 1) : '0%',
        note: r.regularProfitable ? `Profit is $0 at ${money(r.breakEvenSalePrice, { cents: true })}, labor paid` : 'Any discount adds to the loss' },
      { label: 'Maximum target-profit discount', value: r.regularMeetsTarget ? formatPercent(r.targetDiscount, 1) : '0%',
        note: r.regularMeetsTarget ? `Keeps a ${formatPercent(r.targetMargin)} margin at ${money(r.targetSalePrice, { cents: true })}` : `The regular price is already below a ${formatPercent(r.targetMargin)} margin` },
      { label: 'Rent per appointment', value: money(r.rentShare, { cents: true }), note: r.rentShare > 0 ? `${money(r.rentPerHour, { cents: true })}/hour of service time` : 'No rent entered' },
      laborCard(r, type, r.after),
    ];
    const insight = {
      none: r.regularProfitable
        ? `At full price this ${service.phrase} earns ${money(r.before.profit, { cents: true })} an appointment. ` + (r.regularMeetsTarget
          ? `You could discount it up to ${formatPercent(r.targetDiscount, 1)} and keep a ${formatPercent(r.targetMargin)} margin, or up to ${formatPercent(r.breakEvenDiscount, 1)} before it stops making money.`
          : `That is already below a ${formatPercent(r.targetMargin)} margin; up to ${formatPercent(r.breakEvenDiscount, 1)} off, it still covers its costs.`)
        : `At full price this ${service.phrase} already loses ${money(before.amount, { cents: true })} an appointment, so any discount deepens the loss.`,
      target: `A ${d} discount costs ${money(r.profitLost, { cents: true })} of profit an appointment (${formatPercent(r.reductionRate)} of it) and still keeps your ${formatPercent(r.targetMargin)} target margin.`,
      'below-target': `A ${d} discount is still profitable, but it cuts profit by ${formatPercent(r.reductionRate)} and falls below your ${formatPercent(r.targetMargin)} target margin. Up to ${formatPercent(r.targetDiscount, 1)} keeps the target.`,
      even: `A ${d} discount is the break-even discount: every cost, labor included, is paid, and nothing is left over.`,
      loss: r.regularProfitable
        ? `A ${d} discount is more than this service can carry: each discounted appointment loses ${money(after.amount, { cents: true })}. Above ${formatPercent(r.breakEvenDiscount, 1)} the service stops making money.`
        : `This ${service.phrase} loses money at full price, and a ${d} discount makes each appointment lose ${money(after.amount, { cents: true })}.`,
    }[r.status];
    const p = r.promo;
    if (p) {
      const diff = describeProfit(p.profitDifference);
      cards.push({ label: 'Total profit difference', value: diff.even ? '$0' : `${money(diff.amount)} ${diff.loss ? 'less' : 'more'}`, loss: diff.loss,
        note: `Over ${formatNumber(p.appointments, 0)} promotional appointments` });
      if (p.appointmentsToRecover > 0) cards.push({ label: 'Full-price appointments to earn it back', value: formatNumber(p.appointmentsToRecover, 0) });
    }
    const method = [
      `Sale price = ${money(r.regularPrice, { cents: true })} × (1 − ${d}) = ${money(r.salePrice, { cents: true })}.`,
      ...costMethod(v, r, type),
      `Profit = price − cost per appointment. Before: ${money(r.regularPrice, { cents: true })} − ${money(r.before.totalCost, { cents: true })} = ${profitText(r.before.profit, { cents: true })}. After: ${money(r.salePrice, { cents: true })} − ${money(r.after.totalCost, { cents: true })} = ${profitText(r.after.profit, { cents: true })}.`,
      `Break-even discount: the sale price where profit is $0 with labor paid is ${money(r.breakEvenSalePrice, { cents: true })}, ${formatPercent(r.breakEvenDiscount, 1)} below the regular price.`,
      `Maximum target-profit discount: the lowest sale price that keeps a ${formatPercent(r.targetMargin)} margin is ${money(r.targetSalePrice, { cents: true })} (commission and card fees are shares of the sale price, so they are grossed up like the margin).`,
      p ? `Promotion: ${formatNumber(p.appointments, 0)} appointments × each price and each profit, with and without the discount.` : 'Add promotional appointments to compare the whole promotion with and without the discount.',
    ];
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(r.salePrice, { cents: true }), label: `Sale price after a ${d} discount`, loss: after.loss,
          note: after.loss ? `Each appointment loses ${money(after.amount, { cents: true })}` : after.even ? 'Break-even: profit is $0' : `${money(r.after.profit, { cents: true })} profit an appointment` },
        cards, insight, method,
        extraNode: p ? () => promoTable(p, d) : null,
        share: { value: r.regularProfitable ? formatPercent(r.breakEvenDiscount, 0) : '0%', label: `the deepest discount a ${service.phrase} can take before it loses money`,
          insight: 'Know what a promotion costs before you run it.' },
      },
    };
  },
});
