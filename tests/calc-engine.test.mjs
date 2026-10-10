// node --test tests/  — the calculator engine (assets/calc/core): spec §28 cases for all eleven calculators, validation, no NaN/Infinity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateServicePricing, calculateHourlyRate, calculateEmployeeEarnings, RANGE_HEADROOM, MIN_PROFIT_MARGIN, EXAMPLE_SERVICE_MINUTES } from '../assets/calc/core/pricing.js';
import { calculateBreakEven, breakEvenChart } from '../assets/calc/core/breakeven.js';
import { calculateServiceProfitability } from '../assets/calc/core/profit.js';
import { calculateConsumableCost, calculateServiceCost } from '../assets/calc/core/costs.js';
import { parseNumber, validateFields, percentRule, hasBadNumber } from '../assets/calc/core/validation.js';
import { formatMoney, describeProfit, roundCurrency } from '../assets/calc/core/money.js';
import { formatPercent, toRate } from '../assets/calc/core/percentages.js';
import { allocateOverhead, allocateRent, DEFAULT_HOURS_PER_MONTH } from '../assets/calc/core/overhead.js';
import { calculatePriceIncrease } from '../assets/calc/core/pricing.js';
import { calculateBusinessProfit, calculateEmployeeTakeHome } from '../assets/calc/core/profit.js';
import { calculateDiscount } from '../assets/calc/core/discount.js';
import { calculateCapacity, scenarioTickets } from '../assets/calc/core/capacity.js';
import { calculateMenuProfitability } from '../assets/calc/core/menu.js';
import { serviceCostParts, profitAt } from '../assets/calc/core/costs.js';
import { rateForTier, payAt, clientsForGoal, validateTiers, WEEKS_PER_MONTH as WPM, MAX_TIERS } from '../assets/calc/core/commission.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);
const BASE = { durationMinutes: 60, productCost: 10, targetHourly: 50 };

// ---------- pricing ----------
test('pricing: normal service (overhead, processing and margin)', () => {
  const r = calculateServicePricing({ ...BASE, currentPrice: 100, monthlyFixed: 2000, monthlyVariable: 400,
    monthlyAppointments: 80, processingRate: 0.03, profitMargin: 0.3 });
  assert.equal(r.ok, true);
  near(r.overhead, 30, 'overhead per appointment');
  near(r.rentShare, 0, 'no rent entered, no rent added');
  near(r.breakEvenPrice, 90 / 0.97, 'break-even price includes labor');
  near(r.breakEvenPrice * 0.97 - 40 - 50, 0, 'profit at the break-even price is exactly $0');
  near(r.recommendedPrice, 90 / 0.67, 'recommended price');
  // the recommended price really covers its own processing fee and leaves the margin (no circular error)
  const P = r.recommendedPrice;
  near(P - P * 0.03 - 10 - 30 - 50, 0.3 * P, 'profit at recommended = margin × price');
  near(r.recommended.effectiveHourly, 50 + 0.3 * P, 'hourly earnings at recommended price');
  assert.equal(r.status, 'under');
  near(r.difference, P - 100, 'underpriced by');
  near(r.current.profit, 100 * 0.97 - 40 - 50, 'profit at current price');
});

test('pricing: zero overhead needs no appointment count; margin defaults to the 30% minimum', () => {
  const r = calculateServicePricing({ ...BASE });
  assert.equal(r.ok, true);
  near(r.overhead, 0);
  near(r.recommendedPrice, 60 / 0.7, 'cost + time, grossed up for the default 30% margin');
  near(r.breakEvenPrice, 60, 'products + labor, no fees');
  near(r.recommended.profit, 0.3 * r.recommendedPrice);
  near(r.recommended.margin, MIN_PROFIT_MARGIN);
  assert.equal(calculateServicePricing({ ...BASE, profitMargin: 0 }).ok, false, 'a 0% margin is no longer accepted');
  assert.equal(r.status, 'none');
  assert.equal(r.current, null);
});

test('pricing: high processing fee is grossed up, and 100% or more is rejected', () => {
  const r = calculateServicePricing({ ...BASE, processingRate: 0.5 });
  near(r.recommendedPrice, 60 / (1 - 0.5 - 0.3));
  near(r.processingAtRecommended, 150);
  assert.equal(calculateServicePricing({ ...BASE, processingRate: 1 }).ok, false);
  assert.ok(calculateServicePricing({ ...BASE, processingRate: 1.2 }).errors.processingRate);
  const both = calculateServicePricing({ ...BASE, processingRate: 0.6, profitMargin: 0.4 });
  assert.equal(both.ok, false);
  assert.match(both.errors.profitMargin, /below 100%/);
});

test('pricing: target margin is a share of the final price', () => {
  const r = calculateServicePricing({ ...BASE, profitMargin: 0.4 });
  near(r.recommendedPrice, 100);
  near(r.recommended.profit, 40);
  near(r.recommended.margin, 0.4);
});

test('pricing: existing price above, within and below the recommended range', () => {
  // 40% margin: recommended 100, range 100–110
  const M = { ...BASE, profitMargin: 0.4 };
  assert.equal(calculateServicePricing({ ...M, currentPrice: 120 }).status, 'above');
  assert.equal(calculateServicePricing({ ...M, currentPrice: 100 }).status, 'within');
  assert.equal(calculateServicePricing({ ...M, currentPrice: 100 * (1 + RANGE_HEADROOM) }).status, 'within');
  assert.equal(calculateServicePricing({ ...M, currentPrice: 99 }).status, 'under');
  const above = calculateServicePricing({ ...M, currentPrice: 120 });
  near(above.difference, -20, 'negative difference = above recommendation');
  near(above.current.profit, 60);
  near(above.aboveRangeBy, 120 - 110, 'how far above the top of the range');
  near(calculateServicePricing({ ...M, currentPrice: 105 }).aboveRangeBy, 0);
});

test('pricing: non-client hours load every client hour; spreading costs needs appointments', () => {
  const r = calculateServicePricing({ ...BASE, monthlyAppointments: 80, nonClientHoursPerMonth: 20 });
  near(r.loadFactor, 1.25);
  near(r.timeValue, 62.5);
  // at the recommended price you earn your target across all hours, plus the 30% margin spread over them
  near(r.recommended.effectiveHourly, 50 + (0.3 * r.recommendedPrice) / 1.25, 'target + margin across all hours');
  assert.ok(calculateServicePricing({ ...BASE, nonClientHoursPerMonth: 20 }).errors.monthlyAppointments);
  assert.ok(calculateServicePricing({ ...BASE, monthlyFixed: 500 }).errors.monthlyAppointments);
  assert.ok(calculateServicePricing({ ...BASE, durationMinutes: 0 }).errors.durationMinutes);
});

// ---------- break-even ----------
test('break-even: normal contribution margin', () => {
  const r = calculateBreakEven({ fixedCosts: 3000, servicePrice: 100, variableCost: 20, processingRate: 0.03 });
  assert.equal(r.possible, true);
  near(r.contribution, 77);
  near(r.appointments, 3000 / 77);
  assert.equal(r.appointmentsWhole, 39);
  near(r.revenue, (3000 / 77) * 100);
  near(r.weeklyAppointments, (3000 / 77) / (52 / 12));
  near(r.dailyAppointments, r.weeklyAppointments / 5);
  const chart = breakEvenChart(r);
  // the revenue and cost lines cross at the break-even point
  const at = (line, x) => line[0][1] + (line[1][1] - line[0][1]) * (x / chart.maxAppointments);
  near(at(chart.revenue, r.appointments), at(chart.cost, r.appointments), 'lines cross at break-even');
});

