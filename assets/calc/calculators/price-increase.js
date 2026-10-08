import { mountCalculator } from '../ui/framework.js';
import { calculatePriceIncrease } from '../core/pricing.js';
import { formatMoney as money, formatNumber, describeProfit } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';
import { serviceText } from '../ui/professions.js';
import { costInputs, costMethod, laborCard } from '../ui/service-costs.js';

// a change in words, never a negative amount: "+$900", "$900 less", "$0"
const signed = (x, opts) => { const d = describeProfit(x); return d.even ? '$0' : d.loss ? `${money(d.amount, opts)} less` : `+${money(d.amount, opts)}`; };
const profitText = (x, opts) => { const d = describeProfit(x); return d.loss ? `Loss of ${money(d.amount, opts)}` : money(d.amount, opts); };

export const config = mountCalculator({
  compute({ values: v, type, profession }) {
    const r = calculatePriceIncrease({ currentPrice: v.currentPrice, newPrice: v.newPrice, monthlyAppointments: v.monthlyAppointments,
      expectedLossRate: toRate(v.expectedLoss), ...costInputs(v, type) });
    if (!r.ok) return r;
    const service = serviceText(profession, v.durationMinutes);
    const cur = r.current, next = r.next;
    const lossEntered = r.expectedLossRate > 0;
    const cards = [
      { label: 'Current monthly revenue', value: money(cur.revenue), note: `${formatNumber(cur.appointments, 0)} × ${money(cur.price)}` },
      { label: 'New monthly revenue', value: money(next.revenue), note: `${formatNumber(next.appointments, 1)} × ${money(next.price)}` + (lossEntered ? `, after ${formatPercent(r.expectedLossRate, 1)} fewer clients` : '') },
      { label: 'Monthly revenue change', value: signed(r.revenueIncrease), loss: r.revenueIncrease < -0.005 },
      { label: 'Annual revenue change', value: signed(r.annualRevenueIncrease), loss: r.annualRevenueIncrease < -0.005 },
      { label: 'Current monthly profit', value: profitText(cur.monthlyProfit), loss: cur.monthlyProfit < -0.005, note: `${profitText(cur.profit, { cents: true })} an appointment` },
      { label: 'New monthly profit', value: profitText(next.monthlyProfit), loss: next.monthlyProfit < -0.005, note: `${profitText(next.profit, { cents: true })} an appointment` },
      { label: 'Rent per appointment', value: money(r.rentShare, { cents: true }), note: r.rentShare > 0 ? `${money(r.rentPerHour, { cents: true })}/hour of service time` : 'No rent entered' },
      laborCard(r, type, next),
    ];
    let primary, insight, share;
    if (r.status === 'none') {
      primary = { value: 'No change', label: 'The new price matches the current price' };
      insight = 'Enter a different new price to see what the change does to your revenue and profit.';
      share = { value: 'No change', label: 'Price check', insight: 'Know what a price change is worth before you make it.' };
    } else if (r.status === 'increase') {
      primary = { value: formatNumber(r.clientsYouCanLoseWhole, 0), label: 'Clients a month you could lose and keep the same service revenue',
        note: `${formatPercent(r.lossRateYouCanAbsorb, 1)} of this service’s ${formatNumber(cur.appointments, 0)} monthly clients` };
      insight = r.clientsYouCanLoseWhole >= 1
        ? `You could lose approximately ${formatNumber(r.clientsYouCanLoseWhole, 0)} ${r.clientsYouCanLoseWhole === 1 ? 'client' : 'clients'} per month and generate the same service revenue.`
        : `This increase is small enough that losing even one client a month would bring revenue below where it is now.`;
      if (lossEntered) insight += ` With the ${formatPercent(r.expectedLossRate, 1)} client loss you expect, monthly profit ${r.profitIncrease >= 0 ? 'rises' : 'falls'} by ${money(Math.abs(r.profitIncrease))}.`;
      else insight += ` If nobody leaves, monthly profit rises by ${money(r.profitIncrease)}.`;
      share = { value: formatNumber(r.clientsYouCanLoseWhole, 0), label: 'clients I could lose after a price increase and keep the same revenue', insight: `Raising the price of a ${service.phrase} is less risky than it feels.` };
    } else {
      primary = { value: formatNumber(r.clientsToGainWhole, 0), label: 'More clients a month needed to keep the same service revenue', loss: true };
      insight = `This is a price cut. To bring in the same service revenue at ${money(v.newPrice)}, you would need about ${formatNumber(r.clientsToGainWhole, 0)} more ${r.clientsToGainWhole === 1 ? 'client' : 'clients'} a month.`;
      share = { value: formatNumber(r.clientsToGainWhole, 0), label: 'more clients a month a price cut would need', insight: 'Know what a price change is worth before you make it.' };
    }
    const method = [
      ...costMethod(v, r, type),
      `Monthly revenue = price × appointments. Current: ${money(cur.price)} × ${formatNumber(cur.appointments, 0)} = ${money(cur.revenue)}. New: ${money(next.price)} × ${formatNumber(next.appointments, 1)} = ${money(next.revenue)}.`,
      lossEntered ? `New appointments = ${formatNumber(cur.appointments, 0)} × (1 − ${formatPercent(r.expectedLossRate, 1)} expected client loss) = ${formatNumber(next.appointments, 1)}.` : 'No client loss was entered, so the new price is shown with the same number of appointments.',
      `Monthly profit = appointments × (price − cost per appointment at that price). Current: ${money(cur.totalCost, { cents: true })} cost an appointment; new: ${money(next.totalCost, { cents: true })}.`,
      `Clients you could lose = ${formatNumber(cur.appointments, 0)} − (current revenue ${money(cur.revenue)} ÷ new price ${money(next.price)} = ${formatNumber(r.breakEvenClients, 1)}) = ${formatNumber(r.clientsYouCanLose, 1)}, rounded down to whole clients so revenue never drops.`,
      'Rent is shared by the hour, so the time freed by a client who leaves is assumed to go to other work. Annual = monthly × 12.',
    ];
    return { ok: true, raw: r, view: { primary, cards, insight, method, share } };
  },
});
