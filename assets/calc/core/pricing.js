// Service pricing and "what is your time worth". Pure functions; rates are fractions (0.03 = 3%).
import { allocateOverhead, allocateRent, DEFAULT_HOURS_PER_MONTH } from './overhead.js';
import { workingHours } from './capacity.js';
import { guard } from './validation.js';

const ok = (x) => ({ ok: true, ...x });
const fail = (errors) => ({ ok: false, errors });

// The recommended range runs from the recommended price (the lowest price that meets every target)
// to 10% above it, which leaves room to round to a menu-friendly number.
export const RANGE_HEADROOM = 0.10;
const CENT = 0.005;
/** The lowest profit margin the Service Pricing Calculator accepts, and its default. */
export const MIN_PROFIT_MARGIN = 0.30;
const EPS = 1e-9;

/**
 * Price a service.
 *   time value      = target hourly × service hours × load factor
 *   load factor     = 1 + non-client hours / client hours (each client hour also pays for admin, cleaning, content…)
 *   rent share      = monthly rent / hours worked per month × service hours        (allocateRent)
 *   overhead        = (other monthly fixed + monthly variable expenses) / monthly appointments   (rent is not in here)
 *   break-even      = (product + rent share + overhead) / (1 − processing)           covers costs, pays you $0
 *   recommended P   = (product + rent share + overhead + time value) / (1 − processing − margin)
 * The last line solves P = cost + P × processing + P × margin without a circular fee calculation.
 * The margin is at least MIN_PROFIT_MARGIN (30%) and defaults to it.
 */
export function calculateServicePricing({
  currentPrice = 0, durationMinutes, productCost = 0, targetHourly = 0,
  monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH,
  monthlyFixed = 0, monthlyVariable = 0, monthlyAppointments = 0,
  processingRate = 0, profitMargin = MIN_PROFIT_MARGIN, nonClientHoursPerMonth = 0,
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
    ['profitMargin', profitMargin, (v) => v >= MIN_PROFIT_MARGIN - EPS, 'Enter a profit margin of at least 30%.'],
    ['profitMargin', profitMargin, (v) => v < 1, 'Enter a profit margin below 100%.'],
    ['nonClientHoursPerMonth', nonClientHoursPerMonth, (v) => v >= 0, 'Enter non-client hours of 0 or more.'],
  ]);
  const rent = allocateRent({ monthlyRent, hoursPerMonth, durationMinutes: errors.durationMinutes ? 0 : durationMinutes });
  if (!rent.ok) Object.assign(errors, rent.errors);
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
  const rentShare = rent.rentShare;
  const directCosts = productCost + rentShare + overhead;
  const breakEvenPrice = directCosts / (1 - processingRate);
  const recommendedPrice = (directCosts + timeValue) / (1 - processingRate - profitMargin);

  const at = (price) => {
    const processing = price * processingRate;
    const earnings = price - processing - directCosts; // what is left to pay for your time and profit
    const profit = earnings - timeValue;               // after paying your time at the target rate
    return { price, processing, earnings, profit, margin: price > 0 ? profit / price : 0, effectiveHourly: earnings / (hours * loadFactor) };
  };
  const range = { low: recommendedPrice, high: recommendedPrice * (1 + RANGE_HEADROOM) };
  const current = currentPrice > 0 ? at(currentPrice) : null;
  let status = 'none';
  if (currentPrice > 0) status = currentPrice < range.low - CENT ? 'under' : currentPrice > range.high + CENT ? 'above' : 'within';
  return ok({
    hours, loadFactor, timeValue, overhead, rentShare, rentPerHour: rent.rentPerHour, directCosts, processingAtRecommended: recommendedPrice * processingRate,
    breakEvenPrice, recommendedPrice, range, status,
    recommended: at(recommendedPrice),
    current,
    // the current price keeps less than the 30% minimum profit margin (after costs and paying time at the target rate)
    currentBelowMinimum: current ? current.margin < MIN_PROFIT_MARGIN - EPS : false,
    difference: currentPrice > 0 ? recommendedPrice - currentPrice : 0, // > 0 means underpriced
    // the same gap measured from the price the page shows (rounded up to the dollar), so $117 vs $100 reads as $17, not $16.88
    shownPrice: Math.ceil(recommendedPrice - CENT),
    shownDifference: currentPrice > 0 ? Math.ceil(recommendedPrice - CENT) - currentPrice : 0,
    aboveRangeBy: currentPrice > range.high ? currentPrice - range.high : 0,
  });
}