test('break-even: zero contribution margin is impossible, not a division by zero', () => {
  const r = calculateBreakEven({ fixedCosts: 3000, servicePrice: 100, variableCost: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.possible, false);
  assert.equal(r.reason, 'zero');
  assert.equal(hasBadNumber(r), false);
  assert.equal(breakEvenChart(r), null);
});

test('break-even: negative contribution margin is impossible', () => {
  const r = calculateBreakEven({ fixedCosts: 3000, servicePrice: 100, variableCost: 90, processingRate: 0.15 });
  assert.equal(r.possible, false);
  assert.equal(r.reason, 'negative');
  assert.ok(r.contribution < 0);
});

test('break-even: zero fixed costs break even at zero appointments', () => {
  const r = calculateBreakEven({ fixedCosts: 0, servicePrice: 100, variableCost: 20 });
  assert.equal(r.possible, true);
  near(r.appointments, 0);
  near(r.revenue, 0);
  assert.equal(r.appointmentsWhole, 0);
});

test('break-even: retail adds its own contribution; bad inputs are errors', () => {
  const r = calculateBreakEven({ fixedCosts: 1000, servicePrice: 100, variableCost: 20, retailRevenue: 20, retailCostRate: 0.5 });
  near(r.contribution, 90);
  near(r.revenue, (1000 / 90) * 120);
  assert.ok(calculateBreakEven({ fixedCosts: 1000, servicePrice: 0 }).errors.servicePrice);
  assert.ok(calculateBreakEven({ fixedCosts: 1000, servicePrice: 100, processingRate: 1 }).errors.processingRate);
});

// ---------- hourly rate ----------
test('hourly rate: income after tax + expenses spread over client hours', () => {
  const r = calculateHourlyRate({ desiredAnnualIncome: 60000, workingWeeksPerYear: 48, workingDaysPerWeek: 5, hoursPerDay: 8,
    nonClientHoursPerDay: 2, annualExpenses: 12000, taxRate: 0.25, exampleServiceMinutes: 90 });
  near(r.preTaxIncome, 80000);
  near(r.estimatedTaxes, 20000);
  near(r.annualRevenue, 92000);
  near(r.monthlyRevenue, 92000 / 12);
  near(r.annualHours, 1920);
  near(r.annualClientHours, 1440);
  near(r.perWorkingHour, 92000 / 1920);
  near(r.perClientHour, 92000 / 1440);
  near(r.exampleServiceRevenue, 1.5 * 92000 / 1440, 'a 90-minute example service');
  assert.equal(EXAMPLE_SERVICE_MINUTES, 90);
  const byDefault = calculateHourlyRate({ desiredAnnualIncome: 60000, nonClientHoursPerDay: 2, annualExpenses: 12000, taxRate: 0.25 });
  assert.equal(byDefault.exampleServiceMinutes, 90, 'the example service defaults to 90 minutes');
  near(byDefault.exampleServiceRevenue, 1.5 * byDefault.perClientHour);
  assert.equal(calculateEmployeeEarnings({ desiredAnnualIncome: 45000, payType: 'commission', commissionRate: 0.4 }).exampleServiceMinutes, 90);
  assert.ok(calculateHourlyRate({ desiredAnnualIncome: 60000, hoursPerDay: 8, nonClientHoursPerDay: 8 }).errors.nonClientHoursPerDay);
  assert.ok(calculateHourlyRate({ desiredAnnualIncome: 60000, taxRate: 1 }).errors.taxRate);
});

// ---------- service profitability ----------
test('service profitability: profitable but below the hourly target', () => {
  const r = calculateServiceProfitability({ price: 120, durationMinutes: 90, productCost: 8, supplyCost: 4, overhead: 25,
    processingRate: 0.03, targetHourly: 70 });
  near(r.totalCost, 40.6);
  near(r.profit, 79.4);
  near(r.margin, 79.4 / 120);
  near(r.profitPerHour, 79.4 / 1.5);
  near(r.revenuePerHour, 80);
  near(r.consumables, 12);
  assert.equal(r.status, 'below-target');
});

test('service profitability: loss, break-even and meeting the target', () => {
  const loss = calculateServiceProfitability({ price: 50, durationMinutes: 60, productCost: 40, laborHourly: 20 });
  assert.equal(loss.status, 'loss');
  near(loss.labor, 20, '$20/hour × 1 hour of labor');
  near(loss.profit, -10);
  assert.equal(calculateServiceProfitability({ price: 50, durationMinutes: 60, productCost: 50 }).status, 'even');
  const owner = calculateServiceProfitability({ price: 200, durationMinutes: 60, productCost: 10, commissionRate: 0.4, targetHourly: 100 });
  near(owner.commission, 80);
  near(owner.profit, 110);
  assert.equal(owner.status, 'meets-target');
  assert.ok(calculateServiceProfitability({ price: 100, durationMinutes: 60, commissionRate: 1 }).errors.commissionRate);
});

// ---------- cost per service ----------
test('cost per service: line items split into product and supply (supply includes other consumables)', () => {
  const r = calculateConsumableCost([
    { category: 'product', quantity: 1, unitCost: 2.5 }, { category: 'product', quantity: 0.5, unitCost: 6 },
    { category: 'supply', quantity: 2, unitCost: 0.375 }, { category: 'other', quantity: 1, unitCost: 1.5 },
  ]);
  near(r.productCost, 5.5);
  near(r.supplyOnly, 0.75);
  near(r.supplyCost, 2.25);
  near(r.totalCost, 7.75);
  assert.equal(r.largestIndex, 1);
  near(r.largestShare, 3 / 7.75);
  assert.ok(calculateConsumableCost([{ category: 'product', quantity: -1, unitCost: 2 }]).errors['quantity-0']);
  near(calculateConsumableCost([]).totalCost, 0);
});

// ---------- validation ----------
test('validation: rates of 100% or more are rejected; 99.99% is allowed', () => {
  const rule = percentRule('a payment processing rate');
  assert.equal(parseNumber('100', rule).ok, false);
  assert.equal(parseNumber('150%', rule).ok, false);
  assert.match(parseNumber('100', rule).error, /below 100%/);
  assert.equal(parseNumber('99.99', rule).value, 99.99);
  assert.equal(parseNumber('3%', rule).value, 3);
});

test('validation: blank optional fields are 0; blank required fields name the problem', () => {
  assert.deepEqual(parseNumber('', { name: 'monthly fixed expenses', unit: 'money' }), { ok: true, value: 0, blank: true });
  assert.deepEqual(parseNumber('   ', {}), { ok: true, value: 0, blank: true });
  assert.equal(parseNumber('', { name: 'a service price', unit: 'money', required: true, minExclusive: true }).error,
    'Enter a service price greater than $0.');
  assert.equal(parseNumber('0', { name: 'a service price', unit: 'money', required: true, minExclusive: true }).error,
    'Enter a service price greater than $0.');
});

test('validation: non-numbers and negatives are rejected, never turned into a plausible number', () => {
  const rule = { name: 'a product cost', unit: 'money' };
  for (const bad of ['abc', '12abc', '1e3', 'NaN', 'Infinity', '--5', '1.2.3', '-5']) {
    assert.equal(parseNumber(bad, rule).ok, false, bad);
  }
  assert.equal(parseNumber('$1,250.50', rule).value, 1250.5);
  assert.equal(parseNumber('.5', rule).value, 0.5);
  assert.match(parseNumber('2000', { name: 'a service duration', unit: 'minutes', max: 1440 }).error, /1,440 or less/);
  const v = validateFields({ a: { name: 'a', required: true }, b: { name: 'b' } }, { a: '', b: '' });
  assert.equal(v.ok, false);
  assert.deepEqual(v.values, { b: 0 });
});

test('no NaN, Infinity or undefined: every engine result is finite or a named error', () => {
  const samples = [0, 1e-9, 0.5, 1, 7, 60, 99.99, 100, 1e7, -1, NaN, Infinity, undefined];
  const pick = (i, k) => samples[(i * 7 + k * 3) % samples.length];
  for (let i = 0; i < 400; i++) {
    const results = [
      calculateServicePricing({ currentPrice: pick(i, 1), durationMinutes: pick(i, 2), productCost: pick(i, 3), targetHourly: pick(i, 4),
        monthlyFixed: pick(i, 5), monthlyVariable: pick(i, 6), monthlyAppointments: pick(i, 7), processingRate: toRate(pick(i, 8)),
        profitMargin: toRate(pick(i, 9)), nonClientHoursPerMonth: pick(i, 10), commissionRate: toRate(pick(i, 11)) }),
      calculateBreakEven({ fixedCosts: pick(i, 1), servicePrice: pick(i, 2), variableCost: pick(i, 3), processingRate: toRate(pick(i, 4)),
        monthlyPay: pick(i, 5), monthlyPayroll: pick(i, 6), ownerPay: pick(i, 7), commissionRate: toRate(pick(i, 8)) }),
      calculateHourlyRate({ desiredAnnualIncome: pick(i, 1), workingWeeksPerYear: pick(i, 2), workingDaysPerWeek: pick(i, 3),
        hoursPerDay: pick(i, 4), nonClientHoursPerDay: pick(i, 5), annualExpenses: pick(i, 6), taxRate: toRate(pick(i, 7)), monthlyPayroll: pick(i, 8) }),
      calculateServiceCost({ items: [{ category: 'supply', quantity: 1, unitCost: pick(i, 1) }], monthlyRent: pick(i, 2), hoursPerMonth: pick(i, 3),
        durationMinutes: pick(i, 4), monthlyPay: pick(i, 5), providerWage: pick(i, 6), commissionRate: toRate(pick(i, 7)), price: pick(i, 8) }),
      calculateServiceProfitability({ price: pick(i, 1), durationMinutes: pick(i, 2), productCost: pick(i, 3), processingRate: toRate(pick(i, 4)),
        targetHourly: pick(i, 5), commissionRate: toRate(pick(i, 6)), laborHourly: pick(i, 7) }),
      calculateConsumableCost([{ category: 'product', quantity: pick(i, 1), unitCost: pick(i, 2) }]),
    ];
    for (const r of results) {
      if (r.ok) assert.equal(hasBadNumber(r), false, JSON.stringify(r));
      else assert.ok(Object.values(r.errors).every((m) => typeof m === 'string' && m.length > 0));
    }
  }
});

// ---------- display helpers ----------
test('display: money formats, loss labelling and rounding only at the edge', () => {
  assert.equal(formatMoney(1250), '$1,250');
  assert.equal(formatMoney(68.5), '$68.50');
  assert.equal(formatMoney(142.37), '$142');
  assert.equal(formatMoney(110.39, { up: true }), '$111', 'a price to charge rounds up, never below target');
  assert.equal(formatMoney(110.004, { up: true }), '$110', 'float noise does not add a dollar');
  assert.equal(formatMoney(10.39, { whole: true }), '$10');
  assert.equal(formatMoney(NaN), '—');
  assert.equal(formatMoney(Infinity), '—');
  assert.equal(formatPercent(0.687), '69%');
  assert.equal(formatPercent(NaN), '—');
  assert.deepEqual(describeProfit(-42), { word: 'Loss', amount: 42, loss: true, even: false });
  assert.equal(describeProfit(0.001).word, 'Break-even');
  assert.equal(roundCurrency(1.005), 1.01);
  assert.equal(allocateOverhead(0, 0), 0);
  assert.equal(allocateOverhead(100, 0), null);
});

test('pricing: the difference card uses the shown (rounded-up) price, so $117 vs $100 reads $17', () => {
  const r = calculateServicePricing({ currentPrice: 100, durationMinutes: 60, productCost: 10, targetHourly: 60, monthlyFixed: 2000, monthlyAppointments: 100, processingRate: 0.03, profitMargin: 0.3 });
  assert.ok(r.recommendedPrice > 134.3 && r.recommendedPrice < 134.4); // 90 / 0.67 = 134.33
  assert.equal(r.shownPrice, 135);
  assert.equal(r.shownDifference, 35);
  assert.equal(formatMoney(r.recommendedPrice, { up: true }), formatMoney(r.shownPrice));
  const above = calculateServicePricing({ currentPrice: 130, durationMinutes: 60, productCost: 10, targetHourly: 60 }); // recommended 100
  assert.equal(formatMoney(Math.abs(above.shownDifference)), '$30');
});

// ---------- rent (its own input; shared by the hours worked) ----------
const FACIAL = { monthlyRent: 2000, hoursPerMonth: 160, durationMinutes: 90 };

test('rent allocation: $2,000 rent, 160 hours, a 90-minute facial carries $18.75', () => {
  const r = allocateRent(FACIAL);
  assert.equal(r.ok, true);
  near(r.rentPerHour, 12.5);
  near(r.rentShare, 18.75);
  assert.equal(DEFAULT_HOURS_PER_MONTH, 160);
  near(allocateRent({ monthlyRent: 2000, durationMinutes: 90 }).rentShare, 18.75, 'hours default to 160');
  near(allocateRent({ ...FACIAL, hoursPerMonth: 200 }).rentShare, 15, 'more hours worked, less rent per service');
  near(calculateServicePricing({ durationMinutes: 90, targetHourly: 0, monthlyRent: 2000, hoursPerMonth: 100 }).rentShare, 30);
});

test('rent allocation: rent $0 adds $0; hours of 0, negative, blank-as-NaN or over 744 are rejected', () => {
  near(allocateRent({ ...FACIAL, monthlyRent: 0 }).rentShare, 0);
  for (const bad of [0, -10, NaN, Infinity, 745]) {
    const r = allocateRent({ ...FACIAL, hoursPerMonth: bad });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.errors.hoursPerMonth, /hours you work per month/);
  }
  assert.equal(allocateRent({ ...FACIAL, monthlyRent: 0, hoursPerMonth: 0 }).ok, false, 'hours 0 is rejected even with no rent');
  assert.ok(allocateRent({ ...FACIAL, monthlyRent: -1 }).errors.monthlyRent);
});

