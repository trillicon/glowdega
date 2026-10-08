import { mountCalculator } from '../ui/framework.js';
import { calculateCapacity } from '../core/capacity.js';
import { formatMoney as money, formatNumber } from '../core/money.js';
import { formatPercent } from '../core/percentages.js';
import { serviceText } from '../ui/professions.js';

const minutesOf = (root) => Number(root?.querySelector('input[name="serviceMinutes"]:checked')?.value || 60);
const plural = (n, one, many) => `${formatNumber(n, 0)} ${n === 1 ? one : many}`;

/** The scenario table (ticket → clients and hours), built from the engine's rows. Display only. */
function scenarioTable(r) {
  const wrap = document.createElement('div');
  wrap.className = 'calc-table-wrap';
  const t = document.createElement('table');
  t.className = 'calc-table';
  t.createCaption().textContent = `What ${money(r.revenueGoal)} a month takes at different average tickets`;
  const head = t.createTHead().insertRow();
  for (const h of ['Average ticket', 'Clients a month', 'Hours with clients']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.append(th); }
  const body = t.createTBody();
  for (const s of r.scenarios) {
    const row = body.insertRow();
    if (s.yours) row.className = 'is-yours';
    row.insertCell().textContent = money(s.ticket) + (s.yours ? ' (yours)' : '');
    row.insertCell().textContent = formatNumber(s.clientsWhole, 0);
    row.insertCell().textContent = formatNumber(s.hours, 0);
  }
  wrap.append(t);
  return wrap;
}

export const config = mountCalculator({
  readExtra: (root) => ({ values: { serviceMinutes: minutesOf(root) }, errors: {} }),
  printExtra: (root) => [['Average service length', `${minutesOf(root)} minutes`]],
  compute({ values: v, type, profession }) {
    const r = calculateCapacity({ revenueGoal: v.revenueGoal, averageTicket: v.averageTicket, workingDaysPerMonth: v.workingDaysPerMonth,
      serviceMinutes: v.serviceMinutes || 60, currentClients: v.currentClients, currentTicket: v.currentTicket });
    if (!r.ok) return r;
    const employee = type === 'employee';
    const service = serviceText(profession, r.serviceMinutes);
    const goalWord = employee ? 'service revenue goal' : 'revenue goal';
    const cards = [
      { label: 'Clients a week', value: formatNumber(r.clientsPerWeek, 1) },
      { label: 'Clients a day', value: formatNumber(r.clientsPerDay, 1), note: `Over ${plural(r.workingDaysPerMonth, 'working day', 'working days')} a month` },
      { label: 'Working hours with clients', value: `${formatNumber(r.hoursPerMonth, 0)} a month`, note: `About ${formatNumber(r.hoursPerDay, 1)} a day at ${r.serviceMinutes} minutes each` },
      { label: 'Average ticket', value: money(r.averageTicket) },
    ];
    let insight = `To reach ${money(r.revenueGoal)} a month at a ${money(r.averageTicket)} average ticket, you need about ${plural(r.clientsWhole, 'client', 'clients')} a month, or ${formatNumber(r.clientsPerDay, 1)} a day.`;
    if (r.hoursPerDay > 10) insight += ` That is more than 10 hours with clients a day, so a higher average ticket may be easier to reach than more bookings.`;
    const c = r.current;
    if (c) {
      cards.push({ label: 'Revenue now', value: money(c.revenue), note: `${plural(c.clients, 'client', 'clients')} × ${money(c.ticket)}${c.ticketEntered ? '' : ' (your average service price)'}` });
      if (c.goalMet) {
        cards.push({ label: 'Goal', value: 'Met', note: `${formatPercent(c.share)} of your ${goalWord}` });
        insight += ` Your current ${plural(c.clients, 'client', 'clients')} already bring in ${money(c.revenue)}, which meets it.`;
      } else {
        cards.push({ label: 'Clients to add', value: formatNumber(c.moreClients, 0), note: `${money(c.revenueGap)} short, at ${money(c.ticket)} a visit` });
        insight += ` You are at ${formatPercent(c.share)} of your goal now: about ${plural(c.moreClients, 'more client', 'more clients')} a month at ${money(c.ticket)} closes the gap.`;
      }
    }
    const method = [
      `Clients a month = ${money(r.revenueGoal)} ${goalWord} ÷ ${money(r.averageTicket, { cents: true })} average ticket = ${formatNumber(r.clients, 2)}, rounded up to ${formatNumber(r.clientsWhole, 0)} (you can’t book part of a client).`,
      `A week = clients a month ÷ 4.33 weeks; a day = clients a month ÷ ${plural(r.workingDaysPerMonth, 'working day', 'working days')}.`,
      `Working hours with clients = ${formatNumber(r.clientsWhole, 0)} clients × ${r.serviceMinutes} minutes = ${formatNumber(r.hoursPerMonth, 1)} hours a month. Set-up, admin and breaks are on top of this.`,
      'The table repeats the same goal at average tickets about 20% apart, around yours, so you can see what a higher ticket saves in bookings.',
    ];
    if (c) method.push(`Revenue now = ${formatNumber(c.clients, 0)} clients × ${money(c.ticket, { cents: true })} = ${money(c.revenue)}. Clients to add = clients your goal takes at that ticket (${formatNumber(c.neededAtTicket, 0)}) − clients now.`);
    method.push(employee ? 'This plans the services you perform. Your pay depends on how you are paid; the Profit & Take-Home Calculator shows it.'
      : 'This plans bookings only. Rent, pay and other costs are covered by the Break-Even and Profit & Take-Home calculators.');
    return {
      ok: true, raw: r,
      view: {
        primary: { value: formatNumber(r.clientsWhole, 0), label: `Clients a month to reach your ${goalWord}` },
        cards, insight, method,
        extraNode: () => scenarioTable(r),
        share: { value: formatNumber(r.clientsWhole, 0), label: `clients a month to reach ${money(r.revenueGoal)}`,
          insight: `Every revenue goal is a number of bookings. Know how many ${service.phrase} appointments yours takes.` },
      },
    };
  },
});
