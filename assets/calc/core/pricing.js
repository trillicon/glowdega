// Service pricing and "what is your time worth". Pure functions; rates are fractions (0.03 = 3%).
import { allocateOverhead } from './overhead.js';
import { workingHours } from './capacity.js';
import { guard } from './validation.js';

const ok = (x) => ({ ok: true, ...x });
const fail = (errors) => ({ ok: false, errors });

// The recommended range runs from the recommended price (the lowest price that meets every target)
// to 10% above it, which leaves room to round to a menu-friendly number.
export const RANGE_HEADROOM = 0.10;
const CENT = 0.005;

/**
 * Price a service.
 *   time value      = target hourly × service hours × load factor
 *   load factor     = 1 + non-client hours / client hours (each client hour also pays for admin, cleaning, content…)
 *   overhead        = (monthly fixed + monthly variable expenses) / monthly appointments
 *   break-even      = (product + overhead) / (1 − processing)                      covers costs, pays you $0
 *   recommended P   = (product + overhead + time value) / (1 − processing − margin)
 * The last line solves P = cost + P × processing + P × margin without a circular fee calculation.
 */
export function calculateServicePricing({
  currentPrice = 0, durationMinutes, productCost = 0, targetHourly = 0,
  monthlyFixed = 0, monthlyVariable = 0, monthlyAppointments = 0,
  processingRate = 0, profitMargin = 0, nonClientHoursPerMonth = 0,
}) {
  const errors = guard([
    ['durationMinutes', durationMinutes, (v) => v > 0, 'Enter a service duration greater than 0 minutes.'],
    ['currentPrice', currentPrice, (v) => v >= 0, 'Enter a current price of $0 or more.'],
    ['productCost', productCost, (v) => v >= 0, 'Enter a product/supply cost of $0 or more.'],
    ['targetHourly', targetHourly, (v) => v >= 0, 'Enter target hourly earnings of $0 or more.'],
    ['monthlyFixed', monthlyFixed, (v) => v >= 0, 'Enter monthly fixed expenses of $0 or more.'],
    ['monthlyVariable', monthlyVariable, (v) => v >= 0, 'Enter monthly variable expenses of $0 or more.'],
    ['monthlyAppointments', monthlyAppointments, (v) => v >= 0, 'Enter monthly appointments of 0 or more.'],
    ['processingRate', processingRate, (v) => v >= 0 && v < 1, 'Enter a payment processing rate below 100%.'],
    ['profitMargin', profitMargin, (v) => v >= 0 && v < 1, 'Enter a profit margin below 100%.'],
    ['nonClientHoursPerMonth', nonClientHoursPerMonth, (v) => v >= 0, 'Enter non-client hours of 0 or more.'],
  ]);
  if (Object.keys(errors).length) return fail(errors);
  if (processingRate + profitMargin >= 1) {
    return fail({ profitMargin: 'Payment processing and profit margin together must be below 100% of the price.' });
  }
  const overhead = allocateOverhead(monthlyFixed + monthlyVariable, monthlyAppointments);
  if (overhead === null || (nonClientHoursPerMonth > 0 && !(monthlyAppointments > 0))) {
    return fail({ monthlyAppointments: 'Enter how many appointments you book a month, so monthly expenses and non-client hours can be shared across them.' });
  }
  const hours = durationMinutes / 60;
  const loadFactor = monthlyAppointments > 0 ? 1 + nonClientHoursPerMonth / (monthlyAppointments * hours) : 1;
  const timeValue = targetHourly * hours * loadFactor;
  const directCosts = productCost + overhead;
  const breakEvenPrice = directCosts / (1 - processingRate);
  const recommendedPrice = (directCosts + timeValue) / (1 - processingRate - profitMargin);

  const at = (price) => {
    const processing = price * processingRate;
    const earnings = price - processing - directCosts; // what is left to pay for your time and profit
    const profit = earnings - timeValue;               // after paying your time at the target rate
    return { price, processing, earnings, profit, margin: price > 0 ? profit / price : 0, effectiveHourly: earnings / (hours * loadFactor) };
  };
  const range = { low: recommendedPrice, high: recommendedPrice * (1 + RANGE_HEADROOM) };
  let status = 'none';
  if (currentPrice > 0) status = currentPrice < range.low - CENT ? 'under' : currentPrice > range.high + CENT ? 'above' : 'within';
  return ok({
    hours, loadFactor, timeValue, overhead, processingAtRecommended: recommendedPrice * processingRate,
    breakEvenPrice, recommendedPrice, range, status,
    recommended: at(recommendedPrice),
    current: currentPrice > 0 ? at(currentPrice) : null,
    difference: currentPrice > 0 ? recommendedPrice - currentPrice : 0, // > 0 means underpriced
    // the same gap measured from the price the page shows (rounded up to the dollar), so $117 vs $100 reads as $17, not $16.88
    shownPrice: Math.ceil(recommendedPrice - CENT),
    shownDifference: currentPrice > 0 ? Math.ceil(recommendedPrice - CENT) - currentPrice : 0,
    aboveRangeBy: currentPrice > range.high ? currentPrice - range.high : 0,
  });
}

/**
 * What your time is worth. Desired income is what you want to keep after estimated income tax.
 *   pre-tax income   = desired income / (1 − tax rate)
 *   required revenue = pre-tax income + annual business expenses   (expenses are paid before income is taxed)
 */
export function calculateHourlyRate({
  desiredAnnualIncome, workingWeeksPerYear = 48, workingDaysPerWeek = 5, hoursPerDay = 8,
  nonClientHoursPerDay = 0, annualExpenses = 0, taxRate = 0, exampleServiceMinutes = 120,
}) {
  const errors = guard([
    ['desiredAnnualIncome', desiredAnnualIncome, (v) => v > 0, 'Enter a desired annual income greater than $0.'],
    ['workingWeeksPerYear', workingWeeksPerYear, (v) => v > 0 && v <= 52, 'Enter working weeks per year between 1 and 52.'],
    ['workingDaysPerWeek', workingDaysPerWeek, (v) => v > 0 && v <= 7, 'Enter working days per week between 1 and 7.'],
    ['hoursPerDay', hoursPerDay, (v) => v > 0 && v <= 24, 'Enter hours per day between 1 and 24.'],
    ['nonClientHoursPerDay', nonClientHoursPerDay, (v) => v >= 0, 'Enter non-client hours of 0 or more.'],
    ['annualExpenses', annualExpenses, (v) => v >= 0, 'Enter annual business expenses of $0 or more.'],
    ['taxRate', taxRate, (v) => v >= 0 && v < 1, 'Enter an estimated tax rate below 100%.'],
    ['exampleServiceMinutes', exampleServiceMinutes, (v) => v >= 0, 'Enter a service length of 0 minutes or more.'],
  ]);
  if (Object.keys(errors).length) return fail(errors);
  const time = workingHours({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay });
  if (!(time.clientHoursPerDay > 0)) return fail({ nonClientHoursPerDay: 'Non-client hours must be fewer than your working hours per day.' });
  const preTaxIncome = desiredAnnualIncome / (1 - taxRate);
  const estimatedTaxes = preTaxIncome - desiredAnnualIncome;
  const annualRevenue = preTaxIncome + annualExpenses;
  const perClientHour = annualRevenue / time.annualClientHours;
  return ok({
    ...time, preTaxIncome, estimatedTaxes, annualRevenue,
    monthlyRevenue: annualRevenue / 12,
    perWorkingHour: annualRevenue / time.annualHours,
    perClientHour,
    exampleServiceMinutes,
    exampleServiceRevenue: perClientHour * (exampleServiceMinutes / 60),
  });
}