/**
 * What your time is worth (solo provider or owner). Desired income is what you want to keep after estimated income tax.
 *   pre-tax income   = desired income / (1 − tax rate)
 *   annual expenses  = monthly rent × 12 + other annual business expenses
 *   required revenue = pre-tax income + annual expenses   (expenses are paid before income is taxed)
 */
export function calculateHourlyRate({
  desiredAnnualIncome, workingWeeksPerYear = 48, workingDaysPerWeek = 5, hoursPerDay = 8,
  nonClientHoursPerDay = 0, monthlyRent = 0, annualExpenses = 0, taxRate = 0, exampleServiceMinutes = 120,
}) {
  const errors = guard([
    ['desiredAnnualIncome', desiredAnnualIncome, (v) => v > 0, 'Enter a desired annual income greater than $0.'],
    ...scheduleChecks({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay }),
    ['monthlyRent', monthlyRent, (v) => v >= 0, 'Enter monthly rent of $0 or more.'],
    ['annualExpenses', annualExpenses, (v) => v >= 0, 'Enter other annual business expenses of $0 or more.'],
    ['taxRate', taxRate, (v) => v >= 0 && v < 1, 'Enter an estimated tax rate below 100%.'],
    ['exampleServiceMinutes', exampleServiceMinutes, (v) => v >= 0, 'Enter a service length of 0 minutes or more.'],
  ]);
  if (Object.keys(errors).length) return fail(errors);
  const time = workingHours({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay });
  if (!(time.clientHoursPerDay > 0)) return fail({ nonClientHoursPerDay: 'Non-client hours must be fewer than your working hours per day.' });
  const preTaxIncome = desiredAnnualIncome / (1 - taxRate);
  const estimatedTaxes = preTaxIncome - desiredAnnualIncome;
  const annualRent = monthlyRent * 12;
  const totalExpenses = annualRent + annualExpenses;
  const annualRevenue = preTaxIncome + totalExpenses;
  const perClientHour = annualRevenue / time.annualClientHours;
  return ok({
    ...time, preTaxIncome, estimatedTaxes, annualRevenue, annualRent, otherExpenses: annualExpenses, totalExpenses,
    rentShareOfRevenue: annualRent / annualRevenue,
    rentPerClientHour: annualRent / time.annualClientHours,
    monthlyRevenue: annualRevenue / 12,
    perWorkingHour: annualRevenue / time.annualHours,
    perClientHour,
    exampleServiceMinutes,
    exampleServiceRevenue: perClientHour * (exampleServiceMinutes / 60),
  });
}

function scheduleChecks({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay }) {
  return [
    ['workingWeeksPerYear', workingWeeksPerYear, (v) => v > 0 && v <= 52, 'Enter working weeks per year between 1 and 52.'],
    ['workingDaysPerWeek', workingDaysPerWeek, (v) => v > 0 && v <= 7, 'Enter working days per week between 1 and 7.'],
    ['hoursPerDay', hoursPerDay, (v) => v > 0 && v <= 24, 'Enter hours per day between 1 and 24.'],
    ['nonClientHoursPerDay', nonClientHoursPerDay, (v) => v >= 0, 'Enter non-client hours of 0 or more.'],
  ];
}

export const PAY_TYPES = ['hourly', 'commission', 'mixed'];

