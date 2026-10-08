// Employee pay on commission: a flat rate, or tiers by sales or by services a week, plus an optional base hourly wage
// and tips. Tiers are NOT marginal: reaching a tier pays its rate on ALL sales in that period. Pure: no DOM access.
import { guard } from './validation.js';
import { isFiniteNumber } from './money.js';

export const WEEKS_PER_MONTH = 52 / 12;
export const HOURS_PER_WEEK = 24 * 7;
export const MAX_TIERS = 6;
/** Never search past this many clients a week, whatever the hours allow. */
export const MAX_CLIENTS_PER_WEEK = 1000;
export const PAY_MODELS = ['flat', 'sales', 'services'];
const EPS = 1e-6;

/**
 * Check a tier table: 1 to 6 tiers, the first starting at 0, thresholds strictly ascending, rates from 0 to 1.
 * unit 'services' thresholds are whole services a week. Returns { field: message } keyed tierFrom-i / tierRate-i.
 */
export function validateTiers(tiers, unit = 'sales') {
  const errors = {};
  if (!Array.isArray(tiers) || tiers.length === 0) return { tiers: 'Add at least one tier.' };
  if (tiers.length > MAX_TIERS) return { tiers: `Use at most ${MAX_TIERS} tiers.` };
  tiers.forEach((t, i) => {
    const from = t?.from, rate = t?.rate;
    if (!isFiniteNumber(from) || from < 0) errors[`tierFrom-${i}`] = 'Enter where this tier starts, as a number of 0 or more.';
    else if (i === 0 && from !== 0) errors[`tierFrom-${i}`] = 'The first tier starts at 0.';
    else if (unit === 'services' && !Number.isInteger(from)) errors[`tierFrom-${i}`] = 'Enter a whole number of services.';
    else if (i > 0 && isFiniteNumber(tiers[i - 1]?.from) && from <= tiers[i - 1].from) errors[`tierFrom-${i}`] = 'Each tier must start above the one before it.';
    if (!isFiniteNumber(rate) || rate < 0 || rate > 1) errors[`tierRate-${i}`] = 'Enter a rate from 0% to 100%.';
  });
  return errors;
}

/** The tier reached at this amount (sales in the tier period, or services a week): the highest tier whose start it meets. */
export function rateForTier(tiers, amount) {
  let index = 0;
  for (let i = 0; i < tiers.length; i++) if (amount + EPS >= tiers[i].from) index = i;
  return { index, number: index + 1, rate: tiers[index].rate, from: tiers[index].from };
}

/**
 * Weekly pay at a whole number of clients (services) a week. Monthly figures are weekly × 52 ÷ 12.
 *   sales           = clients × average ticket                       (a week; × 4.33 for a month)
 *   commission rate = flat rate, or the tier reached by sales in the tier period / services a week; paid on ALL sales
 *   hours           = clients × service length + non-client hours    (a week)
 *   pay             = sales × rate + base wage × hours + clients × tip per client
 */
export function payAt(setup, clients) {
  const { model = 'flat', flatRate = 0, tiers = [], tierPeriod = 'week', averageTicket, baseWage = 0, tipPerClient = 0,
    serviceMinutes = 60, nonClientHours = 0 } = setup;
  const sales = clients * averageTicket;
  const periodSales = tierPeriod === 'month' ? sales * WEEKS_PER_MONTH : sales;
  const tier = model === 'flat' ? { index: -1, rate: flatRate, from: 0 } : rateForTier(tiers, model === 'services' ? clients : periodSales);
  const clientHours = (clients * serviceMinutes) / 60;
  const hours = clientHours + nonClientHours;
  const commission = sales * tier.rate;
  const wage = baseWage * hours;
  const tips = clients * tipPerClient;
  return { clients, sales, periodSales, tierIndex: tier.index, rate: tier.rate, tierFrom: tier.from, commission, wage, tips,
    clientHours, hours, total: commission + wage + tips };
}

const monthly = (p) => ({ ...p, clients: p.clients * WEEKS_PER_MONTH, sales: p.sales * WEEKS_PER_MONTH, commission: p.commission * WEEKS_PER_MONTH,
  wage: p.wage * WEEKS_PER_MONTH, tips: p.tips * WEEKS_PER_MONTH, total: p.total * WEEKS_PER_MONTH, hours: p.hours * WEEKS_PER_MONTH });

/**
 * Whole clients a week to reach a pre-tax pay goal (a week, or a month ÷ 4.33), found by counting up one client at a
 * time from 0, never by solving with fractions, so a tier's jump is always seen. The search stops at the clients that
 * fit in a 168-hour week (and never past 1,000). Also: the next tier, how many more clients unlock it and what it pays.
 */