test('rent in service pricing: part of the cost base and the break-even price, never double-counted with other expenses', () => {
  const base = { durationMinutes: 90, productCost: 12, targetHourly: 50, processingRate: 0.03, profitMargin: 0.3 };
  const r = calculateServicePricing({ ...base, monthlyRent: 2000, hoursPerMonth: 160 });
  near(r.rentShare, 18.75);
  near(r.breakEvenPrice, (12 + 18.75 + 75) / 0.97);
  near(r.recommendedPrice, (12 + 18.75 + 75) / 0.67);
  const noRent = calculateServicePricing(base);
  near(r.recommendedPrice - noRent.recommendedPrice, 18.75 / 0.67, 'rent adds exactly its share, grossed up once');
  // other fixed expenses stay per appointment and are added on top of rent, not instead of it
  const both = calculateServicePricing({ ...base, monthlyRent: 2000, hoursPerMonth: 160, monthlyFixed: 400, monthlyAppointments: 80 });
  near(both.overhead, 5);
  near(both.directCosts, 12 + 18.75 + 5);
  // rent needs no appointment count (it is shared by hours)
  assert.equal(calculateServicePricing({ ...base, monthlyRent: 2000 }).ok, true);
  assert.ok(calculateServicePricing({ ...base, monthlyRent: 2000, hoursPerMonth: 0 }).errors.hoursPerMonth);
});

test('rent in cost per service: product + supply + rent share = true cost', () => {
  const items = [{ category: 'product', quantity: 1, unitCost: 8 }, { category: 'supply', quantity: 2, unitCost: 1.5 }];
  const r = calculateServiceCost({ items, ...FACIAL });
  assert.equal(r.ok, true);
  near(r.productCost, 8);
  near(r.supplyCost, 3);
  near(r.consumableCost, 11);
  near(r.rentShare, 18.75);
  near(r.trueCost, 29.75);
  near(calculateServiceCost({ items, monthlyRent: 0 }).trueCost, 11, 'rent 0: true cost is products and supplies');
  assert.ok(calculateServiceCost({ items, monthlyRent: 2000 }).errors.durationMinutes, 'rent needs the service duration');
  assert.ok(calculateServiceCost({ items, ...FACIAL, hoursPerMonth: 0 }).errors.hoursPerMonth);
  assert.ok(calculateServiceCost({ items: [{ category: 'product', quantity: -1, unitCost: 2 }], ...FACIAL }).errors['quantity-0']);
});

test('rent in service profitability: rent share is part of total cost, alongside other overhead', () => {
  const r = calculateServiceProfitability({ price: 150, durationMinutes: 90, productCost: 8, supplyCost: 4, overhead: 5,
    monthlyRent: 2000, hoursPerMonth: 160 });
  near(r.rentShare, 18.75);
  near(r.totalCost, 8 + 4 + 18.75 + 5);
  near(r.profit, 150 - 35.75);
  near(calculateServiceProfitability({ price: 150, durationMinutes: 90, productCost: 8 }).rentShare, 0);
  assert.ok(calculateServiceProfitability({ price: 150, durationMinutes: 90, monthlyRent: 2000, hoursPerMonth: 0 }).errors.hoursPerMonth);
});

test('rent in break-even: monthly rent is added to other fixed costs', () => {
  const r = calculateBreakEven({ monthlyRent: 2000, fixedCosts: 1000, servicePrice: 100, variableCost: 20, processingRate: 0.03 });
  near(r.fixedCosts, 3000);
  near(r.rent, 2000);
  near(r.otherFixedCosts, 1000);
  near(r.appointments, 3000 / 77);
  const rentOnly = calculateBreakEven({ monthlyRent: 3000, fixedCosts: 0, servicePrice: 100, variableCost: 20, processingRate: 0.03 });
  near(rentOnly.appointments, r.appointments, 'rent counts exactly like other fixed costs');
  assert.ok(calculateBreakEven({ monthlyRent: -5, fixedCosts: 0, servicePrice: 100 }).errors.monthlyRent);
});

test('rent in hourly rate (solo/owner): annual expenses = rent × 12 + other annual expenses', () => {
  const r = calculateHourlyRate({ desiredAnnualIncome: 60000, workingWeeksPerYear: 48, workingDaysPerWeek: 5, hoursPerDay: 8,
    nonClientHoursPerDay: 2, monthlyRent: 1000, annualExpenses: 6000, taxRate: 0.25 });
  near(r.annualRent, 12000);
  near(r.totalExpenses, 18000);
  near(r.annualRevenue, 98000);
  near(r.rentPerClientHour, 12000 / 1440);
  near(r.rentShareOfRevenue, 12000 / 98000);
  assert.ok(calculateHourlyRate({ desiredAnnualIncome: 60000, monthlyRent: -1 }).errors.monthlyRent);
});

// ---------- 30% minimum profit margin (service pricing) ----------
test('pricing floor: 29% margin is rejected with the field message, 30% and higher are accepted', () => {
  const r29 = calculateServicePricing({ ...BASE, profitMargin: toRate(29) });
  assert.equal(r29.ok, false);
  assert.equal(r29.errors.profitMargin, 'Enter a profit margin of at least 30%.');
  assert.equal(calculateServicePricing({ ...BASE, profitMargin: toRate(29.99) }).ok, false);
  assert.equal(calculateServicePricing({ ...BASE, profitMargin: toRate(30) }).ok, true);
  assert.equal(calculateServicePricing({ ...BASE, profitMargin: toRate(55) }).ok, true);
  assert.equal(MIN_PROFIT_MARGIN, 0.3);
  // processing + margin must still stay below 100%
  assert.match(calculateServicePricing({ ...BASE, processingRate: 0.7, profitMargin: 0.3 }).errors.profitMargin, /below 100%/);
  assert.match(calculateServicePricing({ ...BASE, profitMargin: 1 }).errors.profitMargin, /below 100%/);
});

test('pricing floor: the current price is flagged when its margin is below 30%', () => {
  // cost + time = 60; at $85 the margin is 25/85 = 29.4%; at $86 it is 26/86 = 30.2%
  const low = calculateServicePricing({ ...BASE, currentPrice: 85 });
  near(low.current.margin, 25 / 85);
  assert.equal(low.currentBelowMinimum, true);
  assert.equal(calculateServicePricing({ ...BASE, currentPrice: 86 }).currentBelowMinimum, false);
  assert.equal(calculateServicePricing({ ...BASE, currentPrice: 50 }).currentBelowMinimum, true, 'a loss is below the minimum');
  assert.equal(calculateServicePricing({ ...BASE }).currentBelowMinimum, false, 'no current price, nothing to flag');
  // a 40% target can leave a current price under the target but still above the 30% floor: not flagged
  const mid = calculateServicePricing({ ...BASE, profitMargin: 0.4, currentPrice: 90 });
  assert.equal(mid.status, 'under');
  assert.equal(mid.currentBelowMinimum, false);
});

// ---------- hourly rate: employees ----------
const EMP = { desiredAnnualIncome: 45000, taxRate: 0.25, workingWeeksPerYear: 48, workingDaysPerWeek: 5, hoursPerDay: 8, nonClientHoursPerDay: 2 };
// pre-tax goal 60,000; paid hours 1,920; client hours 1,440

test('employee hourly: wage = (pre-tax income − annual tips) ÷ paid hours', () => {
  const r = calculateEmployeeEarnings({ ...EMP, payType: 'hourly', monthlyTips: 500 });
  near(r.preTaxIncome, 60000);
  near(r.annualTips, 6000);
  near(r.paidHours, 1920);
  near(r.requiredWage, 54000 / 1920);
  assert.equal(r.goalMet, false);
  near(calculateEmployeeEarnings({ ...EMP, payType: 'hourly' }).requiredWage, 60000 / 1920, 'no tips');
  assert.equal(r.annualRent, undefined, 'employees carry no rent');
});

test('employee hourly: tips alone can meet the goal (wage 0, never negative)', () => {
  const r = calculateEmployeeEarnings({ ...EMP, payType: 'hourly', monthlyTips: 6000 });
  assert.equal(r.goalMet, true);
  near(r.requiredWage, 0);
  near(r.surplus, 72000 - 60000);
});

test('employee commission: monthly service revenue = (pre-tax monthly income − monthly tips) ÷ commission', () => {
  const r = calculateEmployeeEarnings({ ...EMP, payType: 'commission', commissionRate: 0.4, monthlyTips: 500 });
  near(r.monthlyServiceRevenue, (5000 - 500) / 0.4);
  near(r.annualServiceRevenue, 54000 / 0.4);
  near(r.weeklyServiceRevenue, 54000 / 0.4 / 48);
  near(r.perClientHour, 54000 / 0.4 / 1440);
  near(r.annualCommission, 54000);
});

