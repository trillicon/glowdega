// node --test tests/  — the calculator engine (assets/calc/core): spec §28 Sprint-1 cases, validation, no NaN/Infinity.
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
