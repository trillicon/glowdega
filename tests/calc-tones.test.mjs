// node --test tests/  — the shared margin rule (under 30% is not profitable, 50%+ is strong), the coloured result box
// each calculator chooses (view.tone), its WCAG contrast, and the Hourly Service Pricing Calculator's math.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_PROFIT_MARGIN, STRONG_PROFIT_MARGIN, TONES, marginTone, marginBelowText } from '../assets/calc/core/pricing.js';
import { calculateServiceProfitability, calculateBusinessProfit } from '../assets/calc/core/profit.js';
import { calculateHourlyServicePricing, billedMinutes, BILLING_STEP_MINUTES } from '../assets/calc/core/hourly-pricing.js';
import { insightClass } from '../assets/calc/ui/framework.js';
import { shareText } from '../assets/calc/ui/share.js';
import { config as pricing } from '../assets/calc/calculators/service-pricing.js';
import { config as hourlyPricing } from '../assets/calc/calculators/hourly-service-pricing.js';
import { config as hourly } from '../assets/calc/calculators/hourly-rate.js';
import { config as cost } from '../assets/calc/calculators/service-cost.js';
import { config as profit } from '../assets/calc/calculators/service-profitability.js';
import { config as breakEven } from '../assets/calc/calculators/break-even.js';
import { config as takeHome } from '../assets/calc/calculators/profit-take-home.js';
import { config as menu } from '../assets/calc/calculators/menu-profitability.js';
import { config as capacity } from '../assets/calc/calculators/capacity-clients.js';
import { config as increase } from '../assets/calc/calculators/price-increase.js';
import { config as discount } from '../assets/calc/calculators/discount-promotion.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);
const run = (calc, values, type = 'solo', profession = 'esthetician') => {
  const r = calc.compute({ values, type, profession });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};

// ---------- the rule ----------
test('margin tiers: 29.99% warn, 30% ok, 49.99% ok, 50% strong; losses and junk are warn', () => {
  assert.equal(MIN_PROFIT_MARGIN, 0.30);
  assert.equal(STRONG_PROFIT_MARGIN, 0.50);
  assert.deepEqual(TONES, ['warn', 'ok', 'strong']);
  assert.equal(marginTone(0.2999), 'warn');
  assert.equal(marginTone(0.30), 'ok');
  assert.equal(marginTone(0.4999), 'ok');
  assert.equal(marginTone(0.50), 'strong');
  assert.equal(marginTone(0.9), 'strong');
  assert.equal(marginTone(21 / 70), 'ok', '30% computed in floating point still counts as 30%');
  assert.equal(marginTone(0.5 - 1e-12), 'strong', 'float noise just under 50% is still 50%');
  for (const x of [0, -0.2, NaN, Infinity, undefined]) assert.equal(marginTone(x), 'warn', String(x));
  assert.equal(marginBelowText(20 / 70), '28.6%');
  assert.equal(marginBelowText(0.2996), '29.9%', 'never rounded up to the minimum it is below');
});

test('service profitability: a profit under 30% is "below-minimum", not profitable; 30% and up is', () => {
  const base = { price: 100, durationMinutes: 60 };
  const at = (costs) => calculateServiceProfitability({ ...base, productCost: costs });
  assert.equal(at(70.01).status, 'below-minimum', '29.99%');
  assert.equal(at(70.01).tone, 'warn');
  assert.equal(at(70).status, 'profitable', '30%');
  assert.equal(at(70).tone, 'ok');
  assert.equal(at(50.01).tone, 'ok', '49.99%');
  assert.equal(at(50).tone, 'strong', '50%');
  assert.equal(at(100).status, 'even'); assert.equal(at(100).tone, 'warn');
  assert.equal(at(120).status, 'loss'); assert.equal(at(120).tone, 'warn');
  // the minimum comes before the hourly target: a thin margin that "meets" a low target is still not profitable
  assert.equal(calculateServiceProfitability({ ...base, productCost: 80, targetHourly: 5 }).status, 'below-minimum');
  const short = calculateServiceProfitability({ ...base, productCost: 40, targetHourly: 100 });
  assert.equal(short.status, 'below-target'); assert.equal(short.tone, 'warn', 'a shortfall against the target is orange');
  const met = calculateServiceProfitability({ ...base, productCost: 40, targetHourly: 50 });
  assert.equal(met.status, 'meets-target'); assert.equal(met.tone, 'strong', '60% margin');
});