test('employee commission: 0%, 100%, over 100% and NaN commission are rejected', () => {
  for (const bad of [0, 1, 1.5, -0.1, NaN, undefined]) {
    const r = calculateEmployeeEarnings({ ...EMP, payType: 'commission', commissionRate: bad });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.errors.commissionRate, /above 0% and below 100%/);
  }
  assert.ok(calculateEmployeeEarnings({ ...EMP, payType: 'mixed', commissionRate: 0, baseHourlyWage: 15 }).errors.commissionRate);
  // the commission rate is ignored (not required) for hourly pay
  assert.equal(calculateEmployeeEarnings({ ...EMP, payType: 'hourly', commissionRate: 0 }).ok, true);
});

test('employee hourly + commission: base pay first, commission covers the rest; base + tips can already meet the goal', () => {
  const r = calculateEmployeeEarnings({ ...EMP, payType: 'mixed', baseHourlyWage: 15, commissionRate: 0.2, monthlyTips: 250 });
  near(r.basePay, 15 * 1920);
  near(r.remaining, 60000 - 28800 - 3000);
  near(r.annualServiceRevenue, 28200 / 0.2);
  near(r.monthlyServiceRevenue, 28200 / 0.2 / 12);
  assert.equal(r.goalMet, false);
  const met = calculateEmployeeEarnings({ ...EMP, payType: 'mixed', baseHourlyWage: 31, commissionRate: 0.2, monthlyTips: 100 });
  assert.equal(met.goalMet, true);
  near(met.annualServiceRevenue, 0, 'no negative revenue');
  near(met.monthlyServiceRevenue, 0);
  near(met.remaining, 0, 'nothing left to earn');
  near(met.surplus, 31 * 1920 + 1200 - 60000);
  assert.equal(hasBadNumber(met), false);
  assert.ok(calculateEmployeeEarnings({ ...EMP, payType: 'mixed', commissionRate: 0.2, baseHourlyWage: NaN }).errors.baseHourlyWage);
});

test('employee: bad pay type, blank (NaN) goal, negative tips and 100% tax are named errors', () => {
  assert.ok(calculateEmployeeEarnings({ ...EMP, payType: 'salary' }).errors.payType);
  assert.ok(calculateEmployeeEarnings({ ...EMP, desiredAnnualIncome: NaN }).errors.desiredAnnualIncome);
  assert.ok(calculateEmployeeEarnings({ ...EMP, monthlyTips: -1 }).errors.monthlyTips);
  assert.ok(calculateEmployeeEarnings({ ...EMP, taxRate: 1 }).errors.taxRate);
  const samples = [0, 0.5, 1, 7, 99.99, 100, 1e7, -1, NaN, Infinity, undefined];
  for (let i = 0; i < 300; i++) {
    const pick = (k) => samples[(i * 5 + k * 3) % samples.length];
    const r = calculateEmployeeEarnings({ desiredAnnualIncome: pick(1), payType: ['hourly', 'commission', 'mixed'][i % 3], monthlyTips: pick(2),
      commissionRate: toRate(pick(3)), baseHourlyWage: pick(4), taxRate: toRate(pick(5)), hoursPerDay: pick(6), nonClientHoursPerDay: pick(7) });
    if (r.ok) assert.equal(hasBadNumber(r), false, JSON.stringify(r));
    else assert.ok(Object.values(r.errors).every((m) => typeof m === 'string' && m.length > 0));
  }
});

// ---------- labor (solo pay, owner payroll, commission) ----------
test('labor in break-even (solo): your monthly pay is a fixed cost', () => {
  const r = calculateBreakEven({ monthlyRent: 1000, monthlyPay: 2000, fixedCosts: 0, servicePrice: 100, variableCost: 20, processingRate: 0.03 });
  near(r.laborFixed, 2000);
  near(r.fixedCosts, 3000, 'rent + your pay');
  near(r.contribution, 77, 'pay is not a per-service cost');
  near(r.appointments, 3000 / 77);
  assert.ok(calculateBreakEven({ monthlyPay: -1, fixedCosts: 0, servicePrice: 100 }).errors.monthlyPay);
});

test('labor in break-even (owner): payroll + owner pay are fixed; commission comes off each appointment', () => {
  const r = calculateBreakEven({ monthlyRent: 2000, monthlyPayroll: 6000, ownerPay: 4000, fixedCosts: 1000, servicePrice: 100,
    variableCost: 20, processingRate: 0.03, commissionRate: 0.4 });
  near(r.laborFixed, 10000);
  near(r.fixedCosts, 13000);
  near(r.commission, 40);
  near(r.contribution, 97 - 40 - 20, 'net price − commission − variable cost');
  near(r.appointments, 13000 / 37);
  const chart = breakEvenChart(r);
  const at = (line, x) => line[0][1] + (line[1][1] - line[0][1]) * (x / chart.maxAppointments);
  near(at(chart.revenue, r.appointments), at(chart.cost, r.appointments), 'lines still cross at break-even');
  // commission can make break-even impossible: zero and negative contribution are named, never divided by
  const zero = calculateBreakEven({ fixedCosts: 1000, servicePrice: 100, variableCost: 50, commissionRate: 0.5 });
  assert.equal(zero.possible, false);
  assert.equal(zero.reason, 'zero');
  const neg = calculateBreakEven({ fixedCosts: 1000, monthlyPayroll: 5000, servicePrice: 100, variableCost: 20, processingRate: 0.03, commissionRate: 0.8 });
  assert.equal(neg.possible, false);
  assert.equal(neg.reason, 'negative');
  assert.equal(hasBadNumber(neg), false);
  for (const bad of [1, 1.2, -0.1, NaN]) assert.ok(calculateBreakEven({ fixedCosts: 0, servicePrice: 100, commissionRate: bad }).errors.commissionRate, String(bad));
});

test('labor in hourly rate (owner): monthly payroll × 12 is an annual expense; solo pay is the income goal', () => {
  const S = { desiredAnnualIncome: 60000, workingWeeksPerYear: 48, workingDaysPerWeek: 5, hoursPerDay: 8, nonClientHoursPerDay: 2, monthlyRent: 1000, annualExpenses: 6000, taxRate: 0.25 };
  const owner = calculateHourlyRate({ ...S, monthlyPayroll: 5000 });
  near(owner.annualPayroll, 60000);
  near(owner.totalExpenses, 12000 + 60000 + 6000);
  near(owner.annualRevenue, 80000 + 78000);
  near(calculateHourlyRate(S).annualPayroll, 0, 'no payroll entered');
  assert.ok(calculateHourlyRate({ ...S, monthlyPayroll: -5 }).errors.monthlyPayroll);
});

test('labor in service pricing (owner): wage × hours + commission, grossed up like processing', () => {
  // cost + wage = 10 + 50 = 60; P = 60 / (1 − 0.4 commission − 0.3 margin) = 200
  const r = calculateServicePricing({ ...BASE, commissionRate: 0.4 });
  near(r.recommendedPrice, 200);
  near(r.commissionAtRecommended, 80);
  near(r.laborAtRecommended, 50 + 80);
  near(r.recommended.commission, 80);
  near(r.recommended.profit, 0.3 * 200, 'the margin survives the commission');
  const withFees = calculateServicePricing({ ...BASE, commissionRate: 0.4, processingRate: 0.03 });
  near(withFees.recommendedPrice, 60 / (1 - 0.03 - 0.4 - 0.3));
  const P = withFees.recommendedPrice;
  near(P - P * 0.03 - P * 0.4 - 10 - 50, 0.3 * P, 'processing + commission + margin all come out of the final price');
  near(withFees.breakEvenPrice, 60 / (1 - 0.03 - 0.4), 'break-even pays the wage and the commission');
  const B = withFees.breakEvenPrice;
  near(B - B * 0.03 - B * 0.4 - 10 - 50, 0, 'profit at the break-even price is exactly $0');
  // a current price is judged after commission too
  near(calculateServicePricing({ ...BASE, commissionRate: 0.4, currentPrice: 150 }).current.profit, 150 - 60 - 60);
});

test('labor in service pricing: processing + commission + margin of 100% or more is rejected', () => {
  for (const [processingRate, commissionRate, profitMargin] of [[0.3, 0.4, 0.3], [0.03, 0.67, 0.3], [0.1, 0.6, 0.35], [0, 0.7, 0.3]]) {
    const r = calculateServicePricing({ ...BASE, processingRate, commissionRate, profitMargin });
    assert.equal(r.ok, false, `${processingRate}/${commissionRate}/${profitMargin}`);
    assert.match(r.errors.commissionRate, /commission and profit margin together must be below 100%/);
    assert.match(r.errors.profitMargin, /below 100%/);
  }
  assert.equal(calculateServicePricing({ ...BASE, processingRate: 0.03, commissionRate: 0.66, profitMargin: 0.3 }).ok, true, '99% is still a price');
  assert.ok(calculateServicePricing({ ...BASE, commissionRate: 1 }).errors.commissionRate);
  assert.ok(calculateServicePricing({ ...BASE, commissionRate: -0.1 }).errors.commissionRate);
});

test('labor in service pricing (solo): your pay per hour is the only labor, never added twice', () => {
  const r = calculateServicePricing({ ...BASE, monthlyPay: 4000, providerWage: 30 });
  near(r.timeValue, 50, 'pay per hour × 1 hour; monthly pay or a wage are not inputs here');
  near(r.laborAtRecommended, 50);
  near(r.recommendedPrice, 60 / 0.7);
  near(r.commissionAtRecommended, 0);
});

test('labor in service profitability: solo pay per hour × duration; owner wage × duration + commission', () => {
  const solo = calculateServiceProfitability({ price: 120, durationMinutes: 90, productCost: 8, supplyCost: 4, laborHourly: 40 });
  near(solo.laborTime, 60);
  near(solo.labor, 60);
  near(solo.totalCost, 72);
  near(solo.profit, 48);
  near(solo.earningsPerHour, (48 + 60) / 1.5, 'your pay + profit, per hour');
  const owner = calculateServiceProfitability({ price: 120, durationMinutes: 60, productCost: 8, laborHourly: 20, commissionRate: 0.25, processingRate: 0.03 });
  near(owner.laborTime, 20);
  near(owner.commission, 30);
  near(owner.labor, 50);
  near(owner.totalCost, 8 + 3.6 + 50);
  near(owner.profit, 120 - 61.6);
  assert.ok(calculateServiceProfitability({ price: 120, durationMinutes: 60, laborHourly: -1 }).errors.laborHourly);
});

