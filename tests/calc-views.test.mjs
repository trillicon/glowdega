// node --test tests/  — each calculator's compute() (assets/calc/calculators/*.js), run outside the browser: labor per
// business type, the employee current-wage comparison, links into pricing that never count labor twice, and that the
// profession changes wording only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config as pricing } from '../assets/calc/calculators/service-pricing.js';
import { config as hourly } from '../assets/calc/calculators/hourly-rate.js';
import { config as cost } from '../assets/calc/calculators/service-cost.js';
import { config as profit } from '../assets/calc/calculators/service-profitability.js';
import { config as breakEven } from '../assets/calc/calculators/break-even.js';
import { PROFESSIONS, serviceText, signatureService } from '../assets/calc/ui/professions.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);
const textOf = (view) => JSON.stringify(view);
const params = (view) => new URL(view.cta.href, 'https://x/resources/a/').searchParams;
const card = (view, label) => view.cards.find((c) => c.label === label);

// Every field each calculator has, for every type at once: compute() must use only the ones for the chosen type.
const V = {
  pricing: { currentPrice: 0, durationMinutes: 90, productCost: 12, monthlyRent: 2000, hoursPerMonth: 160, targetHourly: 45, providerWage: 20,
    commissionRate: 40, monthlyFixed: 0, monthlyVariable: 0, monthlyAppointments: 0, processingRate: 3, profitMargin: 30, nonClientHours: 0 },
  hourly: { desiredAnnualIncome: 45000, monthlyRent: 1000, annualExpenses: 6000, monthlyPayroll: 5000, taxRate: 25, workingWeeksPerYear: 48,
    workingDaysPerWeek: 5, hoursPerDay: 8, nonClientHoursPerDay: 2, exampleServiceMinutes: 90, payType: 'hourly', monthlyTips: 0,
    currentHourlyWage: 0, commissionRate: 40, baseHourlyWage: 18 },
  cost: { items: [{ category: 'product', quantity: 1, unitCost: 8 }, { category: 'supply', quantity: 2, unitCost: 1.5 }],
    meta: [{ name: 'Enzyme mask', category: 'product' }, { name: 'Gloves', category: 'supply' }],
    durationMinutes: 90, monthlyRent: 2000, hoursPerMonth: 160, monthlyPay: 3200, providerWage: 20, commissionRate: 40, price: 120 },
  profit: { price: 120, durationMinutes: 90, productCost: 8, supplyCost: 4, monthlyRent: 2000, hoursPerMonth: 160, overhead: 0, processingRate: 3,
    targetHourly: 40, providerWage: 20, commissionRate: 25, targetProfitPerHour: 30 },
  breakEven: { monthlyRent: 2000, monthlyPay: 3000, monthlyPayroll: 6000, ownerPay: 4000, fixedCosts: 1000, servicePrice: 110, variableCost: 18,
    processingRate: 3, commissionRate: 40, retailRevenue: 0, retailCostRate: 0, workingDaysPerWeek: 5 },
};
const CASES = [
  ['service-pricing', pricing, V.pricing, ['solo', 'owner']],
  ['hourly-rate', hourly, V.hourly, ['solo', 'employee', 'owner']],
  ['service-cost', cost, V.cost, ['solo', 'employee', 'owner']],
  ['service-profitability', profit, V.profit, ['solo', 'owner']],
  ['break-even', breakEven, V.breakEven, ['solo', 'owner']],
];

test('profession changes wording only: every calculator gives identical numbers for all four professions', () => {
  assert.deepEqual(Object.keys(PROFESSIONS), ['esthetician', 'cosmetologist', 'manicurist', 'barber']);
  for (const [name, calc, values, types] of CASES) {
    for (const type of types) {
      const runs = Object.keys(PROFESSIONS).map((profession) => calc.compute({ values, type, profession }));
      for (const r of runs) assert.equal(r.ok, true, `${name} ${type}`);
      for (const r of runs.slice(1)) {
        assert.deepEqual(r.raw, runs[0].raw, `${name} ${type}: engine result`);
        assert.equal(r.view.primary.value, runs[0].view.primary.value, `${name} ${type}: primary`);
        assert.deepEqual(r.view.cards.map((c) => c.value), runs[0].view.cards.map((c) => c.value), `${name} ${type}: card values`);
      }
    }
  }
});