// ---------- each calculator's tone ----------
const PROFIT = { price: 100, durationMinutes: 60, productCost: 0, supplyCost: 0, monthlyRent: 0, hoursPerMonth: 160, overhead: 0,
  processingRate: 0, targetHourly: 40, providerWage: 20, commissionRate: 0, targetProfitPerHour: 0 };

test('service profitability view: tone and wording at 10%, 29.99%, 30%, 40%, 49.99%, 50% and 55%', () => {
  const view = (productCost, type = 'solo') => run(profit, { ...PROFIT, productCost }, type).view;
  assert.equal(view(50).tone, 'warn', '10%');
  assert.match(view(50).insight, /earns a profit, but its 10% margin is below the 30% minimum.*Service Pricing Calculator/);
  assert.equal(view(30.01).tone, 'warn', '29.99%');
  assert.match(view(30.01).insight, /its 29\.9% margin is below the 30% minimum/, '29.99% never reads as 30%');
  assert.equal(view(30).tone, 'ok', '30%');
  assert.doesNotMatch(view(30).insight, /below the 30% minimum/);
  assert.equal(view(20).tone, 'ok', '40%');
  assert.equal(view(10.01).tone, 'ok', '49.99%');
  assert.equal(view(10).tone, 'strong', '50%');
  assert.equal(view(5).tone, 'strong', '55%');
  assert.match(view(5).insight, /is profitable/);
  assert.equal(view(80).tone, 'warn', 'loss');
  assert.equal(view(60).tone, 'warn', 'break-even');
  assert.equal(view(50.01, 'owner').tone, 'warn', 'owner below the minimum: $20 wage + $50.01 product on $100');
  assert.equal(view(50, 'owner').tone, 'ok', 'owner at 30%');
  assert.doesNotMatch(view(5, 'owner').insight, /Customize/, 'every field is on the form now');
  assert.match(view(50).method.join(' '), /at least 30%/);
});

test('service pricing: underpriced or under 30% is orange; the chosen margin sets the tone with no current price', () => {
  const V = { currentPrice: 0, durationMinutes: 60, productCost: 10, monthlyRent: 0, hoursPerMonth: 160, targetHourly: 40, providerWage: 0,
    commissionRate: 0, monthlyFixed: 0, monthlyVariable: 0, monthlyAppointments: 0, processingRate: 0, profitMargin: 30, nonClientHours: 0 };
  assert.equal(run(pricing, V).view.tone, 'ok', 'recommended at 30%');
  assert.equal(run(pricing, { ...V, profitMargin: 49.99 }).view.tone, 'ok');
  assert.equal(run(pricing, { ...V, profitMargin: 50 }).view.tone, 'strong');
  assert.equal(run(pricing, { ...V, currentPrice: 60 }).view.tone, 'warn', 'underpriced: $10 profit on $60 is 16.7%');
  assert.equal(run(pricing, { ...V, currentPrice: 80 }).view.tone, 'ok', 'within range: 37.5%');
  assert.equal(run(pricing, { ...V, currentPrice: 200 }).view.tone, 'strong', 'above range: 75%');
});

