import { mountCalculator } from '../ui/framework.js';
import { calculateServicePricing, MIN_PROFIT_MARGIN } from '../core/pricing.js';
import { formatMoney as money, describeProfit, formatNumber } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';
import { serviceText } from '../ui/professions.js';

const SHARE_INSIGHT = {
  under: 'Time for a price check: this service was priced below what it takes to deliver it well.',
  within: 'Priced right: this service covers its costs, time and profit.',
  above: 'Priced with room to spare above costs, time and profit.',
  none: 'A price that covers costs, values time and supports business goals.',
};

export const config = mountCalculator({
  unsupportedTypes: ['employee'],
  compute({ values: v, type, profession }) {
    const owner = type === 'owner';
    // labor: a solo provider's own pay per hour; an owner's provider wage per hour plus commission on the price.
    // There is no monthly-pay field here, so a solo provider's pay is never counted twice.
    const hourlyLabor = (owner ? v.providerWage : v.targetHourly) || 0;
    const r = calculateServicePricing({
      currentPrice: v.currentPrice, durationMinutes: v.durationMinutes, productCost: v.productCost, targetHourly: hourlyLabor,
      monthlyRent: v.monthlyRent, hoursPerMonth: v.hoursPerMonth,
      monthlyFixed: v.monthlyFixed, monthlyVariable: v.monthlyVariable, monthlyAppointments: v.monthlyAppointments,
      processingRate: toRate(v.processingRate), profitMargin: toRate(v.profitMargin), nonClientHoursPerMonth: v.nonClientHours,
      commissionRate: owner ? toRate(v.commissionRate) : 0,
    });
    if (!r.ok) return r;
    const at = r.current || r.recommended;
    const where = r.current ? 'at your current price' : 'at the recommended price';
    const p = describeProfit(at.profit);
    const hourly = describeProfit(at.effectiveHourly);
    const timeWord = owner ? 'labor' : 'your pay';
    const hrs = `${formatNumber(r.hours, 2)} ${r.hours === 1 ? 'hour' : 'hours'}`;
    const service = serviceText(profession, v.durationMinutes);
    const commissionPct = formatPercent(r.commissionRate, 1);
    const laborNote = owner
      ? `${money(hourlyLabor)}/hour wage × ${hrs}` + (r.commissionRate > 0 ? ` + ${commissionPct} commission (${money(r.commissionAtRecommended, { cents: true })} at the recommended price)` : '')
      : `${money(hourlyLabor)}/hour × ${hrs}` + (r.loadFactor > 1 ? ', with non-client hours' : '');
    const cards = [
      { label: 'Current price', value: r.current ? money(r.current.price) : 'Not entered' },
      { label: 'Break-even price', value: money(r.breakEvenPrice), note: 'Covers products, rent and other overhead, with $0 for ' + timeWord },
      { label: 'Recommended price', value: money(r.recommendedPrice, { up: true }) },
      { label: owner ? 'Labor for this service' : 'Your pay for this service', value: money(r.laborAtRecommended, { cents: true }), note: laborNote },
      { label: `Estimated ${p.word.toLowerCase()} ${where}`, value: money(p.amount), loss: p.loss, note: `After paying ${timeWord}` },
      { label: `Profit margin ${where}`, value: p.loss ? `${formatPercent(-at.margin)} loss` : formatPercent(at.margin), loss: p.loss || r.currentBelowMinimum,
        note: r.currentBelowMinimum ? `Below the ${formatPercent(MIN_PROFIT_MARGIN)} minimum` : undefined },
      { label: `${owner ? 'Labor + profit' : 'Effective hourly earnings'} ${where}`, value: hourly.loss ? `Loss of ${money(hourly.amount)}/hour` : `${money(at.effectiveHourly)}/hour`, loss: hourly.loss },
    ];
    cards.push({ label: 'Rent for this service', value: money(r.rentShare, { cents: true }),
      note: r.rentShare > 0 ? `${money(r.rentPerHour, { cents: true })}/hour × ${hrs}` : 'No rent entered' });
    if (r.current) {
      cards.push({ label: 'Difference from current price', value: money(Math.abs(r.shownDifference)),
        note: r.shownDifference > 0.005 ? 'Below the recommended price' : r.shownDifference < -0.005 ? 'Above the recommended price' : 'Matches the recommended price' });
    }
    const minimum = formatPercent(MIN_PROFIT_MARGIN);
    const belowMinimum = !r.currentBelowMinimum ? ''
      : p.loss ? ` At ${money(r.current.price)} it loses money once ${timeWord} is paid, so it is below the ${minimum} minimum profit margin.`
        : ` At ${money(r.current.price)} it keeps a ${formatPercent(r.current.margin)} profit margin, below the ${minimum} minimum.`;
    const insight = {
      under: `You're currently underpricing this service by approximately ${money(r.shownDifference)}.${belowMinimum}`,
      within: 'Your current price is within your recommended range.',
      above: `Your current price is above your recommended range by ${money(r.aboveRangeBy)}. That works as long as clients keep booking.`,
      none: owner
        ? `Charge at least ${money(r.recommendedPrice, { up: true })} for this ${service.phrase} to cover its costs and labor (${money(hourlyLabor)}/hour${r.commissionRate > 0 ? ` + ${commissionPct} commission` : ''}) and keep a ${formatPercent(toRate(v.profitMargin))} profit margin.`
        : `Charge at least ${money(r.recommendedPrice, { up: true })} for this ${service.phrase} to cover your costs, pay yourself ${money(hourlyLabor)}/hour and keep a ${formatPercent(toRate(v.profitMargin))} profit margin.`,
    }[r.status];
    const method = [
      `${owner ? 'Labor (wage)' : 'Your pay'}: ${money(hourlyLabor)}/hour × ${hrs}` +
        (r.loadFactor > 1 ? ` × ${formatNumber(r.loadFactor, 2)} (so client hours also pay for ${formatNumber(v.nonClientHours)} non-client hours a month)` : '') +
        ` = ${money(r.timeValue, { cents: true })}.`,
      owner
        ? (r.commissionRate > 0
          ? `Labor (commission): ${commissionPct} of the price, ${money(r.commissionAtRecommended, { cents: true })} at the recommended price. Like card processing, it is a share of the final price, so the price is grossed up for it.`
          : 'No commission was entered, so labor is the provider’s wage only.')
        : 'As a solo provider your labor is your pay per hour. Monthly pay is not added on top, so your pay is never counted twice.',
      r.rentShare > 0
        ? `Rent for this service: ${money(v.monthlyRent)} rent ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(r.rentPerHour, { cents: true })}/hour × ${hrs} = ${money(r.rentShare, { cents: true })}.`
        : 'No rent was entered, so no rent is added.',
      r.overhead > 0
        ? `Other overhead per appointment: (${money(v.monthlyFixed)} other fixed + ${money(v.monthlyVariable)} other variable) ÷ ${formatNumber(v.monthlyAppointments)} appointments = ${money(r.overhead, { cents: true })}. Rent is not in these, so it is never counted twice.`
        : 'No other monthly expenses were entered, so no other overhead is added. Add them under “Customize your calculation” for a truer price.',
      `Products and supplies: ${money(v.productCost, { cents: true })}.`,
      `Recommended price = (${owner ? 'wage' : 'your pay'} + products + rent + other overhead) ÷ (1 − ${formatPercent(toRate(v.processingRate), 1)} processing` +
        (owner ? ` − ${commissionPct} commission` : '') + ` − ${formatPercent(toRate(v.profitMargin), 1)} margin). Solving it this way charges the card fee${owner ? ' and commission' : ''} on the final price, so nothing is left out.`,
      `The profit margin is at least ${minimum}; a lower margin is not accepted. Processing${owner ? ', commission' : ''} and margin together must stay below 100% of the price.`,
      'Break-even price = (products + rent + other overhead) ÷ (1 − processing): the lowest price that covers costs before paying anyone for their time.',
      'The recommended range runs from the recommended price to 10% above it, leaving room to round to a menu-friendly number.',
      'Profit here means what is left after costs and after paying ' + timeWord + '.',
    ];
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(r.recommendedPrice, { up: true }), label: 'Recommended service price', note: `Recommended range: ${money(r.range.low, { up: true })}–${money(r.range.high, { whole: true })}` },
        cards, insight, method,
        share: { value: money(r.recommendedPrice, { up: true }), label: `Recommended price for a ${service.phrase}`, insight: SHARE_INSIGHT[r.status] },
      },
    };
  },
});
