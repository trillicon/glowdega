// Service menu profitability: every service through calculateServiceProfitability, then ranked. Pure.
import { calculateServiceProfitability } from './profit.js';
import { guard } from './validation.js';
import { MIN_PROFIT_MARGIN, STRONG_PROFIT_MARGIN } from './pricing.js';

export const MAX_MENU_SERVICES = 30;
const CENT = 0.005;
// Profit per hour within this share of the best service counts as "about the same": no service is singled out.
export const SIMILAR_SHARE = 0.10;

const ROW_KEYS = { price: 'price', durationMinutes: 'durationMinutes', productCost: 'productCost', supplyCost: 'supplyCost',
  laborHourly: 'laborHourly', commissionRate: 'commissionRate' };

/**
 * services: [{ name, price, durationMinutes, productCost, supplyCost, laborHourly, commissionRate }]
 *   laborHourly: solo = your pay per hour (the same for every service); owner = each service's provider wage
 *   commissionRate: owners only, a share of each service's price
 * Each service: rent share = monthly rent ÷ hours worked per month × its hours; profit = price − products − supplies
 * − rent share − processing − labor; margin = profit ÷ price; per hour = ÷ hours.
 * Rankings (two or more services): most profit per appointment, most profit per hour, highest margin, and the lowest
 * profit per hour. Ties and near-ties (within 10% of the best per hour) are reported, not hidden.
 */
export function calculateMenuProfitability({ services, monthlyRent = 0, hoursPerMonth, processingRate = 0 }) {
  const errors = guard([['processingRate', processingRate, (v) => v >= 0 && v < 1, 'Enter a payment processing rate below 100%.']]);
  const list = services || [];
  if (!list.length) errors._ = 'Add at least one service with a price and duration.';
  if (list.length > MAX_MENU_SERVICES) errors._ = `Compare up to ${MAX_MENU_SERVICES} services at a time.`;
  const rows = [];
  list.forEach((s, i) => {
    const r = calculateServiceProfitability({ price: s.price, durationMinutes: s.durationMinutes, productCost: s.productCost ?? 0,
      supplyCost: s.supplyCost ?? 0, monthlyRent, hoursPerMonth, processingRate, laborHourly: s.laborHourly ?? 0, commissionRate: s.commissionRate ?? 0 });
    if (!r.ok) {
      for (const [k, m] of Object.entries(r.errors)) errors[ROW_KEYS[k] ? `${ROW_KEYS[k]}-${i}` : k] = m;
      return;
    }
    rows.push({ index: i, name: String(s.name || '').trim() || `Service ${i + 1}`, durationMinutes: s.durationMinutes, ...r });
  });
  if (Object.keys(errors).length) return { ok: false, errors };
  const best = (key, sign = 1) => rows.reduce((a, b) => (sign * (b[key] - a[key]) > CENT ? b : a));
  const tied = (key, row) => rows.filter((r) => r !== row && Math.abs(r[key] - row[key]) <= CENT).map((r) => r.index);
  const comparing = rows.length > 1;
  const pick = (key, sign) => { const row = best(key, sign); return { index: row.index, value: row[key], tiedWith: tied(key, row) }; };
  const rankings = comparing ? {
    profit: pick('profit', 1), profitPerHour: pick('profitPerHour', 1), margin: pick('margin', 1), lowest: pick('profitPerHour', -1),
  } : null;
  let similar = false;
  if (comparing) {
    const top = rankings.profitPerHour.value, low = rankings.lowest.value;
    similar = low > CENT && top - low <= Math.max(1, Math.abs(top) * SIMILAR_SHARE);
  }
  // highest profit per hour first: the order a service menu review usually starts from
  const order = [...rows].sort((a, b) => b.profitPerHour - a.profitPerHour || a.index - b.index).map((r) => r.index);
  return { ok: true, services: rows, order, rankings, similar, comparing,
    lossIndexes: rows.filter((r) => r.profit < -CENT).map((r) => r.index), count: rows.length,
    // the shared 30% rule: services that make money on a margin under 30% (not counted as profitable)
    belowMinimumIndexes: rows.filter((r) => r.status === 'below-minimum').map((r) => r.index),
    lowestMargin: Math.min(...rows.map((r) => r.margin)),
    // the menu's tone is its weakest service: any loss, break-even or margin under 30% → 'warn'; all 50%+ → 'strong'
    tone: rows.some((r) => r.tone === 'warn') ? 'warn' : rows.every((r) => r.tone === 'strong') ? 'strong' : 'ok',
    minimumMargin: MIN_PROFIT_MARGIN, strongMargin: STRONG_PROFIT_MARGIN };
}