test('hourly service pricing: the margin at the billed price sets the tone (never under 30%)', () => {
  const V = { estimatedMinutes: 300, targetHourly: 40, providerWage: 0, commissionRate: 0, monthlyRent: 0, hoursPerMonth: 160, overhead: 0,
    productFixed: 0, productPerHour: 0, supplyCost: 0, processingRate: 0, profitMargin: 30, unbillableMinutes: 0, minimumMinutes: 0, depositRate: 0 };
  assert.equal(run(hourlyPricing, V).view.tone, 'ok');
  assert.equal(run(hourlyPricing, { ...V, profitMargin: 50 }).view.tone, 'strong');
  assert.equal(hourlyPricing.compute({ values: { ...V, profitMargin: 29.99 }, type: 'solo', profession: 'esthetician' }).ok, false, '29.99% is not accepted');
});

test('no-margin calculators: orange for a loss or shortfall, the default box otherwise', () => {
  const H = { desiredAnnualIncome: 45000, monthlyRent: 0, annualExpenses: 0, monthlyPayroll: 0, taxRate: 25, workingWeeksPerYear: 48,
    workingDaysPerWeek: 5, hoursPerDay: 8, nonClientHoursPerDay: 2, exampleServiceMinutes: 90, payType: 'hourly', monthlyTips: 0,
    currentHourlyWage: 0, commissionRate: 40, baseHourlyWage: 18 };
  assert.equal(run(hourly, H, 'solo').view.tone, 'ok');
  assert.equal(run(hourly, { ...H, currentHourlyWage: 15 }, 'employee').view.tone, 'warn', 'wage short of the goal');
  assert.equal(run(hourly, { ...H, currentHourlyWage: 60 }, 'employee').view.tone, 'ok', 'wage meets the goal');
  const C = { items: [{ category: 'product', quantity: 1, unitCost: 8 }], meta: [{ name: 'Enzyme mask', category: 'product' }],
    durationMinutes: 60, monthlyRent: 0, hoursPerMonth: 160, monthlyPay: 0, providerWage: 0, commissionRate: 0, price: 0 };
  assert.equal(run(cost, C).view.tone, 'ok', 'costs only: no verdict');
  const B = { monthlyRent: 2000, monthlyPay: 3000, monthlyPayroll: 0, ownerPay: 0, fixedCosts: 0, servicePrice: 110, variableCost: 18,
    processingRate: 0, commissionRate: 0, retailRevenue: 0, retailCostRate: 0, workingDaysPerWeek: 5 };
  assert.equal(run(breakEven, B).view.tone, 'ok');
  assert.equal(run(breakEven, { ...B, servicePrice: 10 }).view.tone, 'warn', 'not possible at this price');
  const K = { revenueGoal: 8000, averageTicket: 100, workingDaysPerMonth: 20, serviceMinutes: 60, currentClients: 0, currentTicket: 0,
    nonClientHours: 0, hoursPerDay: 8 };
  assert.equal(run(capacity, K).view.tone, 'ok');
  assert.equal(run(capacity, { ...K, currentClients: 40 }).view.tone, 'warn', 'current clients fall short of the goal');
  assert.equal(run(capacity, { ...K, currentClients: 90 }).view.tone, 'ok', 'goal met');
});

test('profit & take-home: a month under 30% margin is orange and says so; 30% ok, 50% strong', () => {
  const T = { serviceRevenue: 10000, retailRevenue: 0, productCosts: 0, monthlyRent: 0, fixedExpenses: 0, variableExpenses: 0, monthlyPay: 5000,
    monthlyPayroll: 0, commissionRate: 0, ownerPay: 0, taxRate: 25 };
  const at = (monthlyRent) => run(takeHome, { ...T, monthlyRent }).view;
  assert.equal(at(2001).tone, 'warn', '29.99%');
  assert.match(at(2001).insight, /earns a profit of \$2,999 after paying you, but its 29\.9% margin is below the 30% minimum/);
  assert.equal(at(2000).tone, 'ok', '30%');
  assert.equal(at(1).tone, 'ok', '49.99%');
  assert.equal(at(0).tone, 'strong', '50%');
  assert.equal(at(6000).tone, 'warn', 'loss after pay');
  assert.equal(calculateBusinessProfit({ ...T, monthlyRent: 2001, taxRate: 0.25 }).belowMinimum, true);
  assert.equal(run(takeHome, { payType: 'hourly', hourlyWage: 20, hoursWorked: 160, revenueGenerated: 0, payCommissionRate: 0, tips: 0, bonuses: 0, taxRate: 20, hoursOptional: 0 }, 'employee').view.tone, 'ok');
});

