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
import { config as takeHome, MODEL } from '../assets/calc/calculators/profit-take-home.js';
import { config as capacity } from '../assets/calc/calculators/capacity-clients.js';
import { config as increase } from '../assets/calc/calculators/price-increase.js';
import { config as discount } from '../assets/calc/calculators/discount-promotion.js';
import { config as menu, recommendations } from '../assets/calc/calculators/menu-profitability.js';
import { PROFESSIONS, serviceText, signatureService, sampleServices, sampleItems, itemPlaceholder, profText } from '../assets/calc/ui/professions.js';

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
  takeHome: { serviceRevenue: 12000, retailRevenue: 0, productCosts: 1000, monthlyRent: 2000, fixedExpenses: 500, variableExpenses: 500, monthlyPay: 5000,
    monthlyPayroll: 3000, commissionRate: 10, ownerPay: 4000, taxRate: 25, payType: 'mixed', revenueGenerated: 8000, payCommissionRate: 10, hourlyWage: 15,
    hoursWorked: 160, hoursOptional: 150, tips: 500, bonuses: 100 },
  capacity: { revenueGoal: 8000, averageTicket: 100, workingDaysPerMonth: 20, serviceMinutes: 60, currentClients: 55, currentTicket: 105,
    incomeGoal: 4000, goalPeriod: 'month', payModel: 'sales', tierPeriod: 'week', tiers: [{ from: 0, rate: 40 }, { from: 2000, rate: 45 }],
    flatRate: 40, baseWage: 0, tipPerClient: 10, nonClientHours: 4, hoursPerDay: 8 },
  increase: { currentPrice: 100, newPrice: 115, monthlyAppointments: 60, durationMinutes: 60, productCost: 10, monthlyRent: 1600, hoursPerMonth: 160,
    targetHourly: 30, providerWage: 20, commissionRate: 40, processingRate: 0, expectedLoss: 0 },
  discount: { regularPrice: 150, discountRate: 20, promoAppointments: 25, durationMinutes: 60, productCost: 15, monthlyRent: 2000, hoursPerMonth: 160,
    targetHourly: 40, providerWage: 20, commissionRate: 40, overhead: 0, processingRate: 3, targetMargin: 30 },
  menu: { monthlyRent: 1600, hoursPerMonth: 160, targetHourly: 30, processingRate: 0, services: [
    { name: 'Facial', price: 120, durationMinutes: 60, productCost: 10, supplyCost: 2, laborHourly: 20, commissionRate: 30 },
    { name: 'Peel', price: 170, durationMinutes: 90, productCost: 20, supplyCost: 5, laborHourly: 20, commissionRate: 30 },
    { name: 'Lash fill', price: 70, durationMinutes: 60, productCost: 8, supplyCost: 2, laborHourly: 20, commissionRate: 30 }] },
};
const CASES = [
  ['service-pricing', pricing, V.pricing, ['solo', 'owner']],
  ['hourly-rate', hourly, V.hourly, ['solo', 'employee', 'owner']],
  ['service-cost', cost, V.cost, ['solo', 'owner']],
  ['service-profitability', profit, V.profit, ['solo', 'owner']],
  ['break-even', breakEven, V.breakEven, ['solo', 'owner']],
  ['profit-take-home', takeHome, V.takeHome, ['solo', 'employee', 'owner']],
  ['capacity-clients', capacity, V.capacity, ['solo', 'employee', 'owner']],
  ['price-increase', increase, V.increase, ['solo', 'owner']],
  ['discount-promotion', discount, V.discount, ['solo', 'owner']],
  ['menu-profitability', menu, V.menu, ['solo', 'owner']],
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

// The owner's lists, exactly: every example service is 60 or 90 minutes, signature first.
const LISTS = {
  esthetician: [['Signature Facial', 60], ['Chemical Peel', 60], ['Hydrafacial', 60], ['Dermaplaning', 60], ['Brow Lamination', 60], ['Lash Lift', 60], ['Back Facial', 90]],
  cosmetologist: [['Silk Press', 90], ['Curly Cut', 90], ['Root Touch-Up', 90], ['Blowout', 60], ['Trim & Style', 60], ['Gloss/Toner', 60]],
  manicurist: [['Gel Manicure', 60], ['Acrylic Full Set', 90], ['Fill', 60], ['Spa Pedicure', 60], ['Gel-X Set', 90]],
  barber: [['Fade', 60], ['Cut & Beard', 60], ['Lineup & Shape-Up', 60], ['Hot Towel Shave', 60], ['Kids’ Cut', 60], ['Cut, Beard & Hot Towel Shave', 90]],
};
// words that belong to an esthetician's menu or backbar and must never reach another license's results
const ESTHETICIAN_TERMS = /facial|\bpeel|hydrafacial|dermaplan|\bbrow|\blash|enzyme|hyaluronic|esthetician/i;

test('profession wording: example services are exactly each license’s list, signature first, and always 60 or 90 minutes', () => {
  for (const [p, list] of Object.entries(LISTS)) {
    assert.deepEqual(PROFESSIONS[p].services.map((s) => [s.name, s.minutes]), list, p);
    for (const s of PROFESSIONS[p].services) assert.ok([60, 90].includes(s.minutes), `${p}: ${s.minutes}-minute example`);
    assert.deepEqual(sampleServices(p, Infinity).map((s) => [s.name, s.minutes]), list, `${p}: sample menu rows`);
    assert.equal(signatureService(p).minutes, list[0][1], `${p}: signature length`);
  }
  assert.doesNotMatch(JSON.stringify(PROFESSIONS), /balayage/i);
  assert.equal(signatureService('esthetician').text, '60-minute signature facial');
  assert.equal(serviceText('esthetician', 90).phrase, '90-minute back facial');
  assert.equal(signatureService('cosmetologist').text, '90-minute silk press');
  assert.equal(serviceText('cosmetologist', 60).phrase, '60-minute blowout');
  assert.equal(signatureService('manicurist').text, '60-minute gel manicure');
  assert.equal(serviceText('manicurist', 90).phrase, '90-minute acrylic full set');
  assert.equal(signatureService('barber').text, '60-minute fade');
  assert.equal(serviceText('barber', 90).phrase, '90-minute cut, beard & hot towel shave');
  assert.equal(serviceText('barber', 45).phrase, `${45}-minute service`, 'a length with no example names no service');
  assert.equal(signatureService('nonsense').text, '60-minute signature facial', 'unknown profession falls back to esthetician');
  const insight = (profession, exampleServiceMinutes) => hourly.compute({ values: { ...V.hourly, exampleServiceMinutes }, type: 'solo', profession }).view.insight;
  assert.match(insight('esthetician', 90), /^A 90-minute back facial should generate/);
  assert.match(insight('cosmetologist', 90), /^A 90-minute silk press should generate/);
  assert.match(insight('manicurist', 60), /^A 60-minute gel manicure should generate/);
  assert.match(insight('barber', 60), /^A 60-minute fade should generate/);
  assert.match(insight('barber', 90), /^A 90-minute cut, beard & hot towel shave should generate/);
  assert.match(pricing.compute({ values: V.pricing, type: 'solo', profession: 'cosmetologist' }).view.share.label, /90-minute silk press/);
  // product and supply examples match the license: developer, toner and foils for hair; gel polish, tips and files for nails
  assert.deepEqual(sampleItems('cosmetologist').map(([, n]) => n), ['Developer', 'Toner', 'Foils', 'Neck strips']);
  assert.deepEqual(sampleItems('manicurist').map(([, n]) => n), ['Gel polish', 'Tips', 'Files', 'Lint-free wipes']);
  assert.deepEqual(sampleItems('barber').map(([, n]) => n), ['Shave cream', 'Beard oil', 'Neck strips', 'Disposable clipper guards']);
  assert.deepEqual(sampleItems('esthetician').map(([c]) => c), ['product', 'product', 'supply', 'other']);
  for (const p of ['cosmetologist', 'manicurist', 'barber']) {
    assert.doesNotMatch(JSON.stringify([sampleItems(p), itemPlaceholder(p), sampleServices(p, Infinity), profText('cost-card', p)]), ESTHETICIAN_TERMS, `${p}: sample rows`);
  }
});

// Each calculator run the way its page runs for that license: sample rows (menu services, cost items) are the license's own.
function asLicensed(name, values, profession) {
  if (name === 'menu-profitability') return { ...values, services: values.services.map((s, i) => ({ ...s, name: sampleServices(profession, 3)[i].name })) };
  if (name === 'service-cost') return { ...values, meta: values.meta.map((m, i) => ({ ...m, name: sampleItems(profession)[i * 2][1] })) };
  return values;
}

test('no esthetician wording reaches a cosmetologist, manicurist or barber in any calculator view, and no other license’s services', () => {
  const phrases = Object.fromEntries(Object.entries(PROFESSIONS).map(([p, x]) => [p, x.services.map((s) => s.phrase).filter((ph) => ph.length > 4)]));
  for (const [name, calc, values, types] of CASES) {
    for (const type of types) for (const profession of Object.keys(PROFESSIONS)) {
      const r = calc.compute({ values: asLicensed(name, values, profession), type, profession });
      assert.equal(r.ok, true, `${name} ${type} ${profession}`);
      const t = textOf(r.view);
      if (profession !== 'esthetician') assert.doesNotMatch(t, ESTHETICIAN_TERMS, `${name} ${type} ${profession}: ${t.match(new RegExp(`.{40}(${ESTHETICIAN_TERMS.source}).{20}`, 'i'))?.[0]}`);
      for (const [other, list] of Object.entries(phrases)) {
        if (other === profession) continue;
        for (const ph of list) {
          if (PROFESSIONS[profession].services.some((s) => s.phrase.includes(ph))) continue; // "cut & beard" sits inside a barber's 90-minute name
          assert.ok(!t.toLowerCase().includes(ph.toLowerCase()), `${name} ${type} ${profession}: shows ${other}’s “${ph}”`);
        }
      }
    }
  }
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

test('cost per service has no employee mode: every result counts rent and labor once entered', () => {
  for (const type of ['solo', 'owner']) {
    const r = cost.compute({ values: V.cost, type, profession: 'esthetician' });
    assert.ok(r.raw.rentShare > 0, `${type}: rent counted`);
    assert.ok(r.raw.labor > 0, `${type}: labor counted`);
    near(r.raw.trueCost, r.raw.consumableCost + r.raw.rentShare + r.raw.labor);
    assert.ok(!r.view.method.some((m) => /business you work for/.test(m)), 'no employee wording left');
  }
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

// ======================= Sprint 2 =======================
const NEGATIVE_MONEY = /[-−]\$/;

test('every Sprint 2 view: no NaN/Infinity/undefined text, losses never shown as a negative profit', () => {
  for (const [name, calc, values, types] of CASES.slice(5)) {
    for (const type of types) {
      const r = calc.compute({ values, type, profession: 'barber' });
      assert.equal(r.ok, true, `${name} ${type}`);
      assert.doesNotMatch(textOf(r.view), /NaN|Infinity|undefined/, `${name} ${type}`);
      assert.doesNotMatch(textOf(r.view), /-\$\d[^"]* profit/, `${name} ${type}: "-$x profit"`);
      assert.ok(r.view.method.length >= 3, `${name} ${type}: methodology`);
      assert.ok(r.view.insight && r.view.share, `${name} ${type}: insight and share`);
    }
  }
  // losses, shortfalls and cuts: labelled in words, never as a negative amount (spec §26)
  const losing = [
    [takeHome, { ...V.takeHome, serviceRevenue: 3000 }, 'solo'], [takeHome, { ...V.takeHome, serviceRevenue: 3000 }, 'owner'],
    [increase, { ...V.increase, newPrice: 80 }, 'solo'], [increase, { ...V.increase, currentPrice: 30, newPrice: 40 }, 'owner'],
    [discount, { ...V.discount, discountRate: 80 }, 'solo'], [discount, { ...V.discount, regularPrice: 40, discountRate: 10 }, 'owner'],
    [menu, { ...V.menu, services: [{ ...V.menu.services[0], price: 30 }, { ...V.menu.services[2], price: 20 }] }, 'solo'],
  ];
  for (const [calc, values, type] of losing) {
    const r = calc.compute({ values, type, profession: 'esthetician' });
    assert.equal(r.ok, true);
    assert.doesNotMatch(textOf(r.view), NEGATIVE_MONEY, textOf(r.view).match(/.{60}[-−]\$.{20}/)?.[0]);
    assert.ok(r.view.primary.loss || r.view.cards.some((c) => c.loss), 'the loss is flagged');
  }
});

test('profit & take-home: the accounting model is stated, owner pay is an expense once, profit and take-home are distinct', () => {
  const solo = takeHome.compute({ values: V.takeHome, type: 'solo', profession: 'esthetician' });
  assert.equal(solo.view.method[0], MODEL);
  assert.match(MODEL, /counted once/);
  near(solo.raw.ownerComp, 5000, 'solo: your monthly pay only');
  near(solo.raw.labor, 0, 'no payroll or commission for a solo provider');
  assert.equal(solo.view.primary.value, '$6,000');
  assert.equal(card(solo.view, 'Business profit').value, '$3,000');
  assert.equal(card(solo.view, 'Business expenses').note, 'Includes $5,000 your pay');
  assert.equal(card(solo.view, 'Rent').value, '$2,000');
  const owner = takeHome.compute({ values: V.takeHome, type: 'owner', profession: 'esthetician' });
  near(owner.raw.ownerComp, 4000, 'owner: owner pay, never the solo pay');
  near(owner.raw.labor, 3000 + 1200);
  assert.equal(owner.view.primary.label, 'Owner take-home pay a month');
  assert.equal(card(owner.view, 'Business loss').value, '$200', 'a loss is labelled, not shown as negative profit');
  assert.equal(card(owner.view, 'Business loss').loss, true);
  assert.match(owner.view.insight, /can’t fully cover your owner pay/);
  assert.equal(card(owner.view, 'Labor: payroll + commission').value, '$4,200');
  const loss = takeHome.compute({ values: { ...V.takeHome, serviceRevenue: 3000 }, type: 'solo', profession: 'esthetician' });
  assert.equal(loss.view.primary.loss, true);
  assert.match(loss.view.primary.label, /shortfall/);
  assert.doesNotMatch(textOf(loss.view), NEGATIVE_MONEY);
  const even = takeHome.compute({ values: { ...V.takeHome, monthlyPay: 8000 }, type: 'solo', profession: 'esthetician' });
  assert.match(even.view.insight, /breaks even after paying you/);
});

test('profit & take-home employee: replaces the business model per pay type; no rent or business costs', () => {
  const shown = (v) => v.cards.map((c) => c.label);
  const hourly = takeHome.compute({ values: { ...V.takeHome, payType: 'hourly' }, type: 'employee', profession: 'barber' });
  near(hourly.raw.gross, 15 * 160 + 500 + 100);
  assert.deepEqual(shown(hourly.view), ['Hourly earnings', 'Tips', 'Bonuses', 'Estimated gross earnings', 'Estimated taxes', 'Effective hourly earnings']);
  const comm = takeHome.compute({ values: { ...V.takeHome, payType: 'commission' }, type: 'employee', profession: 'barber' });
  near(comm.raw.commissionEarnings, 800);
  near(comm.raw.hoursWorked, 150, 'commission uses the optional hours field');
  assert.deepEqual(shown(comm.view), ['Service revenue generated', 'Commission earnings', 'Tips', 'Bonuses', 'Estimated gross earnings', 'Estimated taxes', 'Effective hourly earnings']);
  const mixed = takeHome.compute({ values: V.takeHome, type: 'employee', profession: 'barber' });
  near(mixed.raw.gross, 800 + 2400 + 500 + 100);
  assert.equal(mixed.view.primary.value, '$2,850', '$3,800 gross − 25% tax');
  assert.equal(mixed.view.primary.label, 'Estimated take-home pay this month');
  assert.equal(card(mixed.view, 'Effective hourly earnings').value, '$23.75/hour');
  assert.match(mixed.view.insight, /^Counting commission, wages, tips, and bonuses, every hour you work earns about \$23\.75 before tax/);
  assert.match(takeHome.compute({ values: { ...V.takeHome, payType: 'hourly', bonuses: 0 }, type: 'employee', profession: 'barber' }).view.insight, /^Counting wages and tips, /);
  for (const v of [hourly.view, comm.view, mixed.view]) {
    assert.doesNotMatch(textOf(v.cards), /rent|payroll|business profit/i, 'employees see no business numbers');
    assert.match(textOf(v), /take-home/i);
  }
  const noHours = takeHome.compute({ values: { ...V.takeHome, payType: 'commission', hoursOptional: 0 }, type: 'employee', profession: 'barber' });
  assert.equal(card(noHours.view, 'Effective hourly earnings'), undefined);
  // errors land on the field the employee can see
  const bad = takeHome.compute({ values: { ...V.takeHome, payType: 'commission', payCommissionRate: 0, revenueGenerated: 0 }, type: 'employee', profession: 'barber' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['payCommissionRate', 'revenueGenerated']);
  const noHrs = takeHome.compute({ values: { ...V.takeHome, payType: 'hourly', hoursWorked: 0 }, type: 'employee', profession: 'barber' });
  assert.deepEqual(Object.keys(noHrs.errors), ['hoursWorked']);
});

test('capacity: primary is whole clients; scenario table built lazily from the engine; employee wording', () => {
  const r = capacity.compute({ values: V.capacity, type: 'solo', profession: 'esthetician' });
  assert.equal(r.view.primary.value, '80');
  assert.equal(typeof r.view.extraNode, 'function');
  assert.deepEqual(r.raw.scenarios.map((s) => s.ticket), [60, 80, 100, 120, 140]);
  assert.equal(card(r.view, 'Working hours with clients').value, '80 a month');
  assert.equal(card(r.view, 'Clients to add').value, '22');
  assert.match(r.view.insight, /about 80 clients a month, or 4 a day/);
  const ninety = capacity.compute({ values: { ...V.capacity, serviceMinutes: 90 }, type: 'solo', profession: 'esthetician' });
  assert.equal(card(ninety.view, 'Working hours with clients').value, '120 a month');
  // employees plan from a pre-tax pay goal, not a revenue goal: their own view, with the tier reached and the next one
  const emp = capacity.compute({ values: V.capacity, type: 'employee', profession: 'cosmetologist' });
  assert.equal(emp.view.primary.label, 'Clients a week to reach your pay goal');
  assert.doesNotMatch(textOf(emp.view), /revenue goal/, 'employees never see the owner’s revenue goal');
  assert.ok(emp.view.method.some((m) => /Profit & Take-Home/.test(m)));
  assert.ok(emp.view.method.some((m) => /pays its rate on all sales|on all sales in that week/.test(m)), 'the all-sales tier rule is stated');
  assert.match(emp.view.primary.note, /before tax/);
  assert.match(emp.view.share.insight, /90-minute silk press|60-minute blowout/);
  assert.equal(capacity.compute({ values: { ...V.capacity, averageTicket: 0 }, type: 'solo', profession: 'esthetician' }).errors.averageTicket,
    'Enter an average service price greater than $0.');
});

test('capacity employee: whole clients a week, the tier reached, the next-tier cliff, hours and days; errors in words', () => {
  const emp = (over = {}, profession = 'barber') => capacity.compute({ values: { ...V.capacity, ...over }, type: 'employee', profession });
  // $4,000 a month = $923.08 a week. Tier 1 pays 40% + $10 tip = $50 a client: 19 clients ($950). The 20th reaches $2,000 → 45% on all.
  const r = emp();
  assert.equal(r.view.primary.value, '19');
  assert.equal(card(r.view, 'Tier reached').value, 'Tier 1: 40%');
  assert.equal(card(r.view, 'Sales needed').value, '$1,900 a week');
  assert.equal(card(r.view, 'Clients a month').value, 'About 82');
  assert.equal(card(r.view, 'Next tier').value, '45% at 20 clients');
  assert.match(r.view.insight, /Just 1 more client a week \(20 in all\) reaches tier 2: 45% on all your sales, \$1,100 a week\. That is \$150 more/);
  assert.match(r.view.insight, /stopping just short of it leaves money on the table/);
  assert.equal(card(r.view, 'Hours a week').value, '23', '19 one-hour clients + 4 non-client hours');
  assert.equal(card(r.view, 'Days a week').value, '2.9');
  assert.equal(typeof r.view.extraNode, 'function', 'tier table');
  const ninety = emp({ serviceMinutes: 90 });
  assert.equal(card(ninety.view, 'Hours a week').value, '32.5', '19 × 1.5 hours + 4');
  // flat commission + base wage, a weekly goal: $20/hour wage only, one-hour clients, no other hours → $800 a week is 40 clients
  const wage = emp({ payModel: 'flat', flatRate: 0, baseWage: 20, tipPerClient: 0, nonClientHours: 0, incomeGoal: 800, goalPeriod: 'week' });
  assert.equal(wage.view.primary.value, '40');
  assert.equal(card(wage.view, 'Commission rate').value, '0%');
  assert.equal(card(wage.view, 'Next tier'), undefined, 'flat commission has no tiers');
  assert.equal(wage.view.extraNode, null);
  // unreachable, invalid and NaN inputs: a message in words, never a number that can’t be calculated
  assert.match(emp({ payModel: 'flat', flatRate: 0, baseWage: 0, tipPerClient: 0 }).errors._, /pays \$0 for every client/);
  assert.match(emp({ incomeGoal: 1e7 }).errors._, /short of your goal/);
  assert.deepEqual(Object.keys(emp({ tiers: [{ from: 0, rate: 40 }, { from: 0, rate: 45 }] }).errors), ['tierFrom-1']);
  assert.deepEqual(Object.keys(emp({ tiers: [{ from: 0, rate: 40 }, { from: 2000, rate: 140 }] }).errors), ['tierRate-1']);
  assert.ok(emp({ averageTicket: 0 }).errors.averageTicket);
  assert.ok(emp({ incomeGoal: NaN }).errors.incomeGoal);
  // solo and owners keep the revenue-goal view
  assert.equal(capacity.compute({ values: V.capacity, type: 'owner', profession: 'barber' }).view.primary.label, 'Clients a month to reach your revenue goal');
});

test('price increase: the spec sentence, rent and labor in the cost, owner commission on the new price', () => {
  const r = increase.compute({ values: { ...V.increase, newPrice: 110, monthlyAppointments: 66 }, type: 'solo', profession: 'esthetician' });
  assert.match(r.view.insight, /^You could lose approximately 6 clients per month and generate the same service revenue\./);
  assert.equal(r.view.primary.value, '6');
  const solo = increase.compute({ values: V.increase, type: 'solo', profession: 'esthetician' });
  near(solo.raw.laborTime, 30, 'solo: your pay per hour × 1 hour; the owner wage is ignored');
  near(solo.raw.commissionRate, 0);
  near(solo.raw.rentShare, 10);
  assert.equal(card(solo.view, 'Your pay per appointment').value, '$30.00');
  const owner = increase.compute({ values: V.increase, type: 'owner', profession: 'esthetician' });
  near(owner.raw.laborTime, 20); near(owner.raw.next.commission, 46);
  assert.equal(card(owner.view, 'Labor per appointment').value, '$66.00');
  const none = increase.compute({ values: { ...V.increase, newPrice: 100 }, type: 'solo', profession: 'esthetician' });
  assert.equal(none.view.primary.value, 'No change');
  const cut = increase.compute({ values: { ...V.increase, newPrice: 80 }, type: 'solo', profession: 'esthetician' });
  assert.equal(cut.view.primary.value, '15'); assert.match(cut.view.insight, /price cut/);
  assert.doesNotMatch(textOf(cut.view), /NaN|Infinity/);
});

test('discount: statuses read correctly at 0%, normal, break-even and excessive discounts', () => {
  const at = (d, type = 'solo') => discount.compute({ values: { ...V.discount, discountRate: d }, type, profession: 'esthetician' });
  assert.match(at(0).view.insight, /At full price this 60-minute signature facial earns \$78\.00/);
  const normal = at(20);
  assert.equal(normal.view.primary.value, '$120.00');
  assert.equal(card(normal.view, 'Profit lost per appointment').value, '$29.10');
  assert.equal(card(normal.view, 'Break-even discount').value, '53.6%');
  assert.equal(card(normal.view, 'Maximum target-profit discount').value, '32.8%');
  assert.equal(card(normal.view, 'Total profit difference').value, '$728 less', 'a difference in words, never a negative amount');
  assert.equal(card(normal.view, 'Total profit difference').loss, true);
  assert.equal(typeof normal.view.extraNode, 'function', 'promotion table');
  const even = at(normal.raw.breakEvenDiscount * 100);
  assert.match(even.view.insight, /is the break-even discount/);
  const excessive = at(60);
  assert.equal(excessive.view.primary.loss, true);
  assert.match(excessive.view.insight, /more than this service can carry/);
  assert.equal(card(excessive.view, 'Profit after discount').value, 'Loss of $9.30');
  near(at(20, 'owner').raw.after.commission, 48, 'owner commission on the sale price');
  near(at(20).raw.after.commission, 0, 'solo: no commission');
  assert.equal(discount.compute({ values: { ...V.discount, targetMargin: 29 }, type: 'solo', profession: 'esthetician' }).errors.targetMargin, 'Enter a profit margin of at least 30%.');
});

test('menu: rankings drive cards and recommendations; descriptive, not prescriptive; owner vs solo labor', () => {
  const solo = menu.compute({ values: V.menu, type: 'solo', profession: 'esthetician' });
  near(solo.raw.services[0].labor, 30, 'solo: your pay per hour, row wages ignored');
  assert.equal(solo.view.primary.value, 'Facial');
  assert.equal(card(solo.view, 'Highest profit per appointment').value, 'Peel');
  assert.equal(card(solo.view, 'Lowest-performing service').value, 'Lash fill');
  assert.deepEqual(solo.view.recommendations, [
    'Your “Peel” service generates the most profit per appointment.',
    'Your “Facial” service generates the highest profit per hour.',
    '“Lash fill” earns the least per hour ($20/hour). If that gap matters to you, its price or duration may be worth a look.',
  ]);
  const owner = menu.compute({ values: V.menu, type: 'owner', profession: 'esthetician' });
  near(owner.raw.services[0].labor, 20 + 36, 'owner: row wage × 1 hour + 30% of $120');
  const q = params(owner.view);
  assert.deepEqual([q.get('currentPrice'), q.get('providerWage'), q.get('commissionRate'), q.get('productCost'), q.get('targetHourly')], ['70', '20', '30', '10.00', null]);
  assert.equal(params(solo.view).get('targetHourly'), '30');
  const loss = menu.compute({ values: { ...V.menu, services: [V.menu.services[0], { ...V.menu.services[2], price: 40 }] }, type: 'solo', profession: 'esthetician' });
  assert.match(loss.view.recommendations.at(-1), /“Lash fill” loses money at its current price, length and costs/);
  assert.equal(card(loss.view, 'Lowest-performing service').loss, true);
  const similar = menu.compute({ values: { ...V.menu, services: [100, 102, 104].map((price, i) => ({ ...V.menu.services[0], name: `S${i}`, price })) }, type: 'solo', profession: 'esthetician' });
  assert.match(similar.view.recommendations[0], /similar profit per hour/);
  assert.equal(similar.view.recommendations.length, 1, 'no laggard is named when services are close');
  const one = menu.compute({ values: { ...V.menu, services: [V.menu.services[0]] }, type: 'solo', profession: 'esthetician' });
  assert.deepEqual(one.view.recommendations, ['Add another service to compare and rank your menu.']);
  for (const r of [solo, owner, loss, similar, one]) {
    for (const t of r.view.recommendations) assert.doesNotMatch(t, /\b(should|must|need to|have to|drop|remove|cut|get rid|stop offering)\b/i, t);
  }
  assert.equal(typeof recommendations, 'function');
});
