// Break-even point. Pure; rates are fractions.
import { WEEKS_PER_MONTH } from './capacity.js';
import { guard } from './validation.js';

/**
 * net price     = price × (1 − processing)
 * commission    = price × commission rate            (owners: the provider's share of each service, a variable cost)
 * contribution  = net price − commission − variable cost (+ retail revenue after processing and retail product cost)
 * labor (fixed) = your monthly pay (solo) or monthly payroll + your monthly owner pay (owner)
 * fixed costs   = monthly rent + labor (fixed) + other monthly fixed costs
 * appointments  = fixed costs / contribution
 * revenue       = appointments × (service price + retail revenue)
 * A contribution of zero or less means break-even is impossible: each appointment loses money before fixed costs.
 * Solo pay and owner payroll are separate inputs; the calculator passes only the ones for the chosen business type.
 */
export function calculateBreakEven({
  fixedCosts, monthlyRent = 0, servicePrice, variableCost = 0, processingRate = 0,
  retailRevenue = 0, retailCostRate = 0, workingDaysPerWeek = 5,
  monthlyPay = 0, monthlyPayroll = 0, ownerPay = 0, commissionRate = 0,
}) {
  const errors = guard([
    ['fixedCosts', fixedCosts, (v) => v >= 0, 'Enter other monthly fixed costs of $0 or more.'],
    ['monthlyRent', monthlyRent, (v) => v >= 0, 'Enter monthly rent of $0 or more.'],
    ['servicePrice', servicePrice, (v) => v > 0, 'Enter an average service price greater than $0.'],
    ['variableCost', variableCost, (v) => v >= 0, 'Enter a variable cost of $0 or more.'],
    ['processingRate', processingRate, (v) => v >= 0 && v < 1, 'Enter a payment processing rate below 100%.'],
    ['retailRevenue', retailRevenue, (v) => v >= 0, 'Enter retail revenue of $0 or more.'],
    ['retailCostRate', retailCostRate, (v) => v >= 0 && v < 1, 'Enter a retail product cost below 100%.'],
    ['workingDaysPerWeek', workingDaysPerWeek, (v) => v > 0 && v <= 7, 'Enter working days per week between 1 and 7.'],
    ['monthlyPay', monthlyPay, (v) => v >= 0, 'Enter your monthly pay of $0 or more.'],
    ['monthlyPayroll', monthlyPayroll, (v) => v >= 0, 'Enter monthly payroll of $0 or more.'],
    ['ownerPay', ownerPay, (v) => v >= 0, 'Enter your monthly owner pay of $0 or more.'],
    ['commissionRate', commissionRate, (v) => v >= 0 && v < 1, 'Enter a commission below 100%.'],
  ]);
  if (Object.keys(errors).length) return { ok: false, errors };
  const laborFixed = monthlyPay + monthlyPayroll + ownerPay;
  const totalFixed = monthlyRent + laborFixed + fixedCosts;
  const netPrice = servicePrice * (1 - processingRate);
  const commission = servicePrice * commissionRate;
  const retailContribution = retailRevenue * (1 - processingRate) - retailRevenue * retailCostRate;
  const contribution = netPrice - commission - variableCost + retailContribution;
  const ticket = servicePrice + retailRevenue;
  const base = { ok: true, netPrice, commission, contribution, ticket, fixedCosts: totalFixed, rent: monthlyRent, laborFixed, otherFixedCosts: fixedCosts, contributionMargin: contribution / ticket };
  if (contribution <= 0.000001) return { ...base, possible: false, reason: contribution < -0.000001 ? 'negative' : 'zero' };
  const appointments = totalFixed / contribution;
  const weeklyAppointments = appointments / WEEKS_PER_MONTH;
  return {
    ...base, possible: true, appointments,
    appointmentsWhole: Math.max(0, Math.ceil(appointments - 1e-9)),
    revenue: appointments * ticket,
    weeklyAppointments, dailyAppointments: weeklyAppointments / workingDaysPerWeek,
  };
}

/**
 * Two straight lines for the break-even picture: revenue (n × ticket) and total cost
 * (fixed + n × cost per appointment). They cross at the break-even point.
 */
export function breakEvenChart(result) {
  if (!result?.ok || !result.possible) return null;
  const max = Math.max(10, Math.ceil(result.appointments * 2));
  const costPerAppt = result.ticket - result.contribution;
  return {
    maxAppointments: max,
    maxValue: Math.max(max * result.ticket, result.fixedCosts + max * costPerAppt),
    revenue: [[0, 0], [max, max * result.ticket]],
    cost: [[0, result.fixedCosts], [max, result.fixedCosts + max * costPerAppt]],
    point: [result.appointments, result.revenue],
  };
}