test('labor in cost per service: solo monthly pay ÷ hours × duration; owner wage × duration + commission of the price', () => {
  const items = [{ category: 'product', quantity: 1, unitCost: 8 }, { category: 'supply', quantity: 2, unitCost: 1.5 }];
  const solo = calculateServiceCost({ items, ...FACIAL, monthlyPay: 3200 });
  near(solo.payPerHour, 20);
  near(solo.labor, 30, '$3,200 ÷ 160 hours × 1.5 hours');
  near(solo.trueCost, 11 + 18.75 + 30, 'product + supply + rent + labor');
  const owner = calculateServiceCost({ items, ...FACIAL, providerWage: 20, commissionRate: 0.4, price: 120 });
  near(owner.laborTime, 30);
  near(owner.commission, 48);
  near(owner.labor, 78);
  near(owner.trueCost, 11 + 18.75 + 78);
  assert.equal(owner.commissionNeedsPrice, false);
  const noPrice = calculateServiceCost({ items, ...FACIAL, providerWage: 20, commissionRate: 0.4 });
  assert.equal(noPrice.commissionNeedsPrice, true, 'commission without a price is noted, not guessed');
  near(noPrice.commission, 0);
  near(noPrice.trueCost, 11 + 18.75 + 30);
  assert.ok(calculateServiceCost({ items, monthlyPay: 3200 }).errors.durationMinutes, 'labor is shared by time, so it needs the duration');
  assert.ok(calculateServiceCost({ items, ...FACIAL, commissionRate: 1, price: 100 }).errors.commissionRate);
  near(calculateServiceCost({ items }).labor, 0, 'no labor entered, none added');
});

// ---------- employee hourly: current wage vs the wage the goal needs ----------
test('employee hourly current wage: below the goal shows the raise per hour and the take-home gap', () => {
  const r = calculateEmployeeEarnings({ ...EMP, payType: 'hourly', currentHourlyWage: 25 });
  near(r.requiredWage, 31.25);
  assert.equal(r.current.meetsGoal, false);
  near(r.current.takeHome, 25 * 1920 * 0.75);
  near(r.current.takeHomeShort, 45000 - 36000);
  near(r.current.raisePerHour, 6.25);
  near(r.current.surplusPerHour, 0);
  near(r.current.takeHomeSurplus, 0);
  // tips count toward current take-home as well
  const tips = calculateEmployeeEarnings({ ...EMP, payType: 'hourly', currentHourlyWage: 25, monthlyTips: 500 });
  near(tips.current.takeHome, (25 * 1920 + 6000) * 0.75);
  near(tips.current.raisePerHour, 54000 / 1920 - 25);
});

test('employee hourly current wage: meeting the goal shows the surplus, never a negative raise', () => {
  const r = calculateEmployeeEarnings({ ...EMP, payType: 'hourly', currentHourlyWage: 35 });
  assert.equal(r.current.meetsGoal, true);
  near(r.current.raisePerHour, 0);
  near(r.current.takeHomeShort, 0);
  near(r.current.surplusPerHour, 3.75);
  near(r.current.takeHome, 35 * 1920 * 0.75);
  near(r.current.takeHomeSurplus, 50400 - 45000);
  assert.equal(calculateEmployeeEarnings({ ...EMP, payType: 'hourly', currentHourlyWage: 31.25 }).current.meetsGoal, true, 'exactly the wage needed meets it');
  for (let w = 0.5; w < 80; w += 1.75) {
    const c = calculateEmployeeEarnings({ ...EMP, payType: 'hourly', currentHourlyWage: w, monthlyTips: 300 }).current;
    for (const k of ['raisePerHour', 'takeHomeShort', 'surplusPerHour', 'takeHomeSurplus']) assert.ok(c[k] >= 0, `${k} at $${w}`);
  }
});

test('employee hourly current wage: blank shows only the required wage; negative is an error; ignored for commission', () => {
  const r = calculateEmployeeEarnings({ ...EMP, payType: 'hourly' });
  assert.equal(r.current, null);
  near(r.requiredWage, 31.25);
  assert.equal(calculateEmployeeEarnings({ ...EMP, payType: 'hourly', currentHourlyWage: 0 }).current, null, 'a blank field reads as 0');
  assert.ok(calculateEmployeeEarnings({ ...EMP, payType: 'hourly', currentHourlyWage: -1 }).errors.currentHourlyWage);
  assert.equal(calculateEmployeeEarnings({ ...EMP, payType: 'commission', commissionRate: 0.4, currentHourlyWage: -1 }).ok, true);
});

// ======================= Sprint 2 =======================
// ---------- shared cost parts (price increase, discount) ----------
test('service cost parts: rent share by service time + labor are fixed per service; commission and processing follow the price', () => {
  const parts = serviceCostParts({ durationMinutes: 90, productCost: 12, monthlyRent: 2000, hoursPerMonth: 160, laborHourly: 20, commissionRate: 0.4, processingRate: 0.03 });
  near(parts.rentShare, 18.75, '$2,000 ÷ 160 × 1.5');
  near(parts.laborTime, 30);
  near(parts.fixedPerService, 12 + 18.75 + 30);
  const at = profitAt(parts, 120);
  near(at.commission, 48); near(at.processing, 3.6); near(at.labor, 78);
  near(at.profit, 120 - 60.75 - 51.6);
  assert.equal(serviceCostParts({ durationMinutes: 0 }).errors.durationMinutes, 'Enter a service duration greater than 0 minutes.');
  assert.match(serviceCostParts({ durationMinutes: 60, commissionRate: 0.97, processingRate: 0.03 }).errors.commissionRate, /below 100%/);
});

// ---------- profit & take-home (spec §10, §28 profit) ----------
const BIZ = { serviceRevenue: 12000, retailRevenue: 0, productCosts: 1000, monthlyRent: 2000, fixedExpenses: 500, variableExpenses: 500, monthlyPay: 5000, taxRate: 0.25 };

test('profit: profitable business — profit after your pay, taxes on pay + profit, take-home = pay + profit − taxes', () => {
  const r = calculateBusinessProfit(BIZ);
  assert.equal(r.ok, true);
  near(r.totalRevenue, 12000);
  near(r.operatingCosts, 4000, 'products + rent + other fixed + variable');
  near(r.businessExpenses, 9000, 'your pay is a business expense');
  near(r.businessProfit, 3000);
  near(r.ownerEarnings, 8000);
  near(r.estimatedTaxes, 2000);
  near(r.takeHome, 6000);
  near(r.takeHome, r.ownerComp + r.businessProfit - r.estimatedTaxes, 'the model, exactly');
  assert.equal(r.status, 'profit');
});

test('profit: break-even business — profit $0 after paying you; owner pay is never double-counted', () => {
  const r = calculateBusinessProfit({ ...BIZ, monthlyPay: 8000 });
  near(r.businessProfit, 0);
  assert.equal(r.status, 'even');
  near(r.takeHome, 6000, 'same take-home as paying yourself $5,000: pay and profit are one pot, counted once');
  for (const pay of [0, 2500, 5000, 8000, 9000]) near(calculateBusinessProfit({ ...BIZ, monthlyPay: pay }).takeHome, 6000, `pay ${pay}`);
  // a double count would add pay to take-home on top of (revenue − all expenses incl. pay) — it doesn't
  near(r.takeHome, (12000 - 4000) * 0.75);
});

test('profit: loss-making business — loss labelled, no tax on a loss, take-home is a shortfall', () => {
  const r = calculateBusinessProfit({ ...BIZ, serviceRevenue: 3000 });
  near(r.businessProfit, -6000);
  assert.equal(r.status, 'loss');
  near(r.ownerEarnings, -1000);
  near(r.estimatedTaxes, 0, 'nothing to tax');
  near(r.takeHome, -1000);
  assert.equal(r.earningsShortfall, true);
  assert.deepEqual(describeProfit(r.businessProfit), { word: 'Loss', amount: 6000, loss: true, even: false });
  const partial = calculateBusinessProfit({ ...BIZ, monthlyPay: 9000 });
  near(partial.businessProfit, -1000, 'paying yourself more than the business earns is a business loss');
  near(partial.takeHome, 6000, 'but your take-home is still what the business really earned, after tax');
});

test('profit: rent and owner labor (payroll + commission + owner pay) are expenses; solo pay is its own field', () => {
  const owner = calculateBusinessProfit({ ...BIZ, monthlyPay: 0, monthlyPayroll: 3000, commissionRate: 0.1, ownerPay: 4000 });
  near(owner.commission, 1200, '10% of service revenue');
  near(owner.labor, 4200);
  near(owner.operatingCosts, 4000 + 3000 + 1200);
  near(owner.businessProfit, 12000 - 8200 - 4000);
  near(owner.takeHome, (12000 - 8200) * 0.75);
  const noRent = calculateBusinessProfit({ ...BIZ, monthlyRent: 0 });
  near(noRent.businessProfit - calculateBusinessProfit(BIZ).businessProfit, 2000, 'rent comes straight off profit');
  const retail = calculateBusinessProfit({ ...BIZ, retailRevenue: 800 });
  near(retail.totalRevenue, 12800);
  assert.equal(calculateBusinessProfit({ ...BIZ, serviceRevenue: 0 }).errors.serviceRevenue, 'Enter your monthly service revenue.');
  assert.match(calculateBusinessProfit({ ...BIZ, taxRate: 1 }).errors.taxRate, /below 100%/);
  assert.match(calculateBusinessProfit({ ...BIZ, commissionRate: 1 }).errors.commissionRate, /below 100%/);
  assert.match(calculateBusinessProfit({ ...BIZ, monthlyRent: -1 }).errors.monthlyRent, /\$0 or more/);
});