/**
 * What an employee needs to earn to take home their goal. No rent or business expenses: the business pays those.
 * Tips count toward the goal and are taxable, so they are taken off the pre-tax goal.
 *   pre-tax income  = desired take-home / (1 − tax rate)
 *   paid hours      = working days × hours per day × working weeks
 *   hourly          : wage            = (pre-tax income − annual tips) / paid hours
 *   commission      : service revenue = (pre-tax income − annual tips) / commission rate
 *   mixed           : base pay = base wage × paid hours;
 *                     service revenue = (pre-tax income − base pay − annual tips) / commission rate
 * When tips (and base pay) already reach the goal, nothing more is needed: goalMet, never a negative wage or revenue.
 */
export function calculateEmployeeEarnings({
  desiredAnnualIncome, payType = 'hourly', monthlyTips = 0, commissionRate = 0, baseHourlyWage = 0, taxRate = 0,
  workingWeeksPerYear = 48, workingDaysPerWeek = 5, hoursPerDay = 8, nonClientHoursPerDay = 0, exampleServiceMinutes = 120,
}) {
  const commission = payType === 'commission' || payType === 'mixed';
  const errors = guard([
    ['desiredAnnualIncome', desiredAnnualIncome, (v) => v > 0, 'Enter a desired annual take-home pay greater than $0.'],
    ...scheduleChecks({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay }),
    ['monthlyTips', monthlyTips, (v) => v >= 0, 'Enter monthly tips of $0 or more.'],
    ['taxRate', taxRate, (v) => v >= 0 && v < 1, 'Enter an estimated tax rate below 100%.'],
    ['exampleServiceMinutes', exampleServiceMinutes, (v) => v >= 0, 'Enter a service length of 0 minutes or more.'],
    ...(commission ? [['commissionRate', commissionRate, (v) => v > 0 && v < 1, 'Enter a commission rate above 0% and below 100%.']] : []),
    ...(payType === 'mixed' ? [['baseHourlyWage', baseHourlyWage, (v) => v >= 0, 'Enter a base hourly wage of $0 or more.']] : []),
  ]);
  if (!PAY_TYPES.includes(payType)) errors.payType = 'Choose how you are paid: hourly, commission, or hourly + commission.';
  if (Object.keys(errors).length) return fail(errors);
  const time = workingHours({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay });
  if (!(time.clientHoursPerDay > 0)) return fail({ nonClientHoursPerDay: 'Non-client hours must be fewer than your working hours per day.' });
  const preTaxIncome = desiredAnnualIncome / (1 - taxRate);
  const estimatedTaxes = preTaxIncome - desiredAnnualIncome;
  const annualTips = monthlyTips * 12;
  const basePay = payType === 'mixed' ? baseHourlyWage * time.annualHours : 0;
  const remaining = Math.max(0, preTaxIncome - basePay - annualTips); // what wages or commission still have to earn
  const goalMet = remaining <= CENT;
  const base = {
    ...time, payType, preTaxIncome, estimatedTaxes, monthlyPreTaxIncome: preTaxIncome / 12, annualTips, monthlyTips,
    paidHours: time.annualHours, basePay, monthlyBasePay: basePay / 12, remaining: goalMet ? 0 : remaining, goalMet,
    surplus: Math.max(0, basePay + annualTips - preTaxIncome),
  };
  if (payType === 'hourly') {
    return ok({ ...base, requiredWage: goalMet ? 0 : remaining / time.annualHours });
  }
  const annualServiceRevenue = goalMet ? 0 : remaining / commissionRate;
  const perClientHour = annualServiceRevenue / time.annualClientHours;
  return ok({
    ...base, commissionRate, annualServiceRevenue, annualCommission: annualServiceRevenue * commissionRate,
    monthlyServiceRevenue: annualServiceRevenue / 12,
    weeklyServiceRevenue: annualServiceRevenue / workingWeeksPerYear,
    perClientHour,
    exampleServiceMinutes, exampleServiceRevenue: perClientHour * (exampleServiceMinutes / 60),
  });
}
