import { mountCalculator } from '../ui/framework.js';
import { calculateHourlyRate, calculateEmployeeEarnings } from '../core/pricing.js';
import { formatMoney as money, formatNumber } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';

const length = (min) => (min % 60 === 0 ? `${min / 60}-hour` : `${formatNumber(min, 0)}-minute`);
const PAY_NAMES = { hourly: 'Hourly', commission: 'Commission', mixed: 'Hourly + commission' };
const payTypeOf = (root) => root.querySelector('input[name="payType"]:checked')?.value || 'hourly';

function scheduleMethod(v, r) {
  return [
    `Paid hours a year: ${formatNumber(v.hoursPerDay)} hours × ${formatNumber(v.workingDaysPerWeek)} days × ${formatNumber(v.workingWeeksPerYear)} weeks = ${formatNumber(r.annualHours, 0)}.`,
    `Client hours a year: (${formatNumber(v.hoursPerDay)} − ${formatNumber(v.nonClientHoursPerDay)} non-client hours) × ${formatNumber(v.workingDaysPerWeek)} days × ${formatNumber(v.workingWeeksPerYear)} weeks = ${formatNumber(r.annualClientHours, 0)}.`,
    `Before-tax income: ${money(v.desiredAnnualIncome)} ÷ (1 − ${formatPercent(toRate(v.taxRate), 1)} tax) = ${money(r.preTaxIncome)}. Your goal is what you keep after estimated income tax.`,
  ];
}

function employeeView(v, r) {
  const tipsLine = r.annualTips > 0
    ? `Tips: ${money(r.monthlyTips)} a month × 12 = ${money(r.annualTips)} a year. Tips count toward your goal and are taxed, so they come off the before-tax goal.`
    : 'No tips were entered.';
  const method = [...scheduleMethod(v, r), tipsLine];
  const cards = [];
  let primary, insight, share;
  const met = r.goalMet
    ? `Your ${r.basePay > 0 ? 'base pay and tips' : 'tips'} already reach your take-home goal of ${money(v.desiredAnnualIncome)}`
    : '';
  if (r.payType === 'hourly') {
    method.push(`Required hourly wage = (${money(r.preTaxIncome)} − ${money(r.annualTips)} tips) ÷ ${formatNumber(r.paidHours, 0)} paid hours = ${money(r.requiredWage, { cents: true })}/hour.`);
    primary = r.goalMet ? { value: 'Goal met', label: 'Your tips already cover your goal' }
      : { value: `${money(r.requiredWage, { cents: true })}/hour`, label: 'Hourly wage you need' };
    insight = r.goalMet ? `${met}, so any wage is on top of it.`
      : `To take home ${money(v.desiredAnnualIncome)} a year, you need a wage of about ${money(r.requiredWage, { cents: true })}/hour${r.annualTips > 0 ? `, plus your ${money(r.monthlyTips)} a month in tips` : ''}.`;
    share = { value: r.goalMet ? 'Goal met' : `${money(r.requiredWage)}/hr`, label: 'The hourly wage my take-home goal needs', insight: 'Know the wage that pays your life, not just your bills.' };
  } else {
    const c = formatPercent(r.commissionRate, 1);
    if (r.payType === 'mixed') {
      method.push(`Base pay: ${money(v.baseHourlyWage, { cents: true })}/hour × ${formatNumber(r.paidHours, 0)} paid hours = ${money(r.basePay)} a year.`);
      method.push(`Still to earn from commission: ${money(r.preTaxIncome)} − ${money(r.basePay)} base pay − ${money(r.annualTips)} tips = ${money(r.remaining)}.`);
    } else {
      method.push(`Still to earn from commission: ${money(r.preTaxIncome)} − ${money(r.annualTips)} tips = ${money(r.remaining)} a year.`);
    }
    method.push(`Required service revenue = amount still to earn ÷ ${c} commission = ${money(r.annualServiceRevenue)} a year. Weekly = yearly ÷ ${formatNumber(v.workingWeeksPerYear)} working weeks; per client hour = yearly ÷ ${formatNumber(r.annualClientHours, 0)} client hours.`);
    primary = r.goalMet ? { value: 'Goal met', label: `Your ${r.basePay > 0 ? 'base pay and tips' : 'tips'} already cover your goal` }
      : { value: money(r.monthlyServiceRevenue), label: 'Service revenue you need to perform each month' };
    if (!r.goalMet) {
      cards.push(
        { label: 'Service revenue per week', value: money(r.weeklyServiceRevenue) },
        { label: 'Service revenue per client hour', value: `${money(r.perClientHour, { cents: true })}/hour`, note: `${formatNumber(r.annualClientHours, 0)} client hours a year` },
        { label: 'Service revenue per year', value: money(r.annualServiceRevenue) },
        { label: 'Your commission from it', value: money(r.annualCommission), note: `${c} a year` },
      );
    }
    insight = r.goalMet
      ? `${met}, so you don’t need any commission to reach it. Every service you perform adds to it.`
      : `At ${c} commission, a ${length(r.exampleServiceMinutes)} facial or peel should bring in about ${money(r.exampleServiceRevenue)} in service revenue.`;
    share = { value: r.goalMet ? 'Goal met' : money(r.monthlyServiceRevenue), label: 'Monthly service revenue my take-home goal needs', insight: 'Commission works when you know your number.' };
  }
  if (r.payType === 'mixed') cards.push({ label: 'Base pay', value: money(r.basePay), note: `${money(r.monthlyBasePay)} a month` });
  cards.push(
    { label: 'Tips', value: money(r.annualTips), note: 'a year, before tax' },
    { label: 'Before-tax income needed', value: money(r.preTaxIncome) },
    { label: 'Estimated taxes', value: money(r.estimatedTaxes), note: `At ${formatPercent(toRate(v.taxRate), 1)}` },
  );
  if (r.goalMet && r.surplus > 0.005) cards.push({ label: 'Above your goal by', value: money(r.surplus), note: 'before tax, a year' });
  method.push('Employees don’t pay rent or the business’s expenses, so none are added.');
  return { primary, cards, insight, method, share };
}