test('menu: the weakest service sets the tone; all 50%+ is strong', () => {
  const S = (name, price) => ({ name, price, durationMinutes: 60, productCost: 0, supplyCost: 0, laborHourly: 0, commissionRate: 0 });
  const M = (prices) => ({ monthlyRent: 0, hoursPerMonth: 160, targetHourly: 50, processingRate: 0, services: prices.map((p, i) => S(`S${i}`, p)) });
  assert.equal(run(menu, M([100, 200])).view.tone, 'strong', '50% and 75%');
  assert.equal(run(menu, M([100, 80])).view.tone, 'ok', '37.5% is the weakest');
  const thin = run(menu, M([200, 71])).view;
  assert.equal(thin.tone, 'warn', '$21 on $71 = 29.6%');
  assert.match(thin.insight, /“S1” earns a profit, but its 29\.6% margin is below the 30% minimum/);
  assert.equal(run(menu, M([200, 40])).view.tone, 'warn', 'a loss');
  const one = run(menu, M([60])).view;
  assert.equal(one.tone, 'warn'); assert.match(one.insight, /“S0” earns a profit, but its 16\.7% margin/);
});

test('price increase: a cut is orange; the new price’s margin sets the tone; under 30% says so', () => {
  const P = { currentPrice: 100, newPrice: 115, monthlyAppointments: 60, durationMinutes: 60, productCost: 10, monthlyRent: 0, hoursPerMonth: 160,
    targetHourly: 30, providerWage: 0, commissionRate: 0, processingRate: 0, expectedLoss: 0 };
  assert.equal(run(increase, P).view.tone, 'strong', '$75 on $115 = 65%');
  assert.equal(run(increase, { ...P, newPrice: 80 }).view.tone, 'warn', 'price cut');
  const thin = run(increase, { ...P, currentPrice: 45, newPrice: 55 }).view;
  assert.equal(thin.tone, 'warn', '$15 on $55 = 27%');
  assert.match(thin.insight, /At \$55 it earns a profit, but its 27\.3% margin is below the 30% minimum/);
  assert.equal(run(increase, { ...P, currentPrice: 50, newPrice: 70 }).view.tone, 'ok', '$30 on $70 = 42.9%');
  assert.equal(run(increase, { ...P, newPrice: 200, expectedLoss: 70 }).view.tone, 'warn', 'profit falls: 18 × $160 < 60 × $60');
  assert.equal(run(increase, { ...P, newPrice: 200, expectedLoss: 60 }).view.tone, 'strong', 'profit rises: 24 × $160 > 60 × $60');
});

test('discount: below target or under 30% is orange; keeping the target uses the sale price’s margin', () => {
  const D = { regularPrice: 100, discountRate: 0, promoAppointments: 0, durationMinutes: 60, productCost: 10, monthlyRent: 0, hoursPerMonth: 160,
    targetHourly: 30, providerWage: 0, commissionRate: 0, overhead: 0, processingRate: 0, targetMargin: 30 };
  assert.equal(run(discount, D).view.tone, 'strong', 'no discount: $60 on $100');
  assert.equal(run(discount, { ...D, discountRate: 20 }).view.tone, 'strong', '$40 on $80 = 50%');
  assert.equal(run(discount, { ...D, discountRate: 30 }).view.tone, 'ok', '$30 on $70 = 42.9%, target kept');
  const thin = run(discount, { ...D, discountRate: 45 }).view;
  assert.equal(thin.tone, 'warn', '$15 on $55 = 27.3%');
  assert.match(thin.insight, /still earns a profit, but its 27\.3% margin is below the 30% minimum/);
  const short = run(discount, { ...D, discountRate: 30, targetMargin: 50 }).view;
  assert.equal(short.tone, 'warn', 'below a 50% target: a shortfall');
  assert.match(short.insight, /is still profitable, but .* below your 50% target margin/);
  assert.equal(run(discount, { ...D, discountRate: 60 }).view.tone, 'warn', 'break-even');
  assert.equal(run(discount, { ...D, discountRate: 70 }).view.tone, 'warn', 'loss');
});