test('employee take-home: hourly, commission and hourly + commission, each with tips, bonuses and tax', () => {
  const hourly = calculateEmployeeTakeHome({ payType: 'hourly', hourlyWage: 20, hoursWorked: 160, tips: 400, bonuses: 100, taxRate: 0.2,
    serviceRevenue: 9000, commissionRate: 0.4 });
  near(hourly.hourlyEarnings, 3200); near(hourly.commissionEarnings, 0, 'commission ignored for hourly pay');
  near(hourly.gross, 3700); near(hourly.estimatedTaxes, 740); near(hourly.takeHome, 2960);
  near(hourly.effectiveHourly, 3700 / 160); near(hourly.takeHomePerHour, 2960 / 160);
  const comm = calculateEmployeeTakeHome({ payType: 'commission', serviceRevenue: 9000, commissionRate: 0.4, tips: 400, taxRate: 0.25, hourlyWage: 30, hoursWorked: 0 });
  near(comm.commissionEarnings, 3600); near(comm.hourlyEarnings, 0, 'wage ignored on commission'); near(comm.gross, 4000); near(comm.takeHome, 3000);
  assert.equal(comm.hasHours, false); near(comm.effectiveHourly, 0, 'no hours, no per-hour figure (never Infinity)');
  const mixed = calculateEmployeeTakeHome({ payType: 'mixed', serviceRevenue: 8000, commissionRate: 0.1, hourlyWage: 15, hoursWorked: 160, tips: 500, taxRate: 0.2 });
  near(mixed.gross, 800 + 2400 + 500); near(mixed.takeHome, 3700 * 0.8);
  for (const r of [hourly, comm, mixed]) assert.equal(hasBadNumber(r), false);
});

test('employee take-home: each pay type requires its own fields; 0%/100% commission and 100% tax are rejected', () => {
  assert.equal(calculateEmployeeTakeHome({ payType: 'hourly', hourlyWage: 20, hoursWorked: 0 }).errors.hoursWorked, 'Enter the hours you work per month.');
  assert.equal(calculateEmployeeTakeHome({ payType: 'hourly', hourlyWage: 0, hoursWorked: 100 }).errors.hourlyWage, 'Enter an hourly wage greater than $0.');
  assert.match(calculateEmployeeTakeHome({ payType: 'commission', serviceRevenue: 5000, commissionRate: 0 }).errors.commissionRate, /above 0% and below 100%/);
  assert.match(calculateEmployeeTakeHome({ payType: 'commission', serviceRevenue: 5000, commissionRate: 1 }).errors.commissionRate, /above 0% and below 100%/);
  assert.equal(calculateEmployeeTakeHome({ payType: 'commission', serviceRevenue: 0, commissionRate: 0.4 }).errors.serviceRevenue, 'Enter the monthly service revenue you generate.');
  const mixed = calculateEmployeeTakeHome({ payType: 'mixed', serviceRevenue: 0, commissionRate: 0, hourlyWage: 0, hoursWorked: 0 });
  assert.deepEqual(Object.keys(mixed.errors).sort(), ['commissionRate', 'hourlyWage', 'hoursWorked', 'serviceRevenue']);
  assert.match(calculateEmployeeTakeHome({ payType: 'hourly', hourlyWage: 20, hoursWorked: 100, taxRate: 1 }).errors.taxRate, /below 100%/);
  assert.match(calculateEmployeeTakeHome({ payType: 'salary' }).errors.payType, /hourly, commission, or hourly \+ commission/);
});

// ---------- discount & promotion (spec §11, §28 discount) ----------
const DISC = { regularPrice: 150, durationMinutes: 60, productCost: 15, monthlyRent: 2000, hoursPerMonth: 160, laborHourly: 40, processingRate: 0.03, targetMargin: 0.3 };

test('discount: 0% discount changes nothing', () => {
  const r = calculateDiscount({ ...DISC, discountRate: 0 });
  assert.equal(r.status, 'none');
  near(r.salePrice, 150); near(r.profitLost, 0); near(r.reductionRate, 0);
  near(r.before.profit, 150 * 0.97 - (15 + 12.5 + 40), 'rent share $12.50 and labor $40 are in the cost');
  near(r.before.profit, 78);
});

test('discount: normal discount — sale price, profit before/after, profit lost and reduction %', () => {
  const r = calculateDiscount({ ...DISC, discountRate: 0.2 });
  near(r.salePrice, 120);
  near(r.after.profit, 120 * 0.97 - 67.5);
  near(r.profitLost, 78 - 48.9);
  near(r.reductionRate, 29.1 / 78);
  assert.equal(r.status, 'target', '48.9 ÷ 120 = 41% margin keeps the 30% target');
  assert.equal(calculateDiscount({ ...DISC, discountRate: 0.4 }).status, 'below-target', 'still profitable, under 30%');
});

test('discount: break-even discount leaves exactly $0 profit with labor paid; target discount keeps exactly the margin', () => {
  const r = calculateDiscount({ ...DISC, discountRate: 0.2 });
  near(r.breakEvenSalePrice, 67.5 / 0.97);
  near(r.breakEvenDiscount, 1 - 67.5 / 0.97 / 150);
  const at = calculateDiscount({ ...DISC, discountRate: r.breakEvenDiscount });
  near(at.after.profit, 0, 'profit is $0 at the break-even discount');
  assert.equal(at.status, 'even');
  near(r.targetSalePrice, 67.5 / (0.97 - 0.3));
  const t = calculateDiscount({ ...DISC, discountRate: r.targetDiscount });
  near(t.after.margin, 0.3, 'margin is exactly the target at the maximum target-profit discount');
  assert.equal(t.status, 'target');
  assert.ok(r.targetDiscount < r.breakEvenDiscount);
});

test('discount: excessive discount is a labelled loss; 100% or more is rejected; target margin floor is 30%', () => {
  const r = calculateDiscount({ ...DISC, discountRate: 0.6 });
  assert.equal(r.status, 'loss');
  near(r.after.profit, 60 * 0.97 - 67.5);
  assert.equal(describeProfit(r.after.profit).word, 'Loss');
  assert.equal(calculateDiscount({ ...DISC, discountRate: 1 }).errors.discountRate, 'Enter a discount below 100%.');
  assert.equal(calculateDiscount({ ...DISC, discountRate: 1.5 }).errors.discountRate, 'Enter a discount below 100%.');
  assert.equal(calculateDiscount({ ...DISC, discountRate: 0.1, targetMargin: 0.29 }).errors.targetMargin, 'Enter a profit margin of at least 30%.');
  assert.equal(calculateDiscount({ ...DISC, discountRate: 0.1, targetMargin: 0.3 }).ok, true);
  assert.match(calculateDiscount({ ...DISC, processingRate: 1 }).errors.processingRate, /below 100%/);
  const unprofitable = calculateDiscount({ ...DISC, regularPrice: 60, discountRate: 0.1 });
  assert.equal(unprofitable.regularProfitable, false);
  near(unprofitable.breakEvenDiscount, 0, 'no discount is safe when full price already loses');
  near(unprofitable.targetDiscount, 0);
});

test('discount: owner labor — wage by time plus commission on the SALE price; promotion scenario', () => {
  const owner = calculateDiscount({ ...DISC, laborHourly: 20, commissionRate: 0.4, discountRate: 0.2, promoAppointments: 25 });
  near(owner.after.commission, 48, '40% of $120, not of $150');
  near(owner.after.labor, 20 + 48);
  near(owner.after.profit, 120 - (15 + 12.5 + 20) - 48 - 3.6);
  const r = calculateDiscount({ ...DISC, discountRate: 0.2, promoAppointments: 25 });
  near(r.promo.revenueWithout, 3750); near(r.promo.revenueWith, 3000);
  near(r.promo.profitWithout, 78 * 25); near(r.promo.profitWith, 48.9 * 25);
  near(r.promo.profitDifference, -29.1 * 25);
  assert.equal(r.promo.appointmentsToRecover, Math.ceil(29.1 * 25 / 78));
  assert.equal(calculateDiscount({ ...DISC, discountRate: 0.2 }).promo, null, 'no appointments, no scenario');
  const noRent = calculateDiscount({ ...DISC, discountRate: 0.2, monthlyRent: 0 });
  near(noRent.after.profit - r.after.profit, 12.5, 'rent share is in the cost');
});

// ---------- capacity & clients (spec §16, §28 capacity) ----------
test('capacity: normal target — clients a month, week, day and working hours (60 or 90 minutes)', () => {
  const r = calculateCapacity({ revenueGoal: 8000, averageTicket: 100, workingDaysPerMonth: 20, serviceMinutes: 60 });
  near(r.clients, 80); assert.equal(r.clientsWhole, 80);
  near(r.clientsPerWeek, 80 / (52 / 12)); near(r.clientsPerDay, 4);
  near(r.hoursPerMonth, 80); near(r.hoursPerDay, 4);
  near(calculateCapacity({ revenueGoal: 8000, averageTicket: 100, serviceMinutes: 90 }).hoursPerMonth, 120);
  const odd = calculateCapacity({ revenueGoal: 8000, averageTicket: 150 });
  assert.equal(odd.clientsWhole, 54, '53.3 clients round up: you can’t book part of one');
});

test('capacity: zero (or negative, or blank) average ticket is a named error, never a division by zero', () => {
  for (const t of [0, -50, NaN]) {
    const r = calculateCapacity({ revenueGoal: 8000, averageTicket: t });
    assert.equal(r.ok, false);
    assert.equal(r.errors.averageTicket, 'Enter an average service price greater than $0.');
  }
  assert.match(calculateCapacity({ revenueGoal: 0, averageTicket: 100 }).errors.revenueGoal, /greater than \$0/);
  assert.match(calculateCapacity({ revenueGoal: 8000, averageTicket: 100, workingDaysPerMonth: 32 }).errors.workingDaysPerMonth, /between 1 and 31/);
});

test('capacity: high ticket — fewer than one client still books one; nothing is capped', () => {
  const r = calculateCapacity({ revenueGoal: 8000, averageTicket: 20000 });
  near(r.clients, 0.4); assert.equal(r.clientsWhole, 1); near(r.hoursPerMonth, 1);
  const huge = calculateCapacity({ revenueGoal: 9_000_000, averageTicket: 3 });
  assert.equal(huge.clientsWhole, 3_000_000);
  assert.equal(hasBadNumber(huge), false);
});

