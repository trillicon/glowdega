import { mountCalculator } from '../ui/framework.js';
import { calculateServicePricing } from '../core/pricing.js';
import { formatMoney as money, describeProfit, formatNumber } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';

const SHARE_INSIGHT = {
  under: 'Time for a price check: this service was priced below what it takes to deliver it well.',
  within: 'Priced right: this service covers its costs, time and profit.',
  above: 'Priced with room to spare above costs, time and profit.',
  none: 'A price that covers costs, values time and supports business goals.',
};

mountCalculator({
  unsupportedTypes: ['employee'],
  compute({ values: v, type }) {
    const r = calculateServicePricing({
      currentPrice: v.currentPrice, durationMinutes: v.durationMinutes, productCost: v.productCost, targetHourly: v.targetHourly,
      monthlyFixed: v.monthlyFixed, monthlyVariable: v.monthlyVariable, monthlyAppointments: v.monthlyAppointments,
      processingRate: toRate(v.processingRate), profitMargin: toRate(v.profitMargin), nonClientHoursPerMonth: v.nonClientHours,
    });
    if (!r.ok) return r;
    const owner = type === 'owner';
    const at = r.current || r.recommended;
    const where = r.current ? 'at your current price' : 'at the recommended price';
    const p = describeProfit(at.profit);
    const hourly = describeProfit(at.effectiveHourly);
    const timeWord = owner ? 'labor' : 'your time';
    const cards = [
      { label: 'Current price', value: r.current ? money(r.current.price) : 'Not entered' },
      { label: 'Break-even price', value: money(r.breakEvenPrice), note: 'Covers products and overhead, with $0 for ' + timeWord },
      { label: 'Recommended price', value: money(r.recommendedPrice, { up: true }) },
      { label: `Estimated ${p.word.toLowerCase()} ${where}`, value: money(p.amount), loss: p.loss, note: `After paying ${timeWord} at ${money(v.targetHourly)}/hour` },
      { label: `Profit margin ${where}`, value: p.loss ? `${formatPercent(-at.margin)} loss` : formatPercent(at.margin), loss: p.loss },
      { label: `${owner ? 'Labor + profit' : 'Effective hourly earnings'} ${where}`, value: hourly.loss ? `Loss of ${money(hourly.amount)}/hour` : `${money(at.effectiveHourly)}/hour`, loss: hourly.loss },
    ];
    if (r.current) {
      cards.push({ label: 'Difference from current price', value: money(Math.abs(r.shownDifference)),
        note: r.shownDifference > 0.005 ? 'Below the recommended price' : r.shownDifference < -0.005 ? 'Above the recommended price' : 'Matches the recommended price' });
    }
    const insight = {
      under: `You're currently underpricing this service by approximately ${money(r.shownDifference)}.`,
      within: 'Your current price is within your recommended range.',
      above: `Your current price is above your recommended range by ${money(r.aboveRangeBy)}. That works as long as clients keep booking.`,
      none: `Charge at least ${money(r.recommendedPrice, { up: true })} to cover your costs, pay ${timeWord} ${money(v.targetHourly)}/hour and keep a ${formatPercent(toRate(v.profitMargin))} profit margin.`,
    }[r.status];
    const method = [
      `${owner ? 'Labor' : 'Your time'}: ${money(v.targetHourly)}/hour × ${formatNumber(r.hours, 2)} ${r.hours === 1 ? 'hour' : 'hours'}` +
        (r.loadFactor > 1 ? ` × ${formatNumber(r.loadFactor, 2)} (so client hours also pay for ${formatNumber(v.nonClientHours)} non-client hours a month)` : '') +
        ` = ${money(r.timeValue, { cents: true })}.`,
      r.overhead > 0
        ? `Overhead per appointment: (${money(v.monthlyFixed)} fixed + ${money(v.monthlyVariable)} variable) ÷ ${formatNumber(v.monthlyAppointments)} appointments = ${money(r.overhead, { cents: true })}.`
        : 'No monthly expenses were entered, so no overhead is added. Add them under “Customize your calculation” for a truer price.',
      `Products and supplies: ${money(v.productCost, { cents: true })}.`,
      `Recommended price = (${timeWord} + overhead + products) ÷ (1 − ${formatPercent(toRate(v.processingRate), 1)} processing − ${formatPercent(toRate(v.profitMargin), 1)} margin). Solving it this way charges the card fee on the final price, so nothing is left out.`,
      'Break-even price = (products + overhead) ÷ (1 − processing): the lowest price that covers costs before paying anyone for their time.',
      'The recommended range runs from the recommended price to 10% above it, leaving room to round to a menu-friendly number.',
      'Profit here means what is left after costs and after paying ' + timeWord + ' at the target rate.',
    ];
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(r.recommendedPrice, { up: true }), label: 'Recommended service price', note: `Recommended range: ${money(r.range.low, { up: true })}–${money(r.range.high, { whole: true })}` },
        cards, insight, method,
        share: { value: money(r.recommendedPrice, { up: true }), label: 'Recommended service price', insight: SHARE_INSIGHT[r.status] },
      },
    };
  },
});