test('every calculator sets a tone on every result it shows', () => {
  const sources = ['service-pricing', 'hourly-service-pricing', 'hourly-rate', 'service-cost', 'service-profitability', 'break-even',
    'profit-take-home', 'menu-profitability', 'capacity-clients', 'price-increase', 'discount-promotion'];
  for (const c of sources) {
    assert.match(read(`assets/calc/calculators/${c}.js`), /\btone: /, `${c}: sets view.tone`);
  }
});

// ---------- Hourly Service Pricing math (worked by hand) ----------
const HOURLY = { estimatedMinutes: 300, unbillableMinutes: 30, laborHourly: 40, monthlyRent: 2000, hoursPerMonth: 160, productFixed: 20,
  productPerHour: 4, supplyCost: 6, overhead: 10, processingRate: 0.03, profitMargin: 0.30, depositRate: 0.25 };

test('hourly pricing, worked example (solo): 5 hours + 30 unbillable minutes', () => {
  const r = calculateHourlyServicePricing(HOURLY);
  // worked hours 5.5: pay 40 × 5.5 = 220; rent 2000 ÷ 160 = 12.50/hour × 5.5 = 68.75; product 20 + 4 × 5 = 40
  near(r.workedHours, 5.5); near(r.laborTime, 220); near(r.rentPerHour, 12.5); near(r.rentShare, 68.75);
  near(r.productHourly, 20, 'per-hour product counts service hours only, not setup'); near(r.product, 40);
  near(r.costs, 344.75, '220 + 68.75 + 40 + 6 + 10');
  near(r.priceNeeded, 344.75 / 0.67, '÷ (1 − 3% − 30%) = 514.55');
  near(r.exactRate, 344.75 / 0.67 / 5);
  assert.equal(r.hourlyRate, 103, '102.91 rounded up to the dollar');
  assert.equal(r.billedMinutes, 300); near(r.price, 515, '$103 × 5 hours');
  near(r.deposit, 128.75, '25% of $515'); near(r.balance, 386.25);
  near(r.processing, 15.45); near(r.profit, 154.8, '515 − 344.75 − 15.45');
  near(r.margin, 154.8 / 515); assert.equal(r.tone, 'ok', '30.06%');
});

test('hourly pricing, worked example (owner): wage + 40% commission, grossed up like card fees', () => {
  const r = calculateHourlyServicePricing({ estimatedMinutes: 240, laborHourly: 20, commissionRate: 0.4, profitMargin: 0.3 });
  near(r.costs, 80, '$20 × 4 hours'); near(r.priceNeeded, 80 / 0.3); assert.equal(r.hourlyRate, 67, '66.67 → $67');
  near(r.price, 268); near(r.commission, 107.2); near(r.labor, 187.2); near(r.profit, 80.8); near(r.margin, 80.8 / 268);
  const strong = calculateHourlyServicePricing({ ...HOURLY, profitMargin: 0.5 });
  assert.equal(strong.hourlyRate, 147, '344.75 ÷ 0.47 ÷ 5 = 146.70 → $147'); near(strong.price, 735); assert.equal(strong.tone, 'strong');
});

