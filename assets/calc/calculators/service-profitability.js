import { mountCalculator } from '../ui/framework.js';
import { calculateServiceProfitability } from '../core/profit.js';
import { formatMoney as money, describeProfit } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';

mountCalculator({
  unsupportedTypes: ['employee'],
  compute({ values: v, type }) {
    const owner = type === 'owner';
    const r = calculateServiceProfitability({
      price: v.price, durationMinutes: v.durationMinutes, productCost: v.productCost, supplyCost: v.supplyCost, overhead: v.overhead,
      processingRate: toRate(v.processingRate), laborCost: owner ? v.laborCost : 0, commissionRate: owner ? toRate(v.commissionRate) : 0,
      targetHourly: v.targetHourly,
    });
    if (!r.ok) return r;
    const p = describeProfit(r.profit);
    const ph = describeProfit(r.profitPerHour);
    const per = owner ? 'profit per hour' : 'effective hourly earnings';
    const insight = {
      loss: 'This service loses money each time it is performed. Review its price, how long it takes, or what goes into it.',
      even: 'This service breaks even: it covers its costs but leaves nothing over.',
      'below-target': `This service is profitable, but your ${per} ${owner ? 'is' : 'are'} below your target of ${money(r.targetHourly)}/hour.`,
      'meets-target': `This service is profitable and earns ${money(r.profitPerHour)}/hour, meeting your target of ${money(r.targetHourly)}/hour.`,
      profitable: `This service is profitable, earning about ${money(r.profitPerHour)} per hour. Add a target hourly rate under “Customize your calculation” to compare.`,
    }[r.status];
    const cards = [
      { label: 'Revenue', value: money(r.revenue) },
      { label: 'Total cost', value: money(r.totalCost, { cents: true }) },
      { label: 'Profit margin', value: p.loss ? `${formatPercent(-r.margin)} loss` : formatPercent(r.margin), loss: p.loss },
      { label: owner ? 'Profit per hour' : 'Your earnings per hour', value: ph.loss ? `Loss of ${money(ph.amount)}/hour` : `${money(r.profitPerHour)}/hour`, loss: ph.loss },
      { label: 'Revenue per hour', value: `${money(r.revenuePerHour)}/hour` },
    ];
    if (r.targetHourly > 0) cards.push({ label: 'Target hourly rate', value: `${money(r.targetHourly)}/hour`,
      note: r.hourlyGap > 0.005 ? `${money(r.hourlyGap)}/hour short` : 'Met' });
    const method = [
      `Costs: ${money(v.productCost, { cents: true })} product + ${money(v.supplyCost, { cents: true })} supplies + ${money(v.overhead, { cents: true })} overhead + ${money(r.processing, { cents: true })} card processing (${formatPercent(toRate(v.processingRate), 1)} of the price)` +
        (owner ? ` + ${money(v.laborCost, { cents: true })} labor + ${money(r.commission, { cents: true })} commission (${formatPercent(toRate(v.commissionRate), 1)})` : '') + ` = ${money(r.totalCost, { cents: true })}.`,
      `${p.word} = ${money(r.revenue, { cents: true })} price − ${money(r.totalCost, { cents: true })} costs.`,
      `Per hour = ${p.word.toLowerCase()} ÷ ${r.hours.toLocaleString('en-US', { maximumFractionDigits: 2 })} hours.`,
      owner ? 'Profit is what the business keeps after paying the provider.' : 'As a solo provider, the profit is also your pay for the time the service takes.',
    ];
    const pricing = new URLSearchParams({ currentPrice: String(v.price), durationMinutes: String(v.durationMinutes), productCost: r.consumables.toFixed(2), type });
    if (v.targetHourly > 0) pricing.set('targetHourly', String(v.targetHourly));
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(p.amount, { cents: p.amount < 100 }), label: p.loss ? 'Loss per appointment' : p.even ? 'Break-even per appointment' : 'Profit per appointment', loss: p.loss },
        cards, insight, method,
        cta: { href: `../service-pricing/?${pricing}`, text: 'Find a recommended price for this service →' },
        share: { value: formatPercent(Math.max(0, r.margin)), label: 'Service profit margin', insight: p.loss ? 'Time to rethink this service.' : 'Knowing what each service really earns.' },
      },
    };
  },
});