test('profession wording: example services are each profession’s own, and always 60 or 90 minutes', () => {
  for (const [p, { services }] of Object.entries(PROFESSIONS)) {
    for (const m of Object.keys(services)) assert.ok(['60', '90'].includes(m), `${p}: ${m}-minute example`);
  }
  assert.equal(signatureService('esthetician').text, '90-minute peel');
  assert.equal(serviceText('esthetician', 60).phrase, '60-minute facial');
  assert.equal(signatureService('cosmetologist').text, '90-minute color service');
  assert.equal(signatureService('manicurist').text, '60-minute gel manicure');
  assert.equal(signatureService('barber').text, '60-minute cut & beard');
  assert.equal(signatureService('nonsense').text, '90-minute peel', 'unknown profession falls back to esthetician');
  const insight = (profession, exampleServiceMinutes) => hourly.compute({ values: { ...V.hourly, exampleServiceMinutes }, type: 'solo', profession }).view.insight;
  assert.match(insight('esthetician', 90), /^A 90-minute peel should generate/);
  assert.match(insight('cosmetologist', 90), /^A 90-minute color service should generate/);
  assert.match(insight('manicurist', 60), /^A 60-minute gel manicure should generate/);
  assert.match(insight('barber', 60), /^A 60-minute cut & beard should generate/);
  assert.match(insight('barber', 90), /^A 90-minute service should generate/);
  assert.match(pricing.compute({ values: V.pricing, type: 'solo', profession: 'cosmetologist' }).view.share.label, /90-minute color service/);
});

// built from parts so this file passes its own copy scan (tests/calc-pages.test.mjs reads it)
const LONG_EXAMPLE = new RegExp(['\\b(2|two)-hour', `${2 * 60}-minute`].join('|'), 'i');

test('examples stay at 60 or 90 minutes in every calculator result (nothing longer)', () => {
  for (const [name, calc, values, types] of CASES) {
    for (const type of types) for (const profession of Object.keys(PROFESSIONS)) {
      const t = textOf(calc.compute({ values, type, profession }).view);
      assert.doesNotMatch(t, LONG_EXAMPLE, `${name} ${type} ${profession}`);
      for (const m of t.matchAll(/\b(\d+)-minute\b/g)) assert.ok(['60', '90'].includes(m[1]), `${name} ${type} ${profession}: ${m[1]}-minute`);
    }
  }
  const defaultLength = hourly.compute({ values: { ...V.hourly, exampleServiceMinutes: 0 }, type: 'owner', profession: 'esthetician' });
  assert.equal(defaultLength.raw.exampleServiceMinutes, 90, 'blank example length uses the 90-minute default');
});

test('employee hourly: current wage below the goal shows the raise per hour and the take-home gap', () => {
  const r = hourly.compute({ values: { ...V.hourly, currentHourlyWage: 25 }, type: 'employee', profession: 'barber' });
  const v = r.view;
  assert.equal(v.primary.value, '$31.25/hour');
  assert.equal(card(v, 'Your current wage').value, '$25.00/hour');
  assert.equal(card(v, 'Raise needed').value, '$6.25/hour');
  assert.equal(card(v, 'Estimated take-home now').value, '$36,000');
  assert.match(card(v, 'Estimated take-home now').note, /\$9,000 short of your \$45,000 goal/);
  assert.match(v.insight, /\$9,000 short of your goal\. A raise of \$6\.25\/hour/);
  assert.equal(card(v, 'Your wage meets your goal'), undefined);
  assert.doesNotMatch(textOf(v), /[-−]\$/, 'never a negative amount');
});

