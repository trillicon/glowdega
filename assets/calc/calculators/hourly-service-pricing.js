import { mountCalculator } from '../ui/framework.js';
import { calculateHourlyServicePricing, BILLING_STEP_MINUTES } from '../core/hourly-pricing.js';
import { MIN_PROFIT_MARGIN } from '../core/pricing.js';
import { formatMoney as money, formatNumber } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';
import { longService } from '../ui/professions.js';

// lengths read in hours ("5.5 hours"), never as an example "N-minute service"
const hoursText = (h) => `${formatNumber(h, 2)} ${h === 1 ? 'hour' : 'hours'}`;
const minutesText = (m) => `${formatNumber(m, 0)} ${m === 1 ? 'minute' : 'minutes'}`;

export const config = mountCalculator({
  unsupportedTypes: ['employee'],
  compute({ values: v, type, profession }) {
    const owner = type === 'owner';
    // labor: solo = your pay per hour; owner = the provider's hourly wage + commission on the price
    const r = calculateHourlyServicePricing({
      estimatedMinutes: v.estimatedMinutes, laborHourly: (owner ? v.providerWage : v.targetHourly) || 0,
      commissionRate: owner ? toRate(v.commissionRate) : 0, monthlyRent: v.monthlyRent, hoursPerMonth: v.hoursPerMonth,
      overhead: v.overhead, productFixed: v.productFixed, productPerHour: v.productPerHour, supplyCost: v.supplyCost,
      processingRate: toRate(v.processingRate), profitMargin: toRate(v.profitMargin), unbillableMinutes: v.unbillableMinutes,
      minimumMinutes: v.minimumMinutes, depositRate: toRate(v.depositRate),
    });
    if (!r.ok) return r;
    const long = longService(profession);
    const rate = `${money(r.hourlyRate)}/hour`;
    const billedWhy = r.minimumApplies ? `your ${hoursText(r.billedHours)} minimum booking`
      : r.extraBilledMinutes > 0 ? `${hoursText(r.serviceHours)} rounded up to the next half hour` : 'exactly the estimated length';
    const timeWord = owner ? 'labor' : 'your pay';
    const cents = { cents: true };
    const cards = [
      { label: 'Price for the estimated length', value: money(r.price, cents), note: `${rate} × ${hoursText(r.billedHours)} billed` },
      { label: 'Billed time', value: hoursText(r.billedHours), note: billedWhy },
      { label: 'Deposit at booking', value: r.depositRate > 0 ? money(r.deposit, cents) : 'None', note: r.depositRate > 0 ? `${formatPercent(r.depositRate, 1)} of the price; ${money(r.balance, cents)} due at the appointment` : 'No deposit entered' },
      { label: 'Profit margin', value: formatPercent(r.margin, 1), note: `${money(r.profit, cents)} profit after every cost and ${timeWord}` },
      { label: owner ? 'Labor' : 'Your pay', value: money(r.labor, cents),
        note: `${money(r.laborHourly)}/hour × ${hoursText(r.workedHours)} worked` + (r.commission > 0 ? ` + ${money(r.commission, cents)} commission (${formatPercent(r.commissionRate, 1)})` : '') },
      { label: 'Rent', value: money(r.rentShare, cents), note: r.rentShare > 0 ? `${money(r.rentPerHour, cents)}/hour × ${hoursText(r.workedHours)} worked` : 'No rent entered' },
      { label: 'Products', value: money(r.product, cents), note: `${money(r.productFixed, cents)} fixed + ${money(r.productPerHour, cents)}/hour × ${hoursText(r.serviceHours)}` },
      { label: 'Supplies', value: money(r.supplyCost, cents) },
      { label: 'Other overhead', value: money(r.overhead, cents) },
      { label: 'Card processing', value: money(r.processing, cents), note: `${formatPercent(r.processingRate, 1)} of the price` },
      { label: 'Total cost', value: money(r.totalCost, cents), note: owner ? 'Labor and commission included' : 'Your pay included' },
    ];
    const unbillable = r.unbillableMinutes > 0
      ? ` It also pays for ${minutesText(r.unbillableMinutes)} of consultation, setup and cleanup you don’t bill.` : '';
    const insight = `Charge ${rate} for a long service like a ${long}. At ${hoursText(r.serviceHours)}, billed as ${hoursText(r.billedHours)}, this one comes to ${money(r.price, cents)}`
      + (r.depositRate > 0 ? `, with a ${money(r.deposit, cents)} deposit at booking` : '')
      + `. That covers every cost and ${timeWord} and keeps a ${formatPercent(r.margin, 1)} profit margin.${unbillable}`;
    const method = [
      `Time worked = ${minutesText(r.estimatedMinutes)} service + ${minutesText(r.unbillableMinutes)} unbillable = ${hoursText(r.workedHours)}. Setup, consultation and cleanup are paid time and use the room, so labor and rent count them; they are never billed.`,
      `${owner ? 'Labor' : 'Your pay'}: ${money(r.laborHourly)}/hour × ${hoursText(r.workedHours)} = ${money(r.laborTime, cents)}.` + (owner ? ` Commission is ${formatPercent(r.commissionRate, 1)} of the price.` : ''),
      r.rentShare > 0 ? `Rent: ${money(v.monthlyRent)} ÷ ${formatNumber(v.hoursPerMonth)} hours worked a month = ${money(r.rentPerHour, cents)}/hour × ${hoursText(r.workedHours)} = ${money(r.rentShare, cents)}.` : 'No rent was entered, so no rent is added.',
      `Products: ${money(r.productFixed, cents)} fixed per appointment + ${money(r.productPerHour, cents)}/hour × ${hoursText(r.serviceHours)} of service = ${money(r.product, cents)}.`,
      `Costs = ${owner ? 'labor' : 'your pay'} + rent + products + ${money(r.supplyCost, cents)} supplies + ${money(r.overhead, cents)} other overhead = ${money(r.costs, cents)}.`,
      `Price needed = ${money(r.costs, cents)} ÷ (1 − ${formatPercent(r.processingRate, 1)} processing` + (owner ? ` − ${formatPercent(r.commissionRate, 1)} commission` : '')
        + ` − ${formatPercent(r.profitMargin, 1)} margin) = ${money(r.priceNeeded, cents)}. Hourly rate = that ÷ ${hoursText(r.serviceHours)} = ${money(r.exactRate, cents)}, rounded up to ${rate}.`,
      `Billed time = the longer of the service and the minimum booking, rounded up in steps of ${minutesText(BILLING_STEP_MINUTES)} (a half hour): ${hoursText(r.billedHours)}. Price = ${rate} × ${hoursText(r.billedHours)} = ${money(r.price, cents)}.`,
      r.depositRate > 0 ? `Deposit = ${formatPercent(r.depositRate, 1)} × ${money(r.price, cents)} = ${money(r.deposit, cents)}.` : 'No deposit was entered.',
      `The profit margin is at least ${formatPercent(MIN_PROFIT_MARGIN)}; a lower margin is not accepted. Rounding the rate up and billing whole half hours only ever adds to it. 50% or more is a strong margin.`,
    ];
    return {
      ok: true, raw: r,
      view: {
        primary: { value: rate, label: 'Recommended hourly rate', note: `${money(r.price, cents)} for ${hoursText(r.serviceHours)} of service (${hoursText(r.billedHours)} billed)` },
        cards, insight, method, tone: r.tone,
        share: { value: rate, label: `Hourly rate for a long service like a ${long}`, insight: 'Long services priced by the hour, with setup and cleanup paid for.' },
      },
    };
  },
});
