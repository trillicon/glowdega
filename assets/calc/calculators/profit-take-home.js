import { mountCalculator } from '../ui/framework.js';
import { calculateBusinessProfit, calculateEmployeeTakeHome } from '../core/profit.js';
import { formatMoney as money, describeProfit } from '../core/money.js';
import { toRate, formatPercent, formatMargin } from '../core/percentages.js';
import { signatureService } from '../ui/professions.js';
import { MIN_PROFIT_MARGIN, marginBelowText } from '../core/pricing.js';

const PAY_NAMES = { hourly: 'Hourly', commission: 'Commission', mixed: 'Hourly + commission' };
const payTypeOf = (root) => root?.querySelector('input[name="payType"]:checked')?.value || 'hourly';
const pct = (v) => formatPercent(toRate(v), 1);
const listOf = (items) => new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(items);
/** Engine field names → the page's own field names, so each error lands on the input the person can see. */
const renamed = (errors, map) => Object.fromEntries(Object.entries(errors).map(([k, m]) => [map[k] || k, m]));

/**
 * The accounting model, in the words the page uses (also in the intro): your pay is a business expense; business profit is
 * what is left after every expense, your pay included; take-home = your pay + business profit − estimated taxes.
 */
export const MODEL = 'Your pay is counted once: as a business expense, then as part of what you take home. Business profit is what the business keeps after paying you; your take-home is your pay plus that profit, minus estimated taxes.';