test('employee hourly: current wage at or above the goal says it meets it, with the surplus', () => {
  const v = hourly.compute({ values: { ...V.hourly, currentHourlyWage: 35 }, type: 'employee', profession: 'esthetician' }).view;
  assert.equal(card(v, 'Your wage meets your goal').value, '$3.75/hour above');
  assert.match(card(v, 'Your wage meets your goal').note, /\$5,400 a year above your goal/);
  assert.match(v.insight, /^Your wage meets your goal\./);
  assert.equal(card(v, 'Raise needed'), undefined);
  assert.doesNotMatch(textOf(v), /[-−]\$/, 'never a negative amount');
});

test('employee hourly: a blank current wage shows only the required wage', () => {
  const v = hourly.compute({ values: { ...V.hourly, currentHourlyWage: 0 }, type: 'employee', profession: 'esthetician' }).view;
  assert.equal(v.primary.value, '$31.25/hour');
  for (const l of ['Your current wage', 'Raise needed', 'Your wage meets your goal', 'Estimated take-home now']) assert.equal(card(v, l), undefined, l);
  assert.ok(v.method.some((m) => /No current wage was entered/.test(m)));
});

test('hourly rate labor: owner payroll × 12 is an expense; a solo provider’s pay is the goal, never added twice', () => {
  const owner = hourly.compute({ values: V.hourly, type: 'owner', profession: 'esthetician' });
  near(owner.raw.annualPayroll, 60000);
  assert.equal(card(owner.view, 'Labor: payroll a year').value, '$60,000');
  const solo = hourly.compute({ values: V.hourly, type: 'solo', profession: 'esthetician' });
  near(solo.raw.annualPayroll, 0, 'a leftover payroll value never reaches a solo provider');
  near(solo.raw.annualRevenue, 60000 + 12000 + 6000);
  assert.ok(solo.view.method.some((m) => /your desired income is your pay/i.test(m) && /twice/.test(m)));
});

test('employees never get labor: cost per service ignores pay, wage and commission for employees', () => {
  const r = cost.compute({ values: V.cost, type: 'employee', profession: 'esthetician' });
  near(r.raw.labor, 0);
  near(r.raw.rentShare, 0);
  near(r.raw.trueCost, 11);
  assert.ok(!r.view.cards.some((c) => /labor|pay/i.test(c.label)), 'no labor card for employees');
  assert.equal(params(r.view).get('targetHourly'), null);
});

test('cost per service labor: its own card; solo pay goes to pricing as pay per hour, not into product cost', () => {
  const solo = cost.compute({ values: V.cost, type: 'solo', profession: 'esthetician' });
  near(solo.raw.labor, 30);
  near(solo.raw.trueCost, 11 + 18.75 + 30);
  assert.equal(card(solo.view, 'Your pay (labor)').value, '$30.00');
  const q = params(solo.view);
  assert.equal(q.get('productCost'), '11.00', 'only products and supplies');
  assert.equal(q.get('targetHourly'), '20.00', '$3,200 ÷ 160 hours');
  assert.equal(q.get('monthlyPay'), null);
  // following the link counts labor exactly once in pricing
  const next = pricing.compute({ values: { ...V.pricing, productCost: Number(q.get('productCost')), targetHourly: Number(q.get('targetHourly')),
    durationMinutes: Number(q.get('durationMinutes')) }, type: 'solo', profession: 'esthetician' });
  near(next.raw.laborAtRecommended, 30);
  near(next.raw.directCosts, 11 + 18.75);
  const owner = cost.compute({ values: V.cost, type: 'owner', profession: 'esthetician' });
  near(owner.raw.labor, 30 + 48);
  assert.equal(card(owner.view, 'Labor').value, '$78.00');
  const o = params(owner.view);
  assert.deepEqual([o.get('providerWage'), o.get('commissionRate'), o.get('currentPrice'), o.get('productCost'), o.get('targetHourly')], ['20', '40', '120', '11.00', null]);
  const noPrice = cost.compute({ values: { ...V.cost, price: 0 }, type: 'owner', profession: 'esthetician' });
  assert.match(card(noPrice.view, 'Labor').note, /commission needs a service price/);
  assert.match(noPrice.view.insight, /enter the service price to include it/);
});

