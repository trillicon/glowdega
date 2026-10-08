// Shared by calculators that price one service (price increase, discount): which fields carry labor for each business
// type, and the method lines that explain the rent share and labor. Wording and field mapping only; no formulas.
import { formatMoney as money, formatNumber } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';

/**
 * Engine inputs for serviceCostParts(). Labor, each type in its own field so nothing is counted twice:
 * solo = your pay per hour; owner = the provider's hourly wage + commission (a share of the price).
 */
export function costInputs(v, type) {
  const owner = type === 'owner';
  return {
    durationMinutes: v.durationMinutes, productCost: v.productCost, overhead: v.overhead || 0, monthlyRent: v.monthlyRent,
    hoursPerMonth: v.hoursPerMonth, processingRate: toRate(v.processingRate),
    laborHourly: (owner ? v.providerWage : v.targetHourly) || 0, commissionRate: owner ? toRate(v.commissionRate) : 0,
  };
}

const hoursText = (h) => `${formatNumber(h, 2)} ${h === 1 ? 'hour' : 'hours'}`;

/** "How we calculated this" lines for rent and labor, from the engine's parts. */
export function costMethod(v, parts, type) {
  const owner = type === 'owner';
  const hrs = hoursText(parts.hours);
  return [
    parts.rentShare > 0
      ? `Rent for this service: ${money(v.monthlyRent)} rent ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(parts.rentPerHour, { cents: true })}/hour × ${hrs} = ${money(parts.rentShare, { cents: true })}.`
      : 'No rent was entered, so no rent is added.',
    owner
      ? `Labor: ${money(parts.laborHourly, { cents: true })}/hour provider wage × ${hrs} = ${money(parts.laborTime, { cents: true })}` +
        (parts.commissionRate > 0 ? `, plus ${formatPercent(parts.commissionRate, 1)} commission on whatever price is charged.` : '. No commission was entered.')
      : `Your pay (labor): ${money(parts.laborHourly, { cents: true })}/hour × ${hrs} = ${money(parts.laborTime, { cents: true })}. It is a cost, so profit is what is left after you are paid.`,
    `Cost per appointment = ${money(v.productCost, { cents: true })} product/supply` + (parts.overhead > 0 ? ` + ${money(parts.overhead, { cents: true })} other overhead` : '') +
      ` + ${money(parts.rentShare, { cents: true })} rent + ${money(parts.laborTime, { cents: true })} ${owner ? 'wage' : 'your pay'} = ${money(parts.fixedPerService, { cents: true })}` +
      (parts.priceRate > 0 ? `, plus ${formatPercent(parts.priceRate, 1)} of the price for ${[parts.commissionRate > 0 ? 'commission' : '', parts.processingRate > 0 ? 'card processing' : ''].filter(Boolean).join(' and ')}.` : '.'),
  ];
}

/** The labor card shared by both calculators. */
export function laborCard(parts, type, at) {
  const owner = type === 'owner';
  return { label: owner ? 'Labor per appointment' : 'Your pay per appointment', value: money(at.labor, { cents: true }),
    note: at.labor > 0 ? `${money(parts.laborHourly, { cents: true })}/hour × ${hoursText(parts.hours)}` + (at.commission > 0 ? ` + ${money(at.commission, { cents: true })} commission` : '')
      : owner ? 'No wage or commission entered' : 'No pay per hour entered' };
}