test('hourly pricing rounding: half-hour steps, the minimum booking, unbillable time and the fixed + per-hour split', () => {
  assert.equal(BILLING_STEP_MINUTES, 30);
  assert.equal(billedMinutes(300), 300, 'already on a half hour');
  assert.equal(billedMinutes(301), 330, 'one minute over bills the next half hour');
  assert.equal(billedMinutes(255), 270);
  assert.equal(billedMinutes(270), 270);
  assert.equal(billedMinutes(90, 180), 180, 'shorter than the minimum: billed at the minimum');
  assert.equal(billedMinutes(90, 200), 210, 'the minimum is rounded up too');
  assert.equal(billedMinutes(250, 180), 270, 'longer than the minimum: the service length, rounded');
  // rounding and minimums bill more time at the same rate, so they only ever add margin
  const flat = { laborHourly: 50, profitMargin: 0.3 };
  const r = calculateHourlyServicePricing({ ...flat, estimatedMinutes: 255 });
  assert.equal(r.hourlyRate, 72, '50 ÷ 0.7 = 71.43 → $72'); near(r.billedHours, 4.5); near(r.price, 324); near(r.extraBilledMinutes, 15);
  assert.ok(r.margin > 0.3);
  const min = calculateHourlyServicePricing({ ...flat, estimatedMinutes: 90, minimumMinutes: 180 });
  assert.equal(min.minimumApplies, true); near(min.billedHours, 3); near(min.price, 216, '$72 × 3 hours');
  // unbillable minutes are paid (labor, rent) but not billed: they raise the rate, never the billed time
  const setup = calculateHourlyServicePricing({ ...flat, estimatedMinutes: 240, unbillableMinutes: 60, monthlyRent: 1600, hoursPerMonth: 160 });
  near(setup.workedHours, 5); near(setup.laborTime, 250); near(setup.rentShare, 50); near(setup.billedHours, 4);
  assert.equal(setup.hourlyRate, Math.ceil(300 / 0.7 / 4 - 0.005), '(250 + 50) ÷ 0.7 ÷ 4 = 107.14 → $108');
  assert.equal(setup.hourlyRate, 108);
  // fixed product is per appointment; per-hour product scales with the service hours
  const a = calculateHourlyServicePricing({ estimatedMinutes: 120 + 60, productFixed: 30, productPerHour: 10, profitMargin: 0.3 });
  near(a.product, 30 + 10 * 3); near(a.productHourly, 30);
  const b = calculateHourlyServicePricing({ estimatedMinutes: 360, productFixed: 30, productPerHour: 10, profitMargin: 0.3 });
  near(b.product, 30 + 10 * 6, 'twice the hours: twice the per-hour product, the same fixed product');
});

test('hourly pricing validation: margin under 30%, 100% deposit, zero length and impossible shares are refused', () => {
  const bad = (x) => calculateHourlyServicePricing({ estimatedMinutes: 240, laborHourly: 40, ...x });
  assert.ok(bad({ profitMargin: 0.2999 }).errors.profitMargin);
  assert.equal(bad({ profitMargin: 0.30 }).ok, true);
  assert.ok(bad({ depositRate: 1 }).errors.depositRate);
  assert.ok(bad({ estimatedMinutes: 0 }).errors.estimatedMinutes);
  assert.ok(bad({ unbillableMinutes: -5 }).errors.unbillableMinutes);
  assert.ok(bad({ hoursPerMonth: 0 }).errors.hoursPerMonth);
  assert.ok(bad({ commissionRate: 0.5, processingRate: 0.03, profitMargin: 0.5 }).errors.commissionRate);
});