test('service pricing labor: solo pay per hour only; owner wage + commission grossed up; its own card', () => {
  const solo = pricing.compute({ values: V.pricing, type: 'solo', profession: 'esthetician' });
  near(solo.raw.timeValue, 45 * 1.5, 'your pay per hour × 1.5 hours; the owner wage is ignored');
  near(solo.raw.commissionAtRecommended, 0, 'no commission for a solo provider');
  assert.equal(card(solo.view, 'Your pay for this service').value, '$67.50');
  assert.ok(solo.view.method.some((m) => /never counted twice/.test(m)));
  const owner = pricing.compute({ values: V.pricing, type: 'owner', profession: 'esthetician' });
  near(owner.raw.timeValue, 30, '$20/hour wage × 1.5 hours');
  near(owner.raw.recommendedPrice, (12 + 18.75 + 30) / (1 - 0.03 - 0.4 - 0.3));
  assert.equal(card(owner.view, 'Labor for this service').value.startsWith('$'), true);
  assert.ok(owner.view.method.some((m) => /grossed up/.test(m)));
  const tooMuch = pricing.compute({ values: { ...V.pricing, commissionRate: 70 }, type: 'owner', profession: 'esthetician' });
  assert.equal(tooMuch.ok, false);
  assert.match(tooMuch.errors.commissionRate, /below 100%/);
});

test('service profitability labor: its own card and a pricing link that carries labor to its own fields', () => {
  const solo = profit.compute({ values: V.profit, type: 'solo', profession: 'esthetician' });
  near(solo.raw.labor, 60, '$40/hour × 1.5 hours');
  assert.equal(card(solo.view, 'Your pay for this service').value, '$60.00');
  assert.deepEqual([params(solo.view).get('targetHourly'), params(solo.view).get('providerWage'), params(solo.view).get('productCost')], ['40', null, '12.00']);
  const owner = profit.compute({ values: V.profit, type: 'owner', profession: 'esthetician' });
  near(owner.raw.labor, 30 + 30, '$20 × 1.5 hours + 25% of $120');
  near(owner.raw.targetHourly, 30);
  assert.equal(card(owner.view, 'Labor for this service').value, '$60.00');
  const o = params(owner.view);
  assert.deepEqual([o.get('providerWage'), o.get('commissionRate'), o.get('targetHourly')], ['20', '25', null]);
});

test('break-even labor: solo pay or owner payroll + owner pay as fixed costs; commission per service; impossible still handled', () => {
  const solo = breakEven.compute({ values: V.breakEven, type: 'solo', profession: 'esthetician' });
  near(solo.raw.laborFixed, 3000, 'solo: only your pay, never the owner fields');
  near(solo.raw.fixedCosts, 2000 + 3000 + 1000);
  near(solo.raw.commission, 0);
  assert.equal(card(solo.view, 'Your pay a month').value, '$3,000');
  const owner = breakEven.compute({ values: V.breakEven, type: 'owner', profession: 'esthetician' });
  near(owner.raw.laborFixed, 10000, 'payroll + owner pay, never the solo pay');
  near(owner.raw.commission, 44);
  assert.equal(card(owner.view, 'Labor a month').value, '$10,000');
  const impossible = breakEven.compute({ values: { ...V.breakEven, commissionRate: 90 }, type: 'owner', profession: 'barber' });
  assert.equal(impossible.ok, true);
  assert.equal(impossible.view.primary.value, 'Not possible');
  assert.match(impossible.view.insight, /variable cost and commission/);
  assert.equal(typeof owner.view.extraNode, 'function', 'the chart is built only in the browser');
});