test('capacity: the scenario table is computed around your ticket, not hard-coded', () => {
  assert.deepEqual(scenarioTickets(100), [60, 80, 100, 120, 140]);
  assert.deepEqual(scenarioTickets(150), [90, 120, 150, 180, 210]);
  assert.deepEqual(scenarioTickets(12), [8, 10, 12, 14, 16], "steps under $5 round to $1");
  assert.deepEqual(scenarioTickets(0), []);
  const r = calculateCapacity({ revenueGoal: 8000, averageTicket: 100, serviceMinutes: 90 });
  assert.deepEqual(r.scenarios.map((s) => [s.ticket, s.clientsWhole, s.yours]), [[60, 134, false], [80, 100, false], [100, 80, true], [120, 67, false], [140, 58, false]]);
  near(r.scenarios[2].hours, 120);
  const other = calculateCapacity({ revenueGoal: 8000, averageTicket: 175 });
  assert.notDeepEqual(other.scenarios.map((s) => s.ticket), r.scenarios.map((s) => s.ticket), 'a different ticket gives a different table');
  for (const s of other.scenarios) assert.equal(s.clientsWhole, Math.ceil(8000 / s.ticket - 1e-9));
});

test('capacity: current clients and ticket measure the gap (or say the goal is met)', () => {
  const r = calculateCapacity({ revenueGoal: 8000, averageTicket: 100, currentClients: 55, currentTicket: 105 });
  near(r.current.revenue, 5775); near(r.current.revenueGap, 2225);
  assert.equal(r.current.neededAtTicket, 77); assert.equal(r.current.moreClients, 22); assert.equal(r.current.goalMet, false);
  const blankTicket = calculateCapacity({ revenueGoal: 8000, averageTicket: 100, currentClients: 90 });
  near(blankTicket.current.ticket, 100, 'blank current ticket uses the average service price');
  assert.equal(blankTicket.current.goalMet, true); assert.equal(blankTicket.current.moreClients, 0);
  assert.equal(calculateCapacity({ revenueGoal: 8000, averageTicket: 100 }).current, null);
});

// ---------- price increase (spec §18, §28 price increase) ----------
const PI = { currentPrice: 100, newPrice: 115, monthlyAppointments: 60, durationMinutes: 60, productCost: 10, monthlyRent: 1600, hoursPerMonth: 160, laborHourly: 30 };

test('price increase: no increase — nothing changes and no clients can be lost', () => {
  const r = calculatePriceIncrease({ ...PI, newPrice: 100 });
  assert.equal(r.status, 'none');
  near(r.revenueIncrease, 0); near(r.annualRevenueIncrease, 0); near(r.profitIncrease, 0);
  near(r.clientsYouCanLose, 0); assert.equal(r.clientsYouCanLoseWhole, 0);
});

test('price increase: revenue and profit, with rent share and labor in the service cost', () => {
  const r = calculatePriceIncrease(PI);
  assert.equal(r.status, 'increase');
  near(r.rentShare, 10, '$1,600 ÷ 160 hours × 1 hour');
  near(r.current.totalCost, 10 + 10 + 30);
  near(r.current.revenue, 6000); near(r.next.revenue, 6900);
  near(r.revenueIncrease, 900); near(r.annualRevenueIncrease, 10800);
  near(r.current.monthlyProfit, 50 * 60); near(r.next.monthlyProfit, 65 * 60);
  near(r.breakEvenClients, 6000 / 115);
  near(r.clientsYouCanLose, 60 - 6000 / 115); assert.equal(r.clientsYouCanLoseWhole, 7);
  const noRent = calculatePriceIncrease({ ...PI, monthlyRent: 0 });
  near(noRent.current.monthlyProfit - r.current.monthlyProfit, 600, 'rent is part of each appointment’s cost');
  const owner = calculatePriceIncrease({ ...PI, laborHourly: 20, commissionRate: 0.4 });
  near(owner.current.commission, 40); near(owner.next.commission, 46, 'commission rises with the new price');
  near(owner.next.profit, 115 - (10 + 10 + 20) - 46);
});

test('price increase: large increase — half the clients can leave when the price doubles', () => {
  const r = calculatePriceIncrease({ ...PI, newPrice: 200 });
  near(r.breakEvenClients, 30); assert.equal(r.clientsYouCanLoseWhole, 30); near(r.lossRateYouCanAbsorb, 0.5);
  near(r.changeRate, 1);
});

test('price increase: client-loss break-even — losing exactly that many clients keeps revenue where it is', () => {
  const r = calculatePriceIncrease(PI);
  const lose = calculatePriceIncrease({ ...PI, expectedLossRate: r.clientsYouCanLose / PI.monthlyAppointments });
  near(lose.next.revenue, r.current.revenue, 'same service revenue');
  near(lose.revenueIncrease, 0);
  const whole = calculatePriceIncrease({ ...PI, expectedLossRate: r.clientsYouCanLoseWhole / PI.monthlyAppointments });
  assert.ok(whole.next.revenue >= r.current.revenue, 'rounded down, revenue never falls');
  const spec = calculatePriceIncrease({ ...PI, newPrice: 110, monthlyAppointments: 66 });
  assert.equal(spec.clientsYouCanLoseWhole, 6, 'spec example: approximately 6 clients');
});

test('price increase: a price cut needs more clients; bad inputs are named errors', () => {
  const r = calculatePriceIncrease({ ...PI, newPrice: 80 });
  assert.equal(r.status, 'decrease'); assert.equal(r.clientsYouCanLoseWhole, 0); assert.equal(r.clientsToGainWhole, 15);
  assert.match(calculatePriceIncrease({ ...PI, newPrice: 0 }).errors.newPrice, /greater than \$0/);
  assert.match(calculatePriceIncrease({ ...PI, monthlyAppointments: 0 }).errors.monthlyAppointments, /greater than 0/);
  assert.match(calculatePriceIncrease({ ...PI, expectedLossRate: 1 }).errors.expectedLossRate, /below 100%/);
  assert.match(calculatePriceIncrease({ ...PI, durationMinutes: 0 }).errors.durationMinutes, /greater than 0 minutes/);
});

// ---------- service menu profitability (spec §17) ----------
const MENU = [
  { name: 'Facial', price: 120, durationMinutes: 60, productCost: 10, supplyCost: 2, laborHourly: 30 },
  { name: 'Peel', price: 170, durationMinutes: 90, productCost: 20, supplyCost: 5, laborHourly: 30 },
  { name: 'Lash fill', price: 70, durationMinutes: 60, productCost: 8, supplyCost: 2, laborHourly: 30 },
];

test('menu: each service carries rent by its own length and labor; profit, margin and per-hour figures', () => {
  const r = calculateMenuProfitability({ services: MENU, monthlyRent: 1600, hoursPerMonth: 160 });
  assert.equal(r.ok, true);
  const [facial, peel, lash] = r.services;
  near(facial.rentShare, 10); near(peel.rentShare, 15, 'a 90-minute service carries 1.5× the rent');
  near(facial.labor, 30); near(peel.labor, 45);
  near(facial.profit, 120 - 12 - 10 - 30); near(peel.profit, 170 - 25 - 15 - 45); near(lash.profit, 70 - 10 - 10 - 30);
  near(peel.profitPerHour, 85 / 1.5); near(facial.margin, 68 / 120); near(peel.revenuePerHour, 170 / 1.5);
});

test('menu: rankings — most profit per appointment, per hour, highest margin, lowest performer', () => {
  const r = calculateMenuProfitability({ services: MENU, monthlyRent: 1600, hoursPerMonth: 160 });
  assert.equal(r.rankings.profit.index, 1, 'Peel: $85');
  assert.equal(r.rankings.profitPerHour.index, 0, 'Facial: $68/hour beats Peel’s $56.67');
  assert.equal(r.rankings.margin.index, 0);
  assert.equal(r.rankings.lowest.index, 2, 'Lash fill: $20/hour');
  assert.deepEqual(r.order, [0, 1, 2]);
  assert.equal(r.similar, false);
  assert.deepEqual(r.lossIndexes, []);
  const loss = calculateMenuProfitability({ services: [MENU[0], { ...MENU[2], price: 40 }], monthlyRent: 1600, hoursPerMonth: 160 });
  assert.deepEqual(loss.lossIndexes, [1]);
  assert.equal(loss.rankings.lowest.index, 1);
});

test('menu: ties and near-ties are reported; a single service has no rankings', () => {
  const tie = calculateMenuProfitability({ services: [MENU[0], { ...MENU[0], name: 'Facial B' }, MENU[2]], monthlyRent: 1600, hoursPerMonth: 160 });
  assert.equal(tie.rankings.profitPerHour.index, 0);
  assert.deepEqual(tie.rankings.profitPerHour.tiedWith, [1]);
  const close = calculateMenuProfitability({ services: [{ ...MENU[0], price: 100 }, { ...MENU[0], price: 102 }, { ...MENU[0], price: 104 }], monthlyRent: 1600, hoursPerMonth: 160 });
  assert.equal(close.similar, true, '$48, $50, $52 an hour: within 10%');
  const one = calculateMenuProfitability({ services: [MENU[0]], monthlyRent: 0, hoursPerMonth: 160 });
  assert.equal(one.comparing, false); assert.equal(one.rankings, null);
});

test('menu: owner labor per row (wage × time + commission × price); errors are keyed to the row', () => {
  const r = calculateMenuProfitability({ services: [{ ...MENU[0], laborHourly: 20, commissionRate: 0.4 }], monthlyRent: 0, hoursPerMonth: 160, processingRate: 0.03 });
  near(r.services[0].labor, 20 + 48);
  near(r.services[0].profit, 120 - 12 - 68 - 3.6);
  const bad = calculateMenuProfitability({ services: [MENU[0], { ...MENU[1], price: 0, durationMinutes: 0 }, { ...MENU[2], commissionRate: 1 }], hoursPerMonth: 160 });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['commissionRate-2', 'durationMinutes-1', 'price-1']);
  assert.equal(calculateMenuProfitability({ services: [], hoursPerMonth: 160 }).errors._, 'Add at least one service with a price and duration.');
  assert.match(calculateMenuProfitability({ services: MENU, hoursPerMonth: 0 }).errors.hoursPerMonth, /more than 0/);
});