export function clientsForGoal({ goal, goalPeriod = 'month', model = 'flat', flatRate = 0, tiers = [], tierPeriod = 'week', averageTicket,
  baseWage = 0, tipPerClient = 0, serviceMinutes = 60, nonClientHours = 0, hoursPerDay = 8 }) {
  const errors = guard([
    ['incomeGoal', goal, (v) => v > 0, 'Enter a pay goal greater than $0.'],
    ['averageTicket', averageTicket, (v) => v > 0, 'Enter an average service price greater than $0.'],
    ['baseWage', baseWage, (v) => v >= 0, 'Enter a base hourly wage of $0 or more.'],
    ['tipPerClient', tipPerClient, (v) => v >= 0, 'Enter an average tip of $0 or more.'],
    ['serviceMinutes', serviceMinutes, (v) => v > 0 && v <= 1440, 'Choose an average service length.'],
    ['nonClientHours', nonClientHours, (v) => v >= 0 && v < HOURS_PER_WEEK, 'Enter non-client hours a week from 0 to 167.'],
    ['hoursPerDay', hoursPerDay, (v) => v > 0 && v <= 24, 'Enter hours a day between 1 and 24.'],
  ]);
  if (!['week', 'month'].includes(goalPeriod)) errors.goalPeriod = 'Choose a week or a month.';
  if (!PAY_MODELS.includes(model)) errors.payModel = 'Choose how your commission is paid.';
  if (model === 'flat' && !(isFiniteNumber(flatRate) && flatRate >= 0 && flatRate <= 1)) errors.flatRate = 'Enter a commission rate from 0% to 100%.';
  if (model === 'sales' && !['week', 'month'].includes(tierPeriod)) errors.tierPeriod = 'Choose whether tiers count sales a week or a month.';
  if (model !== 'flat') Object.assign(errors, validateTiers(tiers, model));
  if (Object.keys(errors).length) return { ok: false, errors };

  const setup = { model, flatRate, tiers, tierPeriod, averageTicket, baseWage, tipPerClient, serviceMinutes, nonClientHours };
  const weeklyGoal = goalPeriod === 'month' ? goal / WEEKS_PER_MONTH : goal;
  const maxClients = Math.min(MAX_CLIENTS_PER_WEEK, Math.floor((HOURS_PER_WEEK - nonClientHours) / (serviceMinutes / 60) + EPS));
  const rates = model === 'flat' ? [flatRate] : tiers.map((t) => t.rate);
  if (!(Math.max(...rates) > 0) && !(baseWage > 0) && !(tipPerClient > 0)) {
    return { ok: false, errors: { _: 'This pay setup pays $0 for every client. Add a commission rate above 0%, a base hourly wage or tips.' } };
  }
  let need = null;
  for (let c = 0; c <= maxClients; c++) if (payAt(setup, c).total + EPS >= weeklyGoal) { need = c; break; }
  if (need === null) {
    const most = payAt(setup, maxClients);
    return { ok: false, unreachable: true, errors: { _: `Even ${maxClients.toLocaleString('en-US')} clients a week, every hour of the week, pays about `
      + `$${Math.round(most.total).toLocaleString('en-US')} a week before tax: short of your goal. A higher ticket, rate or wage has to change first.` } };
  }
  const at = payAt(setup, need);
  // the next tier up: the first whole client count past the goal that reaches a higher tier
  let next = null;
  if (model !== 'flat' && at.tierIndex < tiers.length - 1) {
    for (let c = need + 1; c <= maxClients; c++) {
      const p = payAt(setup, c);
      if (p.tierIndex > at.tierIndex) {
        const gain = p.total - at.total, extra = c - need;
        // a cliff: the higher rate lands on all sales, so the extra clients pay more each than a client pays now
        const perClientNow = need > 0 ? at.total / need : 0;
        next = { index: p.tierIndex, number: p.tierIndex + 1, rate: p.rate, from: p.tierFrom, clients: c, extraClients: extra, payWeekly: p.total,
          payMonthly: p.total * WEEKS_PER_MONTH, gainWeekly: gain, gainMonthly: gain * WEEKS_PER_MONTH, perExtraClient: gain / extra,
          perClientNow, cliff: p.rate > at.rate && gain / extra > perClientNow + EPS, hours: p.hours };
        break;
      }
    }
  }
  // each tier: the fewest clients a week that reach it, and the pay there
  const steps = model === 'flat' ? [] : tiers.map((t, i) => {
    for (let c = 0; c <= maxClients; c++) {
      const p = payAt(setup, c);
      if (p.tierIndex >= i) return { index: i, number: i + 1, from: t.from, rate: t.rate, clients: c, payWeekly: p.total, reachable: true };
    }
    return { index: i, number: i + 1, from: t.from, rate: t.rate, clients: 0, payWeekly: 0, reachable: false };
  });
  return {
    ok: true, goal, goalPeriod, weeklyGoal, monthlyGoal: weeklyGoal * WEEKS_PER_MONTH, model, tierPeriod, averageTicket, serviceMinutes,
    clientsPerWeek: need, clientsPerMonth: need * WEEKS_PER_MONTH, salesPerWeek: at.sales, salesPerMonth: at.sales * WEEKS_PER_MONTH,
    tier: { index: at.tierIndex, number: at.tierIndex + 1, rate: at.rate, from: at.tierFrom, top: model !== 'flat' && at.tierIndex === tiers.length - 1 }, week: at, month: monthly(at),
    clientHoursPerWeek: at.clientHours, hoursPerWeek: at.hours, nonClientHours, hoursPerDay, daysPerWeek: at.hours / hoursPerDay,
    fitsInWeek: at.hours / hoursPerDay <= 7 + EPS, maxClients, next, steps,
  };
}
