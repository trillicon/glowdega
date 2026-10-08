// Cost per service: totals of product, supply and other consumable line items.
import { guard } from './validation.js';
import { allocateRent, DEFAULT_HOURS_PER_MONTH } from './overhead.js';

export const CATEGORIES = ['product', 'supply', 'other'];

/** items: [{ category, quantity, unitCost }]. Supply cost includes "other consumables". */
export function calculateConsumableCost(items) {
  const errors = {};
  const totals = { product: 0, supply: 0, other: 0 };
  const lines = [];
  (items || []).forEach((it, i) => {
    const e = guard([
      [`quantity-${i}`, it.quantity, (v) => v >= 0, 'Enter a quantity of 0 or more.'],
      [`unitCost-${i}`, it.unitCost, (v) => v >= 0, 'Enter a unit cost of $0 or more.'],
    ]);
    if (!CATEGORIES.includes(it.category)) e[`category-${i}`] = 'Choose product, supply or other consumable.';
    Object.assign(errors, e);
    const line = Object.keys(e).length ? 0 : it.quantity * it.unitCost;
    lines.push(line);
    if (!Object.keys(e).length) totals[it.category] += line;
  });
  if (Object.keys(errors).length) return { ok: false, errors };
  const supplyTotal = totals.supply + totals.other;
  const total = totals.product + supplyTotal;
  let largestIndex = 0;
  lines.forEach((l, i) => { if (l > lines[largestIndex]) largestIndex = i; });
  return { ok: true, largestIndex, largestShare: total > 0 ? lines[largestIndex] / total : 0, lines, productCost: totals.product, supplyOnly: totals.supply, otherCost: totals.other,
    supplyCost: supplyTotal, totalCost: total, itemCount: lines.filter((l) => l > 0).length };
}

/**
 * True cost of one service = product cost + supply cost + rent share.
 *   rent share = monthly rent / hours worked per month × service hours   (allocateRent)
 * With rent above $0 the service duration is required, since rent is shared by time.
 */
export function calculateServiceCost({ items, monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH, durationMinutes = 0 }) {
  const consumables = calculateConsumableCost(items);
  const errors = consumables.ok ? {} : { ...consumables.errors };
  if (monthlyRent > 0 && !(durationMinutes > 0)) errors.durationMinutes = 'Enter the service duration, so rent can be shared by the time the service takes.';
  const rent = allocateRent({ monthlyRent, hoursPerMonth, durationMinutes: errors.durationMinutes ? 0 : durationMinutes });
  if (!rent.ok) Object.assign(errors, rent.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ...consumables, rentShare: rent.rentShare, rentPerHour: rent.rentPerHour, consumableCost: consumables.totalCost,
    trueCost: consumables.totalCost + rent.rentShare };
}