function businessView(v, r, owner, profession) {
  const p = describeProfit(r.businessProfit);
  const earn = describeProfit(r.ownerEarnings);
  const t = describeProfit(r.takeHome);
  const payWord = owner ? 'your owner pay' : 'your pay';
  const sig = signatureService(profession);
  const cards = [
    { label: 'Total revenue', value: money(r.totalRevenue), note: r.retailRevenue > 0 ? `${money(r.serviceRevenue)} services + ${money(r.retailRevenue)} retail` : 'a month' },
    { label: 'Business expenses', value: money(r.businessExpenses), note: `Includes ${money(r.ownerComp)} ${payWord}` },
    { label: p.loss ? 'Business loss' : 'Business profit', value: money(p.amount), loss: p.loss,
      note: p.even ? 'Break-even after paying you' : `${formatMargin(Math.abs(r.profitMargin))} of revenue, after paying you` },
    { label: owner ? 'Your owner pay' : 'Your pay', value: money(r.ownerComp), note: 'Counted as a business expense' },
    { label: 'Estimated taxes', value: money(r.estimatedTaxes), note: `At ${pct(v.taxRate)} of your pay + profit` },
    { label: 'Rent', value: money(v.monthlyRent), note: v.monthlyRent > 0 ? 'Its own expense' : 'No rent entered' },
  ];
  if (owner) cards.push({ label: 'Labor: payroll + commission', value: money(r.labor), note: `${money(v.monthlyPayroll)} payroll + ${money(r.commission)} commission` });
  let insight;
  if (earn.loss) insight = `The business spends ${money(earn.amount)} more than it brings in before ${payWord} is paid, so there is nothing to take home this month. Revenue or costs need to change first.`;
  else if (p.loss) insight = `The business can’t fully cover ${payWord} of ${money(r.ownerComp)}: it runs a ${money(p.amount)} loss after paying you, so your real take-home is ${money(r.takeHome)}, not your full pay after tax.`;
  else if (p.even) insight = `The business breaks even after paying you ${money(r.ownerComp)}: it covers every expense and your pay, with nothing left over. You take home about ${money(r.takeHome)} after estimated taxes.`;
  else if (r.belowMinimum) insight = `The business earns a profit of ${money(r.businessProfit)} after paying you, but its ${marginBelowText(r.profitMargin)} margin is below the ${formatPercent(MIN_PROFIT_MARGIN)} minimum, so it doesn’t count as profitable yet. You take home about ${money(r.takeHome)} after estimated taxes. The Service Pricing Calculator finds prices that keep at least ${formatPercent(MIN_PROFIT_MARGIN)}.`;
  else insight = `After every expense, ${payWord} included, the business keeps ${money(r.businessProfit)} in profit, a ${formatMargin(r.profitMargin)} margin. Together with your pay, that leaves you about ${money(r.takeHome)} after estimated taxes.`;
  const method = [
    MODEL,
    `Total revenue = ${money(r.serviceRevenue)} services + ${money(r.retailRevenue)} retail = ${money(r.totalRevenue)}.`,
    `Business expenses = ${money(v.productCosts)} product/service costs + ${money(v.monthlyRent)} rent + ${money(v.fixedExpenses)} other fixed + ${money(v.variableExpenses)} variable` +
      (owner ? ` + ${money(v.monthlyPayroll)} payroll + ${money(r.commission)} commission (${pct(v.commissionRate)} of service revenue)` : '') +
      ` + ${money(r.ownerComp)} ${payWord} = ${money(r.businessExpenses)}.`,
    p.loss ? `Business loss = ${money(r.businessExpenses)} expenses − ${money(r.totalRevenue)} revenue = ${money(p.amount)}.`
      : `Business ${p.word.toLowerCase()} = ${money(r.totalRevenue)} revenue − ${money(r.businessExpenses)} expenses = ${money(p.amount)}.`,
    `Estimated taxes = ${pct(v.taxRate)} × (${money(r.ownerComp)} ${payWord} ${p.loss ? '−' : '+'} ${money(p.amount)} ${p.loss ? 'loss' : 'profit'}) = ${money(r.estimatedTaxes)}.` +
      (earn.loss ? ' Nothing is taxed when the business loses money before paying you.' : ''),
    t.loss ? `Take-home: the business is ${money(t.amount)} short of covering its costs before ${payWord}, so there is nothing to take home this month.`
      : `Take-home = ${money(r.ownerComp)} ${payWord} ${p.loss ? '−' : '+'} ${money(p.amount)} ${p.loss ? 'loss' : 'profit'} − ${money(r.estimatedTaxes)} taxes = ${money(t.amount)}.`,
    'Paying yourself more moves money from business profit to your pay; it does not change your take-home. Taxes are a rough estimate, not tax advice.',
  ];
  return {
    primary: t.loss ? { value: money(t.amount), label: 'Monthly shortfall: nothing to take home', loss: true, note: 'The business costs more than it brings in, before your pay.' }
      : { value: money(r.takeHome), label: owner ? 'Owner take-home pay a month' : 'Your take-home pay a month', note: `About ${money(r.takeHomeAnnual)} a year` },
    cards, insight, method, tone: r.tone,
    share: { value: t.loss ? 'Not yet' : money(r.takeHome), label: 'Monthly take-home, after expenses and estimated taxes', insight: `Revenue is not take-home. Know what every ${sig.name} actually pays you.` },
  };
}

