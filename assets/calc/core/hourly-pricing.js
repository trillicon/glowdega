// Hourly service pricing: long services billed by the hour (color, specialty nail designs, services over 4 hours).
// Pure; rates are fractions (0.03 = 3%).
import { guard } from './validation.js';
import { allocateRent, DEFAULT_HOURS_PER_MONTH } from './overhead.js';
import { MIN_PROFIT_MARGIN, marginTone } from './pricing.js';

/** Time is billed in half-hour steps, always rounded up. */
export const BILLING_STEP_MINUTES = 30;
const EPS = 1e-9;
const CENT = 0.005;
const MAX_MINUTES = 1440;

/** Billed minutes: the longer of the service and the minimum booking, rounded up to the next billing step. */
export function billedMinutes(serviceMinutes, minimumMinutes = 0, step = BILLING_STEP_MINUTES) {
  const longest = Math.max(serviceMinutes, minimumMinutes);
  return Math.ceil(longest / step - EPS) * step;
}

/**
 * Price a long service by the hour.
 *   service hours   S = estimated service length ÷ 60
 *   working hours   W = (estimated length + unbillable minutes) ÷ 60     consultation, setup and cleanup are worked time
 *   labor           = hourly pay (solo) or provider wage (owner) × W, + commission × price (owners)
 *   rent            = monthly rent ÷ hours worked per month × W          (allocateRent)
 *   product         = fixed product per appointment + product per hour × S
 *   costs C         = labor time + rent + product + supplies + other overhead
 *   price needed    = C ÷ (1 − processing − commission − margin)          card fees and commission are shares of the price
 *   hourly rate     = price needed ÷ S, rounded up to the whole dollar    the rate you quote
 *   billed hours    = max(S, minimum booking), rounded up in half-hour steps
 *   price           = hourly rate × billed hours;   deposit = price × deposit %
 *   profit          = price − C − price × (processing + commission);    margin = profit ÷ price
 * The unbillable time is paid for by the rate: it is in W (labor and rent) but never billed. Because the quoted rate
 * is rounded up and billed hours are never below S, the margin at the price is never below the chosen margin (≥ 30%).
 */
export function calculateHourlyServicePricing({
  estimatedMinutes, laborHourly = 0, commissionRate = 0, monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH,
  overhead = 0, productFixed = 0, productPerHour = 0, supplyCost = 0, processingRate = 0, profitMargin = MIN_PROFIT_MARGIN,
  unbillableMinutes = 0, minimumMinutes = 0, depositRate = 0,
}) {
  const errors = guard([
    ['estimatedMinutes', estimatedMinutes, (v) => v > 0 && v <= MAX_MINUTES, 'Enter an estimated service length between 1 and 1,440 minutes.'],
    ['laborHourly', laborHourly, (v) => v >= 0, 'Enter an hourly pay or wage of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission below 100%.'],
    ['overhead', overhead, (v) => v >= 0, 'Enter other overhead of $0 or more.'],
    ['productFixed', productFixed, (v) => v >= 0, 'Enter a fixed product cost of $0 or more.'],
    ['productPerHour', productPerHour, (v) => v >= 0, 'Enter a product cost per hour of $0 or more.'],
    ['supplyCost', supplyCost, (v) => v >= 0, 'Enter a supply cost of $0 or more.'],
    ['processingRate', processingRate, (v) => v >= 0 && v < 1, 'Enter a payment processing rate below 100%.'],
    ['profitMargin', profitMargin, (v) => v >= MIN_PROFIT_MARGIN - EPS, 'Enter a profit margin of at least 30%.'],
    ['profitMargin', profitMargin, (v) => v < 1, 'Enter a profit margin below 100%.'],
    ['unbillableMinutes', unbillableMinutes, (v) => v >= 0 && v <= MAX_MINUTES, 'Enter unbillable time between 0 and 1,440 minutes.'],
    ['minimumMinutes', minimumMinutes, (v) => v >= 0 && v <= MAX_MINUTES, 'Enter a minimum booking between 0 and 1,440 minutes.'],
    ['depositRate', depositRate, (v) => v >= 0 && v < 1, 'Enter a deposit below 100%.'],
  ]);
  const workedMinutes = (errors.estimatedMinutes ? 0 : estimatedMinutes) + (errors.unbillableMinutes ? 0 : unbillableMinutes);
  const rent = allocateRent({ monthlyRent, hoursPerMonth, durationMinutes: workedMinutes });
  if (!rent.ok) Object.assign(errors, rent.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  if (processingRate + commissionRate + profitMargin >= 1 - EPS) {
    if (!(commissionRate > 0)) return { ok: false, errors: { profitMargin: 'Payment processing and profit margin together must be below 100% of the price.' } };
    const message = 'Payment processing, commission and profit margin together must be below 100% of the price.';
    return { ok: false, errors: { commissionRate: message, profitMargin: message } };
  }
  const serviceHours = estimatedMinutes / 60;
  const workedHours = workedMinutes / 60;
  const laborTime = laborHourly * workedHours;
  const rentShare = rent.rentShare;
  const productHourly = productPerHour * serviceHours;
  const product = productFixed + productHourly;
  const costs = laborTime + rentShare + product + supplyCost + overhead;
  const priceNeeded = costs / (1 - processingRate - commissionRate - profitMargin);
  const exactRate = priceNeeded / serviceHours;
  const hourlyRate = Math.ceil(exactRate - CENT);
  const billed = billedMinutes(estimatedMinutes, minimumMinutes);
  const billedHours = billed / 60;
  const price = hourlyRate * billedHours;
  const processing = price * processingRate;
  const commission = price * commissionRate;
  const totalCost = costs + processing + commission;
  const profit = price - totalCost;
  const margin = price > 0 ? profit / price : 0;
  return {
    ok: true, estimatedMinutes, serviceHours, unbillableMinutes, workedMinutes, workedHours, minimumMinutes,
    billedMinutes: billed, billedHours, extraBilledMinutes: billed - estimatedMinutes, minimumApplies: minimumMinutes > estimatedMinutes,
    laborHourly, laborTime, commissionRate, commission, labor: laborTime + commission,
    rentPerHour: rent.rentPerHour, rentShare, productFixed, productPerHour, productHourly, product, supplyCost, overhead,
    processingRate, processing, costs, totalCost, priceNeeded, exactRate, hourlyRate, price, profitMargin,
    profit, margin, tone: marginTone(margin),
    depositRate, deposit: price * depositRate, balance: price * (1 - depositRate),
    // what each hour actually worked (billed or not) costs before card fees and commission
    costPerWorkedHour: costs / workedHours,
  };
}