function ownerView(v, r) {
  const cards = [
    { label: 'Required annual revenue', value: money(r.annualRevenue) },
    { label: 'Required monthly revenue', value: money(r.monthlyRevenue) },
    { label: 'Required revenue per working hour', value: money(r.perWorkingHour, { cents: true }), note: `${formatNumber(r.annualHours, 0)} working hours a year` },
    { label: 'Required revenue per client hour', value: money(r.perClientHour, { cents: true }), note: `${formatNumber(r.annualClientHours, 0)} client hours a year` },
    { label: 'Rent a year', value: money(r.annualRent), note: r.annualRent > 0 ? `${money(r.rentPerClientHour, { cents: true })} of every client hour` : 'No rent entered' },
    { label: 'Estimated taxes', value: money(r.estimatedTaxes), note: `At ${formatPercent(toRate(v.taxRate), 1)}` },
  ];
  const method = [
    ...scheduleMethod(v, r),
    `Annual expenses: ${money(v.monthlyRent)} rent × 12 = ${money(r.annualRent)}, + ${money(r.otherExpenses)} other expenses = ${money(r.totalExpenses)}.`,
    `Required annual revenue = before-tax income + ${money(r.totalExpenses)} expenses = ${money(r.annualRevenue)}. Expenses are paid before income tax, so they aren't taxed.`,
    r.annualRent > 0
      ? `Rent's share: ${money(r.annualRent)} is ${formatPercent(r.rentShareOfRevenue)} of the revenue you need, or ${money(r.rentPerClientHour, { cents: true })} of every client hour.`
      : 'No rent was entered, so rent adds nothing.',
    'Per client hour = required revenue ÷ client hours. This is what each hour with a client has to bring in, because admin, cleaning and marketing hours don’t earn on their own.',
  ];
  return {
    primary: { value: money(r.perClientHour, { cents: true }), label: 'Required revenue per client hour' },
    cards, method,
    insight: `A ${length(r.exampleServiceMinutes)} service should generate approximately ${money(r.exampleServiceRevenue)} before service-specific costs.`,
    share: { value: `${money(r.perClientHour)}/hr`, label: 'What my client time is worth', insight: 'Every client hour has to cover the hours spent on everything else.' },
  };
}

mountCalculator({
  readExtra: (root) => ({ values: { payType: payTypeOf(root) }, errors: {} }),
  printExtra: (root) => (root.dataset.type === 'employee' ? [['How you are paid', PAY_NAMES[payTypeOf(root)]]] : []),
  compute({ values: v, type }) {
    const schedule = {
      workingWeeksPerYear: v.workingWeeksPerYear, workingDaysPerWeek: v.workingDaysPerWeek, hoursPerDay: v.hoursPerDay,
      nonClientHoursPerDay: v.nonClientHoursPerDay, taxRate: toRate(v.taxRate), exampleServiceMinutes: v.exampleServiceMinutes || 120,
    };
    if (type === 'employee') {
      const r = calculateEmployeeEarnings({
        ...schedule, desiredAnnualIncome: v.desiredAnnualIncome, payType: v.payType, monthlyTips: v.monthlyTips,
        commissionRate: toRate(v.commissionRate), baseHourlyWage: v.baseHourlyWage,
      });
      return r.ok ? { ok: true, raw: r, view: employeeView(v, r) } : r;
    }
    const r = calculateHourlyRate({ ...schedule, desiredAnnualIncome: v.desiredAnnualIncome, monthlyRent: v.monthlyRent, annualExpenses: v.annualExpenses });
    return r.ok ? { ok: true, raw: r, view: ownerView(v, r) } : r;
  },
});
