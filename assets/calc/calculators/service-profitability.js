import { mountCalculator } from '../ui/framework.js';
import { calculateServiceProfitability } from '../core/profit.js';
import { formatMoney as money, describeProfit, formatNumber } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';
import { MIN_PROFIT_MARGIN, marginBelowText } from '../core/pricing.js';
import { serviceText } from '../ui/professions.js';

export const config = mountCalculator({
  unsupportedTypes: ['employee'],
  compute({ values: v, type, profession }) {
    const owner = type === 'owner';
    // labor: solo = your pay per hour × duration; owner = provider's hourly wage × duration + commission on the price
    const hourlyLabor = (owner ? v.providerWage : v.targetHourly) || 0;
    const r = calculateServiceProfitability({
      price: v.price, durationMinutes: v.durationMinutes, productCost: v.productCost, supplyCost: v.supplyCost, overhead: v.overhead,
      monthlyRent: v.monthlyRent, hoursPerMonth: v.hoursPerMonth,
      processingRate: toRate(v.processingRate), laborHourly: hourlyLabor, commissionRate: owner ? toRate(v.commissionRate) : 0,
      targetHourly: owner ? v.targetProfitPerHour : 0,
    });
    if (!r.ok) return r;
    const p = describeProfit(r.profit);
    const ph = describeProfit(r.profitPerHour);
    const hrs = `${formatNumber(r.hours, 2)} ${r.hours === 1 ? 'hour' : 'hours'}`;
    const service = serviceText(profession, v.durationMinutes);
    const insight = {
      loss: owner ? `This ${service.phrase} loses money each time it is performed, once the provider is paid. Review its price, how long it takes, or what goes into it.`
        : `This ${service.phrase} doesn’t cover your costs and your pay. Review its price, how long it takes, or what goes into it.`,
      even: owner ? 'This service breaks even: it covers its costs and labor but leaves nothing over.' : 'This service breaks even: it covers its costs and your pay, with no profit left over.',
      'below-minimum': `This ${service.phrase} earns a profit, but its ${marginBelowText(r.margin)} margin is below the ${formatPercent(MIN_PROFIT_MARGIN)} minimum, so it doesn’t count as profitable yet. The Service Pricing Calculator finds a price that keeps at least ${formatPercent(MIN_PROFIT_MARGIN)}.`,
      'below-target': `This ${service.phrase} is profitable, but its profit per hour is below your target of ${money(r.targetHourly)}/hour.`,
      'meets-target': `This ${service.phrase} is profitable and earns ${money(r.profitPerHour)}/hour after labor, meeting your target of ${money(r.targetHourly)}/hour.`,
      profitable: owner ? `This ${service.phrase} is profitable, earning about ${money(r.profitPerHour)} per hour after labor with a ${formatPercent(r.margin)} margin.`
        : `This ${service.phrase} is profitable: after paying yourself ${money(hourlyLabor)}/hour, it earns about ${money(r.profitPerHour)} per hour in profit.`,
    }[r.status];
    const laborNote = (owner ? `${money(hourlyLabor)}/hour wage × ${hrs}` : `${money(hourlyLabor)}/hour × ${hrs}`) +
      (r.commission > 0 ? ` + ${money(r.commission, { cents: true })} commission (${formatPercent(toRate(v.commissionRate), 1)})` : '');
    const cards = [
      { label: 'Revenue', value: money(r.revenue) },
      { label: 'Total cost', value: money(r.totalCost, { cents: true }), note: owner ? 'Labor included' : 'Your pay included' },
      { label: owner ? 'Labor for this service' : 'Your pay for this service', value: money(r.labor, { cents: true }),
        note: r.labor > 0 ? laborNote : owner ? 'No wage or commission entered' : 'No pay per hour entered' },
      { label: 'Rent for this service', value: money(r.rentShare, { cents: true }),
        note: r.rentShare > 0 ? `${money(r.rentPerHour, { cents: true })}/hour × ${hrs}` : 'No rent entered' },
      { label: 'Profit margin', value: p.loss ? `${formatPercent(-r.margin)} loss` : formatPercent(r.margin), loss: p.loss,
        note: r.status === 'below-minimum' ? `Below the ${formatPercent(MIN_PROFIT_MARGIN)} minimum` : undefined },
      { label: 'Profit per hour', value: ph.loss ? `Loss of ${money(ph.amount)}/hour` : `${money(r.profitPerHour)}/hour`, loss: ph.loss },
      { label: 'Revenue per hour', value: `${money(r.revenuePerHour)}/hour` },
    ];
    if (!owner) {
      const e = describeProfit(r.earningsPerHour);
      cards.push({ label: 'Your earnings per hour', value: e.loss ? `Loss of ${money(e.amount)}/hour` : `${money(r.earningsPerHour)}/hour`, loss: e.loss, note: 'Your pay + profit' });
    }
    if (r.targetHourly > 0) cards.push({ label: 'Target profit per hour', value: `${money(r.targetHourly)}/hour`,
      note: r.hourlyGap > 0.005 ? `${money(r.hourlyGap)}/hour short` : 'Met' });
    const method = [
      r.rentShare > 0
        ? `Rent for this service: ${money(v.monthlyRent)} rent ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(r.rentPerHour, { cents: true })}/hour × ${hrs} = ${money(r.rentShare, { cents: true })}.`
        : 'No rent was entered, so no rent is added.',
      owner
        ? `Labor: ${money(hourlyLabor)}/hour provider wage × ${hrs} = ${money(r.laborTime, { cents: true })}, + ${formatPercent(toRate(v.commissionRate), 1)} commission on the price = ${money(r.commission, { cents: true })}, so labor = ${money(r.labor, { cents: true })}.`
        : `Your pay: ${money(hourlyLabor)}/hour × ${hrs} = ${money(r.labor, { cents: true })}. It is counted as labor, so profit is what is left after you are paid.`,
      `Costs: ${money(v.productCost, { cents: true })} product + ${money(v.supplyCost, { cents: true })} supplies + ${money(r.rentShare, { cents: true })} rent + ${money(v.overhead, { cents: true })} other overhead + ${money(r.processing, { cents: true })} card processing (${formatPercent(toRate(v.processingRate), 1)} of the price)` +
        ` + ${money(r.labor, { cents: true })} labor = ${money(r.totalCost, { cents: true })}.`,
      `${p.word} = ${money(r.revenue, { cents: true })} price − ${money(r.totalCost, { cents: true })} costs.`,
      `Per hour = ${p.word.toLowerCase()} ÷ ${r.hours.toLocaleString('en-US', { maximumFractionDigits: 2 })} hours.`,
      `A service counts as profitable only with a margin of at least ${formatPercent(MIN_PROFIT_MARGIN)} (profit ÷ price); 50% or more is a strong margin.`,
      owner ? 'Profit is what the business keeps after paying the provider.' : 'Your earnings per hour = (your pay + profit) ÷ hours: everything this service leaves you.',
    ];
    // labor goes to its own fields in the pricing calculator (pay per hour, or wage + commission), rent to its own,
    // and only products and supplies to product cost, so nothing is counted twice
    const pricing = new URLSearchParams({ currentPrice: String(v.price), durationMinutes: String(v.durationMinutes), productCost: r.consumables.toFixed(2), type });
    if (hourlyLabor > 0) pricing.set(owner ? 'providerWage' : 'targetHourly', String(hourlyLabor));
    if (owner && r.commission > 0) pricing.set('commissionRate', String(v.commissionRate));
    if (r.rentShare > 0) { pricing.set('monthlyRent', String(v.monthlyRent)); pricing.set('hoursPerMonth', String(v.hoursPerMonth)); }
    if (profession) pricing.set('profession', profession);
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(p.amount, { cents: p.amount < 100 }), label: p.loss ? 'Loss per appointment' : p.even ? 'Break-even per appointment' : 'Profit per appointment', loss: p.loss },
        cards, insight, method, tone: r.tone,
        cta: { href: `../service-pricing/?${pricing}`, text: 'Find a recommended price for this service →' },
        share: { value: formatPercent(Math.max(0, r.margin)), label: `Profit margin on a ${service.phrase}`, insight: p.loss ? 'Time to rethink this service.' : 'Knowing what each service really earns.' },
      },
    };
  },
});