test('hourly pricing view: rate, billed price, deposit, cost breakdown and margin; lengths in hours, never as an example', () => {
  const V = { estimatedMinutes: 300, targetHourly: 40, providerWage: 20, commissionRate: 40, monthlyRent: 2000, hoursPerMonth: 160, overhead: 10,
    productFixed: 20, productPerHour: 4, supplyCost: 6, processingRate: 3, profitMargin: 30, unbillableMinutes: 30, minimumMinutes: 0, depositRate: 25 };
  const solo = run(hourlyPricing, V).view;
  assert.equal(solo.primary.value, '$103/hour');
  const card = (l) => solo.cards.find((c) => c.label === l)?.value;
  assert.equal(card('Price for the estimated length'), '$515.00');
  assert.equal(card('Deposit at booking'), '$128.75');
  assert.equal(card('Profit margin'), '30.1%');
  for (const l of ['Billed time', 'Your pay', 'Rent', 'Products', 'Supplies', 'Other overhead', 'Card processing', 'Total cost']) assert.ok(card(l), l);
  assert.doesNotMatch(JSON.stringify(solo), /quote table|calc-table/i, 'no quote table');
  assert.doesNotMatch(JSON.stringify(solo), /\b\d+-minute\b/, 'no example lengths');
  assert.match(solo.insight, /full set of lash extensions/);
  assert.match(run(hourlyPricing, V, 'solo', 'cosmetologist').view.insight, /color correction/);
  assert.doesNotMatch(JSON.stringify(run(hourlyPricing, V, 'solo', 'barber').view), /lash|facial/i);
  const owner = run(hourlyPricing, V, 'owner').view;
  assert.match(owner.cards.find((c) => c.label === 'Labor').note, /commission \(40%\)/);
  assert.deepEqual(hourlyPricing.unsupportedTypes, ['employee']);
});

// ---------- the box: classes, CSS tokens, contrast, print, share ----------
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const round2 = (x) => Math.round(x * 100) / 100;

test('tone classes: warn/ok/strong map to their modifier; anything else is the plain box', () => {
  assert.equal(insightClass('warn'), 'calc-insight calc-insight--warn');
  assert.equal(insightClass('ok'), 'calc-insight calc-insight--ok');
  assert.equal(insightClass('strong'), 'calc-insight calc-insight--strong');
  for (const t of [undefined, '', 'great', 'loss']) assert.equal(insightClass(t), 'calc-insight', String(t));
});