function employeeView(v, r, profession) {
  const sig = signatureService(profession);
  const cards = [];
  if (r.payType !== 'hourly') cards.push({ label: 'Service revenue generated', value: money(r.serviceRevenue) },
    { label: 'Commission earnings', value: money(r.commissionEarnings), note: `${pct(v.payCommissionRate)} of service revenue` });
  if (r.payType !== 'commission') cards.push({ label: 'Hourly earnings', value: money(r.hourlyEarnings), note: `${money(v.hourlyWage, { cents: true })}/hour` });
  cards.push(
    { label: 'Tips', value: money(r.tips) },
    { label: 'Bonuses', value: money(r.bonuses) },
    { label: 'Estimated gross earnings', value: money(r.gross), note: 'Before tax' },
    { label: 'Estimated taxes', value: money(r.estimatedTaxes), note: `At ${pct(v.taxRate)}` },
  );
  if (r.hasHours) cards.push({ label: 'Effective hourly earnings', value: `${money(r.effectiveHourly, { cents: true })}/hour`, note: `${money(r.takeHomePerHour, { cents: true })}/hour after tax` });
  const parts = [r.commissionEarnings > 0 ? 'commission' : '', r.hourlyEarnings > 0 ? 'wages' : '', r.tips > 0 ? 'tips' : '', r.bonuses > 0 ? 'bonuses' : ''].filter(Boolean);
  const insight = !(r.gross > 0) ? 'With nothing earned this month, there is nothing to take home yet.'
    : r.hasHours ? `Counting ${listOf(parts)}, every hour you work earns about ${money(r.effectiveHourly, { cents: true })} before tax, or ${money(r.takeHomePerHour, { cents: true })} you keep.`
      : `Your ${listOf(parts)} come to ${money(r.gross)} before tax. Add the hours you work to see what each hour earns.`;
  const method = [];
  if (r.payType !== 'hourly') method.push(`Commission earnings = ${money(r.serviceRevenue)} service revenue × ${pct(v.payCommissionRate)} = ${money(r.commissionEarnings)}.`);
  if (r.payType !== 'commission') method.push(`Hourly earnings = ${money(v.hourlyWage, { cents: true })}/hour × ${v.hoursWorked} hours = ${money(r.hourlyEarnings)}.`);
  method.push(
    `Gross earnings = ${parts.length ? parts.join(' + ') : 'nothing entered'} = ${money(r.gross)}. Tips and bonuses are taxable, so they are included.`,
    `Estimated taxes = ${money(r.gross)} × ${pct(v.taxRate)} = ${money(r.estimatedTaxes)}; take-home = gross − taxes = ${money(r.takeHome)}.`,
    r.hasHours ? 'Effective hourly earnings = gross earnings ÷ hours worked (after tax: take-home ÷ hours).' : 'No hours were entered, so effective hourly earnings are not shown.',
    'Employees don’t pay rent or the business’s expenses, so none are included. Taxes are a rough estimate, not tax advice.',
  );
  return {
    primary: { value: money(r.takeHome), label: 'Estimated take-home pay this month', note: `About ${money(r.takeHomeAnnual)} a year` },
    cards, insight, method, tone: 'ok', // an employee's pay: no business margin, so the default box
    share: { value: money(r.takeHome), label: 'My monthly take-home pay', insight: `Commission, wages and tips: know what every ${sig.name} really pays you.` },
  };
}

export const config = mountCalculator({
  readExtra: (root) => ({ values: { payType: payTypeOf(root) }, errors: {} }),
  printExtra: (root) => (root.dataset.type === 'employee' ? [['How you are paid', PAY_NAMES[payTypeOf(root)]]] : []),
  compute({ values: v, type, profession }) {
    if (type === 'employee') {
      const commissionOnly = v.payType === 'commission';
      const r = calculateEmployeeTakeHome({
        payType: v.payType, serviceRevenue: v.revenueGenerated, commissionRate: toRate(v.payCommissionRate),
        hourlyWage: v.hourlyWage, hoursWorked: (commissionOnly ? v.hoursOptional : v.hoursWorked) || 0, tips: v.tips, bonuses: v.bonuses, taxRate: toRate(v.taxRate),
      });
      if (!r.ok) return { ok: false, errors: renamed(r.errors, { serviceRevenue: 'revenueGenerated', commissionRate: 'payCommissionRate', hoursWorked: commissionOnly ? 'hoursOptional' : 'hoursWorked' }) };
      return { ok: true, raw: r, view: employeeView({ ...v, hoursWorked: commissionOnly ? v.hoursOptional : v.hoursWorked }, r, profession) };
    }
    const owner = type === 'owner';
    // each type passes only its own pay fields: a solo provider's monthly pay, or an owner's payroll, commission and owner pay
    const r = calculateBusinessProfit({
      serviceRevenue: v.serviceRevenue, retailRevenue: v.retailRevenue, productCosts: v.productCosts, monthlyRent: v.monthlyRent,
      fixedExpenses: v.fixedExpenses, variableExpenses: v.variableExpenses, taxRate: toRate(v.taxRate),
      monthlyPay: owner ? 0 : v.monthlyPay, monthlyPayroll: owner ? v.monthlyPayroll : 0, commissionRate: owner ? toRate(v.commissionRate) : 0,
      ownerPay: owner ? v.ownerPay : 0,
    });
    return r.ok ? { ok: true, raw: r, view: businessView(v, r, owner, profession) } : r;
  },
});
