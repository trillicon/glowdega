// Profit of a single service. Pure; rates are fractions.
import { guard } from './validation.js';
import { allocateRent, DEFAULT_HOURS_PER_MONTH } from './overhead.js';
import { MIN_PROFIT_MARGIN, marginTone } from './pricing.js';

/**
 * revenue     = price
 * rent share  = monthly rent / hours worked per month × service hours   (allocateRent)
 * labor       = hourly labor rate × service hours + price × commission
 *               solo: your pay per hour × hours (no commission);  owner: provider's hourly wage × hours + commission
 * total cost  = product + supplies + rent share + other overhead + price × processing + labor
 * profit      = revenue − total cost (negative = loss)
 * per hour    = ÷ (duration / 60)
 * Status: 'loss', 'even', then 'below-minimum' (a profit, but a margin under the shared 30% minimum: not profitable),
 * then 'meets-target' / 'below-target' against the target profit per hour when one is given, else 'profitable'.
 * tone: 'warn' for a loss, break-even, below the minimum or below target; otherwise marginTone (30–49.99% ok, 50%+ strong).
 */
export function calculateServiceProfitability({
  price, durationMinutes, productCost = 0, supplyCost = 0, overhead = 0,
  monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH,
  processingRate = 0, laborHourly = 0, commissionRate = 0, targetHourly = 0,
}) {
  const errors = guard([
    ['price', price, (v) => v > 0, 'Enter a service price greater than $0.'],
    ['durationMinutes', durationMinutes, (v) => v > 0, 'Enter a service duration greater than 0 minutes.'],
    ['productCost', productCost, (v) => v >= 0, 'Enter a product cost of $0 or more.'],
    ['supplyCost', supplyCost, (v) => v >= 0, 'Enter a supply cost of $0 or more.'],
    ['overhead', overhead, (v) => v >= 0, 'Enter other overhead of $0 or more.'],
    ['processingRate', processingRate, (v) => v >= 0 && v < 1, 'Enter a payment processing rate below 100%.'],
    ['laborHourly', laborHourly, (v) => v >= 0, 'Enter an hourly pay or wage of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission rate below 100%.'],
    ['targetHourly', targetHourly, (v) => v >= 0, 'Enter a target profit per hour of $0 or more.'],
  ]);
  const rent = allocateRent({ monthlyRent, hoursPerMonth, durationMinutes: errors.durationMinutes ? 0 : durationMinutes });
  if (!rent.ok) Object.assign(errors, rent.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  const rentShare = rent.rentShare;
  const hours = durationMinutes / 60;
  const processing = price * processingRate;
  const commission = price * commissionRate;
  const laborTime = laborHourly * hours;
  const labor = laborTime + commission;
  const totalCost = productCost + supplyCost + rentShare + overhead + processing + labor;
  const profit = price - totalCost;
  const profitPerHour = profit / hours;
  let status;
  if (profit < -0.005) status = 'loss';
  else if (Math.abs(profit) <= 0.005) status = 'even';
  else if (profit / price < MIN_PROFIT_MARGIN - 1e-9) status = 'below-minimum';
  else if (targetHourly > 0) status = profitPerHour + 0.005 >= targetHourly ? 'meets-target' : 'below-target';
  else status = 'profitable';
  return {
    ok: true, revenue: price, hours, rentShare, rentPerHour: rent.rentPerHour, consumables: productCost + supplyCost, processing, commission,
    laborHourly, laborTime, labor, totalCost, profit,
    margin: profit / price, profitPerHour, revenuePerHour: price / hours, targetHourly, status,
    tone: ['loss', 'even', 'below-minimum', 'below-target'].includes(status) ? 'warn' : marginTone(profit / price),
    // a solo provider keeps both their pay and the profit: everything left after costs, per hour
    earningsPerHour: (profit + laborTime) / hours,
    hourlyGap: targetHourly > 0 ? targetHourly - profitPerHour : 0,
  };
}

// ---------- Profit & Take-Home ----------
/**
 * A month in the business (solo provider or owner). Accounting model: your own pay is a business expense, like payroll.
 *   total revenue     = service revenue + retail revenue
 *   commission        = service revenue × commission rate                       (owners who pay providers a share)
 *   operating costs   = product/service costs + rent + other fixed + variable + payroll + commission
 *   business expenses = operating costs + your pay (owner compensation)
 *   business profit   = total revenue − business expenses                        (after you are paid)
 *   your earnings     = your pay + business profit = total revenue − operating costs   (each dollar counted once)
 *   estimated taxes   = your earnings × tax rate   (none when the business loses money before your pay)
 *   take-home         = your earnings − estimated taxes
 * Your pay is counted once: it is an expense of the business and part of your earnings, never added on top of profit
 * a second time. Moving money between your pay and the profit changes how they split, not what you take home.
 * The calculator passes monthlyPay for a solo provider and ownerPay (+ payroll, commission) for an owner.
 */
export function calculateBusinessProfit({
  serviceRevenue, retailRevenue = 0, productCosts = 0, monthlyRent = 0, fixedExpenses = 0, variableExpenses = 0,
  monthlyPayroll = 0, commissionRate = 0, monthlyPay = 0, ownerPay = 0, taxRate = 0,
}) {
  const errors = guard([
    ['serviceRevenue', serviceRevenue, (v) => v >= 0, 'Enter monthly service revenue of $0 or more.'],
    ['retailRevenue', retailRevenue, (v) => v >= 0, 'Enter retail revenue of $0 or more.'],
    ['productCosts', productCosts, (v) => v >= 0, 'Enter product/service costs of $0 or more.'],
    ['monthlyRent', monthlyRent, (v) => v >= 0, 'Enter monthly rent of $0 or more.'],
    ['fixedExpenses', fixedExpenses, (v) => v >= 0, 'Enter other fixed expenses of $0 or more.'],
    ['variableExpenses', variableExpenses, (v) => v >= 0, 'Enter variable expenses of $0 or more.'],
    ['monthlyPayroll', monthlyPayroll, (v) => v >= 0, 'Enter monthly payroll of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission below 100%.'],
    ['monthlyPay', monthlyPay, (v) => v >= 0, 'Enter your monthly pay of $0 or more.'],
    ['ownerPay', ownerPay, (v) => v >= 0, 'Enter your monthly owner pay of $0 or more.'],
    ['taxRate', taxRate, (v) => v >= 0 && v < 1, 'Enter an estimated tax rate below 100%.'],
  ]);
  if (!errors.serviceRevenue && !errors.retailRevenue && !(serviceRevenue + retailRevenue > 0)) errors.serviceRevenue = 'Enter your monthly service revenue.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const totalRevenue = serviceRevenue + retailRevenue;
  const commission = serviceRevenue * commissionRate;
  const operatingCosts = productCosts + monthlyRent + fixedExpenses + variableExpenses + monthlyPayroll + commission;
  const ownerComp = monthlyPay + ownerPay;
  const businessExpenses = operatingCosts + ownerComp;
  const businessProfit = totalRevenue - businessExpenses;
  const ownerEarnings = ownerComp + businessProfit;
  const estimatedTaxes = Math.max(0, ownerEarnings) * taxRate;
  const takeHome = ownerEarnings - estimatedTaxes;
  let status;
  if (businessProfit < -0.005) status = 'loss';
  else if (businessProfit <= 0.005) status = 'even';
  else status = 'profit';
  return {
    ok: true, totalRevenue, serviceRevenue, retailRevenue, commission, labor: monthlyPayroll + commission, operatingCosts, ownerComp,
    businessExpenses, businessProfit, profitMargin: businessProfit / totalRevenue, ownerEarnings, estimatedTaxes, takeHome,
    takeHomeAnnual: takeHome * 12, status, earningsShortfall: ownerEarnings < -0.005,
    // the shared 30% rule: a month that makes a profit on a margin under 30% is not counted as profitable
    belowMinimum: status === 'profit' && businessProfit / totalRevenue < MIN_PROFIT_MARGIN - 1e-9,
    tone: status === 'profit' ? marginTone(businessProfit / totalRevenue) : 'warn',
  };
}

const EMPLOYEE_PAY = ['hourly', 'commission', 'mixed'];

/**
 * An employee's month. No rent or business expenses: the business pays those.
 *   commission earnings = service revenue generated × commission rate        (commission, hourly + commission)
 *   hourly earnings     = hourly wage × hours worked                         (hourly, hourly + commission)
 *   gross earnings      = commission + hourly + tips + bonuses
 *   estimated taxes     = gross × tax rate;   take-home = gross − taxes
 *   effective hourly    = gross ÷ hours worked (and take-home ÷ hours), when hours are entered
 */
export function calculateEmployeeTakeHome({
  payType = 'hourly', serviceRevenue = 0, commissionRate = 0, hourlyWage = 0, hoursWorked = 0, tips = 0, bonuses = 0, taxRate = 0,
}) {
  const commissioned = payType === 'commission' || payType === 'mixed';
  const hourly = payType === 'hourly' || payType === 'mixed';
  const errors = guard([
    ['serviceRevenue', serviceRevenue, (v) => v >= 0, 'Enter monthly service revenue of $0 or more.'],
    ['tips', tips, (v) => v >= 0, 'Enter monthly tips of $0 or more.'],
    ['bonuses', bonuses, (v) => v >= 0, 'Enter monthly bonuses of $0 or more.'],
    ['taxRate', taxRate, (v) => v >= 0 && v < 1, 'Enter an estimated tax rate below 100%.'],
    ['hoursWorked', hoursWorked, (v) => v >= 0 && v <= 744, 'Enter hours worked per month between 0 and 744.'],
    ...(commissioned ? [['commissionRate', commissionRate, (v) => v > 0 && v < 1, 'Enter a commission rate above 0% and below 100%.'],
      ['serviceRevenue', serviceRevenue, (v) => v > 0, 'Enter the monthly service revenue you generate.']] : []),
    ...(hourly ? [['hourlyWage', hourlyWage, (v) => v > 0, 'Enter an hourly wage greater than $0.'],
      ['hoursWorked', hoursWorked, (v) => v > 0, 'Enter the hours you work per month.']] : []),
  ]);
  if (!EMPLOYEE_PAY.includes(payType)) errors.payType = 'Choose how you are paid: hourly, commission, or hourly + commission.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const commissionEarnings = commissioned ? serviceRevenue * commissionRate : 0;
  const hourlyEarnings = hourly ? hourlyWage * hoursWorked : 0;
  const gross = commissionEarnings + hourlyEarnings + tips + bonuses;
  const estimatedTaxes = gross * taxRate;
  const takeHome = gross - estimatedTaxes;
  return {
    ok: true, payType, serviceRevenue, commissionEarnings, hourlyEarnings, tips, bonuses, gross, estimatedTaxes, takeHome,
    takeHomeAnnual: takeHome * 12, hoursWorked, hasHours: hoursWorked > 0,
    effectiveHourly: hoursWorked > 0 ? gross / hoursWorked : 0, takeHomePerHour: hoursWorked > 0 ? takeHome / hoursWorked : 0,
  };
}
