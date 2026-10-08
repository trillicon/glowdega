import { mountCalculator } from '../ui/framework.js';
import { calculateHourlyRate } from '../core/pricing.js';
import { formatMoney as money, formatNumber } from '../core/money.js';
import { toRate, formatPercent } from '../core/percentages.js';

const length = (min) => (min % 60 === 0 ? `${min / 60}-hour` : `${formatNumber(min, 0)}-minute`);

mountCalculator({
  compute({ values: v, type }) {
    const employee = type === 'employee';
    const r = calculateHourlyRate({
      desiredAnnualIncome: v.desiredAnnualIncome, workingWeeksPerYear: v.workingWeeksPerYear, workingDaysPerWeek: v.workingDaysPerWeek,
      hoursPerDay: v.hoursPerDay, nonClientHoursPerDay: v.nonClientHoursPerDay, annualExpenses: employee ? 0 : v.annualExpenses,
      taxRate: toRate(v.taxRate), exampleServiceMinutes: v.exampleServiceMinutes || 120,
    });
    if (!r.ok) return r;
    const what = employee ? 'earnings' : 'revenue';
    const cards = [
      { label: `Required annual ${what}`, value: money(r.annualRevenue) },
      { label: `Required monthly ${what}`, value: money(r.monthlyRevenue) },
      { label: `Required ${what} per working hour`, value: money(r.perWorkingHour, { cents: true }), note: `${formatNumber(r.annualHours, 0)} working hours a year` },
      { label: `Required ${what} per client hour`, value: money(r.perClientHour, { cents: true }), note: `${formatNumber(r.annualClientHours, 0)} client hours a year` },
      { label: 'Estimated taxes', value: money(r.estimatedTaxes), note: `At ${formatPercent(toRate(v.taxRate), 1)}` },
    ];
    const insight = employee
      ? `A ${length(r.exampleServiceMinutes)} service should earn you approximately ${money(r.exampleServiceRevenue)} before tax, from wages, commission and tips combined.`
      : `A ${length(r.exampleServiceMinutes)} service should generate approximately ${money(r.exampleServiceRevenue)} before service-specific costs.`;
    const method = [
      `Client hours a day: ${formatNumber(v.hoursPerDay)} working hours − ${formatNumber(v.nonClientHoursPerDay)} non-client hours = ${formatNumber(r.clientHoursPerDay)}.`,
      `Client hours a year: ${formatNumber(r.clientHoursPerDay)} × ${formatNumber(v.workingDaysPerWeek)} days × ${formatNumber(v.workingWeeksPerYear)} weeks = ${formatNumber(r.annualClientHours, 0)}.`,
      `Before-tax income: ${money(v.desiredAnnualIncome)} ÷ (1 − ${formatPercent(toRate(v.taxRate), 1)} tax) = ${money(r.preTaxIncome)}. Your desired income is treated as what you keep after estimated income tax.`,
      employee
        ? `Required annual earnings = before-tax income (${money(r.annualRevenue)}). Employees don't pay the business's expenses, so none are added.`
        : `Required annual revenue = before-tax income + ${money(v.annualExpenses)} business expenses = ${money(r.annualRevenue)}. Expenses are paid before income tax, so they aren't taxed.`,
      `Per client hour = required ${what} ÷ client hours. This is what each hour with a client has to bring in, because admin, cleaning and marketing hours don't earn on their own.`,
    ];
    return {
      ok: true, raw: r,
      view: {
        primary: { value: money(r.perClientHour, { cents: true }), label: `Required ${what} per client hour` },
        cards, insight, method,
        share: { value: `${money(r.perClientHour)}/hr`, label: 'What my client time is worth', insight: 'Every client hour has to cover the hours spent on everything else.' },
      },
    };
  },
});
