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
 * True cost of one service = product cost + supply cost + rent share + labor.
 *   rent share = monthly rent / hours worked per month × service hours   (allocateRent)
 *   labor      solo : your monthly pay / hours worked per month × service hours
 *              owner: provider's hourly wage × service hours + service price × commission
 * Commission is a share of the price, so it is only counted when a price is entered (commissionNeedsPrice otherwise).
 * With rent or time-based labor above $0 the service duration is required, since both are shared by time.
 */
export function calculateServiceCost({ items, monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH, durationMinutes = 0,
  monthlyPay = 0, providerWage = 0, commissionRate = 0, price = 0 }) {
  const consumables = calculateConsumableCost(items);
  const errors = consumables.ok ? {} : { ...consumables.errors };
  Object.assign(errors, guard([
    ['monthlyPay', monthlyPay, (v) => v >= 0, 'Enter your monthly pay of $0 or more.'],
    ['providerWage', providerWage, (v) => v >= 0, 'Enter an hourly wage of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission below 100%.'],
    ['price', price, (v) => v >= 0, 'Enter a service price of $0 or more.'],
  ]));
  const timed = monthlyRent > 0 || monthlyPay > 0 || providerWage > 0;
  if (timed && !(durationMinutes > 0)) errors.durationMinutes = 'Enter the service duration, so rent and labor can be shared by the time the service takes.';
  const rent = allocateRent({ monthlyRent, hoursPerMonth, durationMinutes: errors.durationMinutes ? 0 : durationMinutes });
  if (!rent.ok) Object.assign(errors, rent.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  const hours = durationMinutes / 60;
  const payPerHour = monthlyPay / hoursPerMonth;
  const laborPerHour = payPerHour + providerWage;
  const laborTime = laborPerHour * hours;
  const commission = price * commissionRate;
  const labor = laborTime + commission;
  return { ...consumables, rentShare: rent.rentShare, rentPerHour: rent.rentPerHour, consumableCost: consumables.totalCost,
    payPerHour, laborPerHour, laborTime, commission, labor, commissionNeedsPrice: commissionRate > 0 && !(price > 0),
    trueCost: consumables.totalCost + rent.rentShare + labor };
}

const EPS = 1e-9;

/**
 * The cost parts of one appointment of a priced service, split by how they behave when the price changes:
 *   fixed per service = product/supply cost + other overhead + rent share + hourly labor × service hours
 *   price rate        = commission + card processing   (shares of whatever price is charged)
 *   cost at price P   = fixed per service + P × price rate
 *   profit at price P = P × (1 − price rate) − fixed per service        (profitAt)
 * Labor: solo = your pay per hour; owner = the provider's hourly wage (+ commission as a share of the price).
 * Used by the price-increase and discount calculators, so a price change moves commission and card fees with it.
 */
export function serviceCostParts({ durationMinutes, productCost = 0, overhead = 0, monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH,
  laborHourly = 0, commissionRate = 0, processingRate = 0 }) {
  const errors = guard([
    ['durationMinutes', durationMinutes, (v) => v > 0, 'Enter a service duration greater than 0 minutes.'],
    ['productCost', productCost, (v) => v >= 0, 'Enter a product/supply cost of $0 or more.'],
    ['overhead', overhead, (v) => v >= 0, 'Enter other overhead of $0 or more.'],
    ['laborHourly', laborHourly, (v) => v >= 0, 'Enter an hourly pay or wage of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission below 100%.'],
    ['processingRate', processingRate, (v) => v >= 0 && v < 1, 'Enter a payment processing rate below 100%.'],
  ]);
  const rent = allocateRent({ monthlyRent, hoursPerMonth, durationMinutes: errors.durationMinutes ? 0 : durationMinutes });
  if (!rent.ok) Object.assign(errors, rent.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  if (commissionRate + processingRate >= 1 - EPS) {
    const message = 'Commission and payment processing together must be below 100% of the price.';
    return { ok: false, errors: { commissionRate: message, processingRate: message } };
  }
  const hours = durationMinutes / 60;
  const laborTime = laborHourly * hours;
  return { ok: true, hours, rentShare: rent.rentShare, rentPerHour: rent.rentPerHour, laborHourly, laborTime, productCost, overhead,
    fixedPerService: productCost + overhead + rent.rentShare + laborTime, commissionRate, processingRate, priceRate: commissionRate + processingRate };
}

/** One appointment at a given price, from serviceCostParts(): commission and card fees follow the price. */
export function profitAt(parts, price) {
  const commission = price * parts.commissionRate;
  const processing = price * parts.processingRate;
  const totalCost = parts.fixedPerService + commission + processing;
  const profit = price - totalCost;
  return { price, commission, processing, labor: parts.laborTime + commission, totalCost, profit, margin: price > 0 ? profit / price : 0 };
}
