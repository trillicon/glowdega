// Service pricing and "what is your time worth". Pure functions; rates are fractions (0.03 = 3%).
import { allocateOverhead, allocateRent, DEFAULT_HOURS_PER_MONTH } from './overhead.js';
import { workingHours } from './capacity.js';
import { guard } from './validation.js';
import { serviceCostParts, profitAt } from './costs.js';

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
 *   commission      = price × commission rate        (owners who pay the provider a share of each service)
 *   labor           = time value + commission
 *   break-even      = (product + rent share + overhead) / (1 − processing)           covers costs, pays labor $0
 *   recommended P   = (product + rent share + overhead + time value) / (1 − processing − commission − margin)
 * The last line solves P = cost + P × (processing + commission + margin) without a circular fee calculation, so
 * processing + commission + margin must stay below 100% of the price.
 * targetHourly is the hourly labor rate: a solo provider's own pay per hour, or the wage an owner pays the provider.
 * A solo provider's labor is only this hourly pay; there is no separate monthly pay here, so it is never counted twice.
 * The margin is at least MIN_PROFIT_MARGIN (30%) and defaults to it.
 */
export function calculateServicePricing({
  currentPrice = 0, durationMinutes, productCost = 0, targetHourly = 0,
  monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH,
  monthlyFixed = 0, monthlyVariable = 0, monthlyAppointments = 0,
  processingRate = 0, profitMargin = MIN_PROFIT_MARGIN, nonClientHoursPerMonth = 0, commissionRate = 0,
}) {
  const errors = guard([
    ['durationMinutes', durationMinutes, (v) => v > 0, 'Enter a service duration greater than 0 minutes.'],
    ['currentPrice', currentPrice, (v) => v >= 0, 'Enter a current price of $0 or more.'],
    ['productCost', productCost, (v) => v >= 0, 'Enter a product/supply cost of $0 or more.'],
    ['targetHourly', targetHourly, (v) => v >= 0, 'Enter an hourly pay or wage of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission below 100%.'],
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
  if (processingRate + commissionRate + profitMargin >= 1 - EPS) {
    if (!(commissionRate > 0)) return fail({ profitMargin: 'Payment processing and profit margin together must be below 100% of the price.' });
    const message = 'Payment processing, commission and profit margin together must be below 100% of the price.';
    return fail({ commissionRate: message, profitMargin: message });
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
  // break-even = every cost including labor is paid and profit is exactly $0
  const breakEvenPrice = (directCosts + timeValue) / (1 - processingRate - commissionRate);
  const recommendedPrice = (directCosts + timeValue) / (1 - processingRate - commissionRate - profitMargin);

  const at = (price) => {
    const processing = price * processingRate;
    const commission = price * commissionRate;
    const earnings = price - processing - directCosts; // what is left to pay for labor (time + commission) and profit
    const labor = timeValue + commission;
    const profit = earnings - labor;                   // after paying labor at the hourly rate and commission
    return { price, processing, commission, labor, earnings, profit, margin: price > 0 ? profit / price : 0, effectiveHourly: earnings / (hours * loadFactor) };
  };
  const range = { low: recommendedPrice, high: recommendedPrice * (1 + RANGE_HEADROOM) };
  const current = currentPrice > 0 ? at(currentPrice) : null;
  let status = 'none';
  if (currentPrice > 0) status = currentPrice < range.low - CENT ? 'under' : currentPrice > range.high + CENT ? 'above' : 'within';
  return ok({
    hours, loadFactor, timeValue, overhead, rentShare, rentPerHour: rent.rentPerHour, directCosts, processingAtRecommended: recommendedPrice * processingRate,
    commissionRate, commissionAtRecommended: recommendedPrice * commissionRate, laborAtRecommended: timeValue + recommendedPrice * commissionRate,
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

/** The example service length used when nobody says otherwise: a 90-minute service. */
export const EXAMPLE_SERVICE_MINUTES = 90;

/**
 * What your time is worth (solo provider or owner). Desired income is what you want to keep after estimated income tax.
 *   pre-tax income   = desired income / (1 − tax rate)
 *   annual payroll   = monthly payroll × 12              (owners: wages + payroll taxes for staff)
 *   annual expenses  = monthly rent × 12 + annual payroll + other annual business expenses
 *   required revenue = pre-tax income + annual expenses   (expenses are paid before income is taxed)
 * The desired income IS the solo provider's (or owner's) own pay, so no separate pay is added: never counted twice.
 */
export function calculateHourlyRate({
  desiredAnnualIncome, workingWeeksPerYear = 48, workingDaysPerWeek = 5, hoursPerDay = 8,
  nonClientHoursPerDay = 0, monthlyRent = 0, monthlyPayroll = 0, annualExpenses = 0, taxRate = 0, exampleServiceMinutes = EXAMPLE_SERVICE_MINUTES,
}) {
  const errors = guard([
    ['desiredAnnualIncome', desiredAnnualIncome, (v) => v > 0, 'Enter a desired annual income greater than $0.'],
    ...scheduleChecks({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay }),
    ['monthlyRent', monthlyRent, (v) => v >= 0, 'Enter monthly rent of $0 or more.'],
    ['monthlyPayroll', monthlyPayroll, (v) => v >= 0, 'Enter monthly payroll of $0 or more.'],
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
  const annualPayroll = monthlyPayroll * 12;
  const totalExpenses = annualRent + annualPayroll + annualExpenses;
  const annualRevenue = preTaxIncome + totalExpenses;
  const perClientHour = annualRevenue / time.annualClientHours;
  return ok({
    ...time, preTaxIncome, estimatedTaxes, annualRevenue, annualRent, annualPayroll, otherExpenses: annualExpenses, totalExpenses,
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
 * Hourly, with a current wage entered (0 = not entered, only the required wage is shown):
 *   current take-home = (current wage × paid hours + annual tips) × (1 − tax rate)
 *   raise needed      = required wage − current wage          (only when short; never negative)
 *   take-home short   = desired take-home − current take-home  (only when short)
 *   surplus           = current wage − required wage, and current take-home − desired (only when met)
 */
export function calculateEmployeeEarnings({
  desiredAnnualIncome, payType = 'hourly', monthlyTips = 0, commissionRate = 0, baseHourlyWage = 0, currentHourlyWage = 0, taxRate = 0,
  workingWeeksPerYear = 48, workingDaysPerWeek = 5, hoursPerDay = 8, nonClientHoursPerDay = 0, exampleServiceMinutes = EXAMPLE_SERVICE_MINUTES,
}) {
  const commission = payType === 'commission' || payType === 'mixed';
  const errors = guard([
    ['desiredAnnualIncome', desiredAnnualIncome, (v) => v > 0, 'Enter a desired annual take-home pay greater than $0.'],
    ...scheduleChecks({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay }),
    ['monthlyTips', monthlyTips, (v) => v >= 0, 'Enter monthly tips of $0 or more.'],
    ['taxRate', taxRate, (v) => v >= 0 && v < 1, 'Enter an estimated tax rate below 100%.'],
    ['exampleServiceMinutes', exampleServiceMinutes, (v) => v >= 0, 'Enter a service length of 0 minutes or more.'],
    ...(commission ? [['commissionRate', commissionRate, (v) => v > 0 && v < 1, 'Enter a commission rate above 0% and below 100%.']] : []),
    ...(payType === 'hourly' ? [['currentHourlyWage', currentHourlyWage, (v) => v >= 0, 'Enter your current hourly wage of $0 or more, or leave it blank.']] : []),
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
    const requiredWage = goalMet ? 0 : remaining / time.annualHours;
    let current = null;
    if (currentHourlyWage > 0) {
      const annualPay = currentHourlyWage * time.annualHours;
      const takeHome = (annualPay + annualTips) * (1 - taxRate);
      const meetsGoal = currentHourlyWage + CENT >= requiredWage;
      current = {
        wage: currentHourlyWage, annualPay, takeHome, meetsGoal,
        raisePerHour: meetsGoal ? 0 : requiredWage - currentHourlyWage,
        takeHomeShort: meetsGoal ? 0 : Math.max(0, desiredAnnualIncome - takeHome),
        surplusPerHour: meetsGoal ? Math.max(0, currentHourlyWage - requiredWage) : 0,
        takeHomeSurplus: meetsGoal ? Math.max(0, takeHome - desiredAnnualIncome) : 0,
      };
    }
    return ok({ ...base, requiredWage, current });
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

// ---------- Price Increase ----------
/**
 * What a price change does to one service's month. Costs come from serviceCostParts (products, rent share, labor;
 * commission and card fees follow the price), so a higher price also pays a little more commission and processing.
 *   current revenue     = current price × monthly appointments
 *   new appointments    = monthly appointments × (1 − expected client loss)
 *   new revenue         = new price × new appointments
 *   monthly profit      = appointments × (price − cost per appointment at that price)
 *   break-even clients  = current revenue ÷ new price                 (spec: clients that keep revenue where it is)
 *   clients you can lose = monthly appointments − break-even clients (whole clients rounded down, so revenue never drops)
 * A price cut makes this negative: the clients you would need to gain instead.
 */
export function calculatePriceIncrease({ currentPrice, newPrice, monthlyAppointments, expectedLossRate = 0, ...cost }) {
  const errors = guard([
    ['currentPrice', currentPrice, (v) => v > 0, 'Enter a current service price greater than $0.'],
    ['newPrice', newPrice, (v) => v > 0, 'Enter a new service price greater than $0.'],
    ['monthlyAppointments', monthlyAppointments, (v) => v > 0, 'Enter monthly appointments greater than 0.'],
    ['expectedLossRate', expectedLossRate, (v) => v >= 0 && v < 1, 'Enter an expected client loss below 100%.'],
  ]);
  const parts = serviceCostParts(cost);
  if (!parts.ok) Object.assign(errors, parts.errors);
  if (Object.keys(errors).length) return fail(errors);
  const month = (price, appointments) => {
    const one = profitAt(parts, price);
    return { ...one, appointments, revenue: price * appointments, monthlyCost: one.totalCost * appointments, monthlyProfit: one.profit * appointments };
  };
  const current = month(currentPrice, monthlyAppointments);
  const newAppointments = monthlyAppointments * (1 - expectedLossRate);
  const next = month(newPrice, newAppointments);
  const change = newPrice - currentPrice;
  const status = Math.abs(change) < CENT ? 'none' : change > 0 ? 'increase' : 'decrease';
  const breakEvenClients = current.revenue / newPrice;
  const clientsYouCanLose = monthlyAppointments - breakEvenClients;
  return ok({
    ...parts, status, change, changeRate: change / currentPrice, current, next, newAppointments, expectedLossRate,
    revenueIncrease: next.revenue - current.revenue, annualRevenueIncrease: (next.revenue - current.revenue) * 12,
    profitIncrease: next.monthlyProfit - current.monthlyProfit, annualProfitIncrease: (next.monthlyProfit - current.monthlyProfit) * 12,
    breakEvenClients, clientsYouCanLose,
    clientsYouCanLoseWhole: Math.max(0, Math.floor(clientsYouCanLose + 1e-9)),
    clientsToGainWhole: Math.max(0, Math.ceil(-clientsYouCanLose - 1e-9)),
    lossRateYouCanAbsorb: clientsYouCanLose / monthlyAppointments,
  });
}