test('no NaN, Infinity or undefined in any Sprint 2 result, including edge inputs', () => {
  const results = [
    calculateBusinessProfit(BIZ), calculateBusinessProfit({ ...BIZ, serviceRevenue: 1, productCosts: 0, monthlyRent: 0, fixedExpenses: 0, variableExpenses: 0, monthlyPay: 0 }),
    calculateEmployeeTakeHome({ payType: 'commission', serviceRevenue: 1, commissionRate: 0.01 }),
    calculateDiscount({ ...DISC, discountRate: 0.999 }), calculateDiscount({ regularPrice: 50, durationMinutes: 60, discountRate: 0.5 }),
    calculateCapacity({ revenueGoal: 1, averageTicket: 1e7 }), calculatePriceIncrease({ ...PI, newPrice: 1e7 }),
    calculateMenuProfitability({ services: MENU, monthlyRent: 0, hoursPerMonth: 744 }),
  ];
  for (const r of results) { assert.equal(r.ok, true); assert.equal(hasBadNumber(r), false, JSON.stringify(r).slice(0, 120)); }
});

// ======================= Commission tiers (Capacity & Clients, employees) =======================

const COMM_TIERS = [{ from: 0, rate: 0.4 }, { from: 2000, rate: 0.45 }, { from: 3000, rate: 0.5 }];
const TIERED = { model: 'sales', tiers: COMM_TIERS, tierPeriod: 'week', averageTicket: 100, serviceMinutes: 60 };

test('tiers: below, at and above each threshold; the first tier starts at 0', () => {
  assert.deepEqual([0, 1999.99, 2000, 2000.01, 2999, 3000, 1e6].map((x) => rateForTier(COMM_TIERS, x).rate), [0.4, 0.4, 0.45, 0.45, 0.45, 0.5, 0.5]);
  assert.equal(rateForTier(COMM_TIERS, 2000).number, 2);
  assert.equal(rateForTier([{ from: 0, rate: 0.3 }], 5000).rate, 0.3, 'a single tier is a flat rate');
});

test('tiers pay their rate on ALL sales in the period, not marginally', () => {
  const p = payAt(TIERED, 20); // $2,000 a week reaches tier 2
  near(p.commission, 2000 * 0.45, 'all $2,000 at 45%, not $0 at 45% above the threshold');
  near(payAt(TIERED, 19).commission, 1900 * 0.4);
  near(payAt(TIERED, 30).commission, 3000 * 0.5);
  assert.ok(payAt(TIERED, 20).total - payAt(TIERED, 19).total > 100, 'crossing a tier is a jump (a cliff)');
});

test('tiers: sales per month vs per week; service tiers count services a week', () => {
  const month = { ...TIERED, tiers: [{ from: 0, rate: 0.4 }, { from: 8000, rate: 0.5 }], tierPeriod: 'month' };
  // 18 clients × $100 = $1,800 a week = $7,800 a month (tier 1); 19 = $8,233 a month (tier 2)
  assert.equal(payAt(month, 18).rate, 0.4);
  assert.equal(payAt(month, 19).rate, 0.5);
  near(payAt(month, 19).periodSales, 1900 * WPM);
  near(payAt(month, 19).commission, 1900 * 0.5, 'pay stays weekly; the month only picks the tier');
  const week = { ...month, tierPeriod: 'week' };
  assert.equal(payAt(week, 19).rate, 0.4, 'the same $8,000 threshold counted per week is not reached by $1,900');
  const services = { ...TIERED, model: 'services', tiers: [{ from: 0, rate: 0.35 }, { from: 25, rate: 0.45 }] };
  assert.equal(payAt(services, 24).rate, 0.35);
  assert.equal(payAt(services, 25).rate, 0.45);
  near(payAt(services, 25).commission, 2500 * 0.45);
});

test('base wage and tips add to commission: wage on every hour worked, tips per client', () => {
  const p = payAt({ ...TIERED, model: 'flat', flatRate: 0.4, baseWage: 15, tipPerClient: 12, serviceMinutes: 90, nonClientHours: 5 }, 10);
  near(p.commission, 400); near(p.clientHours, 15); near(p.hours, 20); near(p.wage, 300); near(p.tips, 120); near(p.total, 820);
  const r = clientsForGoal({ ...TIERED, model: 'flat', flatRate: 0.4, baseWage: 15, tipPerClient: 12, serviceMinutes: 90, nonClientHours: 5, goal: 820, goalPeriod: 'week' });
  assert.equal(r.clientsPerWeek, 10, 'exactly at the goal counts as reaching it');
  near(r.hoursPerWeek, 20); near(r.daysPerWeek, 20 / 8);
});

test('clientsForGoal: whole clients, monthly goal ÷ 4.33, sales and hours needed', () => {
  const r = clientsForGoal({ ...TIERED, goal: 4000, goalPeriod: 'month' });
  near(r.weeklyGoal, 4000 / WPM);
  // tier 1 pays $40 a client; 20 clients reach $2,000 and 45% on all: $900 < $923.08, so 21 × $45 = $945 is the first enough
  assert.equal(r.clientsPerWeek, 21);
  assert.equal(r.tier.number, 2);
  near(r.salesPerWeek, 2100); near(r.clientsPerMonth, 21 * WPM); near(r.hoursPerWeek, 21);
  assert.ok(Number.isInteger(r.clientsPerWeek));
  for (let c = 0; c < r.clientsPerWeek; c++) assert.ok(payAt(TIERED, c).total < r.weeklyGoal, `${c} clients would already be enough`);
});

test('next tier: how many more clients unlock it and what it pays; the cliff where one more client crosses', () => {
  // $50 a client (40% + $10 tip) → 19 clients for $923.08; the 20th reaches $2,000 and 45% on all sales
  const r = clientsForGoal({ ...TIERED, tipPerClient: 10, goal: 4000, goalPeriod: 'month' });
  assert.equal(r.clientsPerWeek, 19);
  assert.equal(r.tier.number, 1);
  assert.equal(r.next.number, 2); assert.equal(r.next.clients, 20); assert.equal(r.next.extraClients, 1);
  near(r.next.payWeekly, 2000 * 0.45 + 200); near(r.next.gainWeekly, 1100 - 950); near(r.next.gainMonthly, 150 * WPM);
  assert.equal(r.next.cliff, true, '$150 for one more client, against $50 a client now');
  // well inside a tier with a flat-ish step up: no cliff flagged when the next tier pays no more per extra client
  const flatish = clientsForGoal({ ...TIERED, tiers: [{ from: 0, rate: 0.4 }, { from: 5000, rate: 0.4 }], goal: 400, goalPeriod: 'week' });
  assert.equal(flatish.next.cliff, false);
  // the top tier has no next tier
  const top = clientsForGoal({ ...TIERED, goal: 2000, goalPeriod: 'week' });
  assert.equal(top.tier.number, 3); assert.equal(top.next, null); assert.equal(top.tier.top, true);
  assert.deepEqual(top.steps.map((s) => s.clients), [0, 20, 30], 'each tier’s fewest clients a week');
});

test('commission edge cases: unreachable goals, invalid tiers, ticket 0 and NaN are errors, never numbers', () => {
  const zero = clientsForGoal({ ...TIERED, model: 'flat', flatRate: 0, goal: 1000 });
  assert.equal(zero.ok, false); assert.match(zero.errors._, /pays \$0/);
  const allZero = clientsForGoal({ ...TIERED, tiers: [{ from: 0, rate: 0 }, { from: 100, rate: 0 }], goal: 1000 });
  assert.match(allZero.errors._, /pays \$0/);
  const tooMuch = clientsForGoal({ ...TIERED, goal: 1e7, goalPeriod: 'week' });
  assert.equal(tooMuch.ok, false); assert.equal(tooMuch.unreachable, true);
  assert.match(tooMuch.errors._, /^Even 168 clients a week/, 'the search stops at the clients that fit in a week');
  assert.ok(clientsForGoal({ ...TIERED, averageTicket: 0, goal: 1000 }).errors.averageTicket);
  for (const bad of [NaN, Infinity, -1, 0]) assert.ok(clientsForGoal({ ...TIERED, goal: bad }).errors.incomeGoal, String(bad));
  assert.ok(clientsForGoal({ ...TIERED, averageTicket: NaN, goal: 1000 }).errors.averageTicket);
  assert.deepEqual(validateTiers([{ from: 0, rate: 0.4 }, { from: 3000, rate: 0.5 }, { from: 2000, rate: 0.6 }]), { 'tierFrom-2': 'Each tier must start above the one before it.' });
  assert.deepEqual(validateTiers([{ from: 0, rate: 0.4 }, { from: 2000, rate: 0.4 }, { from: 2000, rate: 0.5 }]), { 'tierFrom-2': 'Each tier must start above the one before it.' });
  assert.deepEqual(validateTiers([{ from: 500, rate: 0.4 }]), { 'tierFrom-0': 'The first tier starts at 0.' });
  assert.deepEqual(validateTiers([{ from: 0, rate: 1.2 }]), { 'tierRate-0': 'Enter a rate from 0% to 100%.' });
  assert.deepEqual(validateTiers([{ from: 0, rate: NaN }]), { 'tierRate-0': 'Enter a rate from 0% to 100%.' });
  assert.deepEqual(validateTiers([{ from: 0, rate: 0.3 }, { from: 12.5, rate: 0.4 }], 'services'), { 'tierFrom-1': 'Enter a whole number of services.' });
  assert.ok(validateTiers([]).tiers);
  assert.ok(validateTiers(Array.from({ length: MAX_TIERS + 1 }, (_, i) => ({ from: i * 100, rate: 0.4 }))).tiers);
  assert.deepEqual(validateTiers([{ from: 0, rate: 0 }, { from: 1, rate: 1 }]), {}, 'rates 0% and 100% are allowed');
  const r = clientsForGoal({ ...TIERED, goal: 900, goalPeriod: 'week' });
  assert.equal(hasBadNumber(r), false);
});