test('brand tokens and WCAG AA contrast for the three tones (recorded ratios)', () => {
  const css = read('assets/style.css');
  const root = css.match(/:root\{--ink:#111;[^}]*\}/)[0];
  const token = (n) => root.match(new RegExp(`--${n}:(#[0-9A-Fa-f]{3,6})`))?.[1];
  assert.equal(token('orange'), '#FF6A13');
  assert.equal(token('green'), '#035144');
  assert.equal(token('on-green'), '#fff');
  assert.equal(token('acid'), '#dfff00');
  assert.match(css, /\.calc-insight--warn\{background:var\(--orange\);color:var\(--ink\)\}/);
  assert.match(css, /\.calc-insight--ok\{background:var\(--acid\);color:var\(--ink\)\}/);
  assert.match(css, /\.calc-insight--strong\{background:var\(--green\);color:var\(--on-green\)\}/);
  assert.match(css, /\.calc-insight--strong a\{color:var\(--on-green\)/, 'links in the green box are light too');
  // the recorded ratios (WCAG 2.x relative luminance); AA for this 21px body text needs 4.5:1
  assert.equal(round2(contrast('#111111', '#FF6A13')), 6.58, 'black on orange');
  assert.equal(round2(contrast('#111111', '#DFFF00')), 16.58, 'black on yellow-green');
  assert.equal(round2(contrast('#FFFFFF', '#035144')), 9.27, 'white on deep green');
  for (const [fg, bg] of [['#111111', '#FF6A13'], ['#111111', '#DFFF00'], ['#FFFFFF', '#035144']]) assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}`);
  // why the pairs are what they are: the other text colour fails AA on each
  assert.ok(contrast('#111111', '#035144') < 4.5, 'black on deep green fails (2.04:1)');
  assert.ok(contrast('#FFFFFF', '#FF6A13') < 4.5, 'white on orange fails (2.87:1)');
});

test('print keeps every tone as black text on white (with a coloured rule), and share cards ignore the tone', () => {
  const css = read('assets/style.css');
  const print = css.slice(css.indexOf('@media print{'));
  assert.match(print, /\.calc-insight,\.calc-insight--warn,\.calc-insight--ok,\.calc-insight--strong\{background:#fff;color:#000\}/);
  assert.match(print, /\.calc-insight--strong a\{color:#000\}/, 'links print dark, not white on white');
  assert.ok(css.indexOf('.calc-insight--strong{background:var(--green)') < css.indexOf('@media print{'), 'the print rule comes later, so it wins');
  const share = read('assets/calc/ui/share.js');
  assert.doesNotMatch(share, /tone|#035144|#FF6A13/i, 'share cards keep their own fixed palette');
  const view = run(profit, { ...PROFIT, productCost: 50 }).view;
  assert.equal(shareText({ name: 'X', url: 'https://x', view }), shareText({ name: 'X', url: 'https://x', view: { ...view, tone: 'strong' } }));
});

// ---------- pages ----------
const input = (html, name) => html.match(new RegExp(`<input id="f-${name}"[^>]*>`))?.[0];

test('service profitability page: every field on the main form and required; no Customize section', () => {
  const html = read('resources/service-profitability/index.html');
  assert.doesNotMatch(html, /calc-advanced|Customize your calculation/);
  for (const n of ['price', 'durationMinutes', 'productCost', 'supplyCost', 'monthlyRent', 'hoursPerMonth', 'overhead', 'processingRate', 'targetProfitPerHour']) {
    assert.match(input(html, n), /data-required aria-required="true"/, `${n} is required`);
  }
  assert.match(input(html, 'hoursPerMonth'), /value="160"/);
  assert.match(input(html, 'processingRate'), /value="2\.9"/);
  assert.match(html, /<div class="calc-field" data-types="owner"><label for="f-targetProfitPerHour">/, 'owners only, shown by business type');
});

test('hourly service pricing page: inputs, 30% floor, Employee note, hub, sitemap and JSON-LD', async () => {
  const html = read('resources/hourly-service-pricing/index.html');
  for (const n of ['estimatedMinutes', 'targetHourly', 'providerWage', 'commissionRate', 'monthlyRent', 'hoursPerMonth', 'overhead', 'productFixed',
    'productPerHour', 'supplyCost', 'processingRate', 'profitMargin', 'unbillableMinutes', 'minimumMinutes', 'depositRate']) assert.ok(input(html, n), n);
  for (const re of [/value="30"/, /data-min="30"/, /data-min-message="Enter a profit margin of at least 30%\."/, /data-required/]) assert.match(input(html, 'profitMargin'), re);
  assert.match(input(html, 'depositRate'), /data-max="100" data-max-exclusive/);
  assert.match(html, /data-for-type="employee" hidden><p>[^<]*<a href="\.\.\/hourly-rate\/\?type=employee">What Is Your Time Worth\?<\/a>/);
  assert.match(html, /<span data-prof="long-service">full set of lash extensions<\/span>/);
  assert.doesNotMatch(html, /calc-advanced|calc-table/, 'no Customize section and no quote table');
  assert.match(html, /"@type": "WebApplication", "name": "Hourly Service Pricing Calculator"/);
  const hub = read('resources/index.html');
  assert.match(hub, /<a class="hub-card" href="hourly-service-pricing\/" data-audiences="solo owner"/);
  assert.match(hub, /"url": "https:\/\/www\.glowdega\.com\/resources\/hourly-service-pricing\/"/);
  const { RESOURCES } = await import('../functions/sitemap.xml.js');
  assert.ok(RESOURCES.includes('/resources/hourly-service-pricing/'));
  assert.notEqual(read('resources/hourly-rate/index.html').match(/<title>([^<]+)/)[1], html.match(/<title>([^<]+)/)[1], 'no clash with What Is Your Time Worth?');
});
