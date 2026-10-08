// Profit of a single service. Pure; rates are fractions.
import { guard } from './validation.js';
import { allocateRent, DEFAULT_HOURS_PER_MONTH } from './overhead.js';

/**
 * revenue     = price
 * rent share  = monthly rent / hours worked per month × service hours   (allocateRent)
 * total cost  = product + supplies + rent share + other overhead + price × processing + labor + price × commission
 * profit      = revenue − total cost (negative = loss)
 * per hour    = ÷ (duration / 60)
 * Status compares profit per hour with the target hourly rate when one is given.
 */
export function calculateServiceProfitability({
  price, durationMinutes, productCost = 0, supplyCost = 0, overhead = 0,
  monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH,
  processingRate = 0, laborCost = 0, commissionRate = 0, targetHourly = 0,
}) {
  const errors = guard([
    ['price', price, (v) => v > 0, 'Enter a service price greater than $0.'],
    ['durationMinutes', durationMinutes, (v) => v > 0, 'Enter a service duration greater than 0 minutes.'],
    ['productCost', productCost, (v) => v >= 0, 'Enter a product cost of $0 or more.'],
    ['supplyCost', supplyCost, (v) => v >= 0, 'Enter a supply cost of $0 or more.'],
    ['overhead', overhead, (v) => v >= 0, 'Enter other overhead of $0 or more.'],
    ['processingRate', processingRate, (v) => v >= 0 && v < 1, 'Enter a payment processing rate below 100%.'],
    ['laborCost', laborCost, (v) => v >= 0, 'Enter a labor cost of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission rate below 100%.'],
    ['targetHourly', targetHourly, (v) => v >= 0, 'Enter a target hourly rate of $0 or more.'],
  ]);
  const rent = allocateRent({ monthlyRent, hoursPerMonth, durationMinutes: errors.durationMinutes ? 0 : durationMinutes });
  if (!rent.ok) Object.assign(errors, rent.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  const rentShare = rent.rentShare;
  const hours = durationMinutes / 60;
  const processing = price * processingRate;
  const commission = price * commissionRate;
  const totalCost = productCost + supplyCost + rentShare + overhead + processing + laborCost + commission;
  const profit = price - totalCost;
  const profitPerHour = profit / hours;
  let status;
  if (profit < -0.005) status = 'loss';
  else if (Math.abs(profit) <= 0.005) status = 'even';
  else if (targetHourly > 0) status = profitPerHour + 0.005 >= targetHourly ? 'meets-target' : 'below-target';
  else status = 'profitable';
  return {
    ok: true, revenue: price, hours, rentShare, rentPerHour: rent.rentPerHour, consumables: productCost + supplyCost, processing, commission, totalCost, profit,
    margin: profit / price, profitPerHour, revenuePerHour: price / hours, targetHourly, status,
    hourlyGap: targetHourly > 0 ? targetHourly - profitPerHour : 0,
  };
}
