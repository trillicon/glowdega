// Working time: how many hours a year are available, and how many of those are with clients; clients a revenue goal takes.
import { guard } from './validation.js';

export const WEEKS_PER_YEAR = 52;
export const WEEKS_PER_MONTH = 52 / 12;

export function workingHours({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay = 0 }) {
  const clientHoursPerDay = hoursPerDay - nonClientHoursPerDay;
  const days = workingDaysPerWeek * workingWeeksPerYear;
  return { clientHoursPerDay, annualHours: hoursPerDay * days, annualClientHours: clientHoursPerDay * days, annualDays: days };
}

// ---------- Capacity & Clients ----------

export const DEFAULT_WORKING_DAYS_PER_MONTH = 20;
/** The average service lengths the calculator offers: 60 or 90 minutes. */
export const SERVICE_LENGTHS = [60, 90];

/**
 * Five average tickets around yours for the scenario table: yours, two below and two above, in steps of about 20%
 * of your ticket (rounded to $5 once the step is $5 or more, else to $1). Only prices above $0 are kept.
 */
export function scenarioTickets(ticket) {
  if (!(ticket > 0) || !Number.isFinite(ticket)) return [];
  const raw = ticket * 0.2;
  const step = raw >= 5 ? Math.round(raw / 5) * 5 : Math.max(1, Math.round(raw));
  return [-2, -1, 0, 1, 2].map((k) => ticket + k * step).filter((t) => t > 0);
}

const wholeUp = (x) => Math.max(0, Math.ceil(x - 1e-9));

/**
 * Clients needed for a monthly revenue goal.
 *   clients a month = revenue goal ÷ average ticket            (shown rounded up: you can't book part of a client)
 *   a week          = clients a month ÷ 4.33 weeks
 *   a day           = clients a month ÷ working days a month
 *   working hours   = clients a month × average service length (60 or 90 minutes) ÷ 60   (time with clients)
 * Optional current numbers: current revenue = current clients × current ticket (your average ticket when blank).
 */
export function calculateCapacity({ revenueGoal, averageTicket, workingDaysPerMonth = DEFAULT_WORKING_DAYS_PER_MONTH, serviceMinutes = 60,
  currentClients = 0, currentTicket = 0 }) {
  const errors = guard([
    ['revenueGoal', revenueGoal, (v) => v > 0, 'Enter a monthly revenue goal greater than $0.'],
    ['averageTicket', averageTicket, (v) => v > 0, 'Enter an average service price greater than $0.'],
    ['workingDaysPerMonth', workingDaysPerMonth, (v) => v > 0 && v <= 31, 'Enter working days per month between 1 and 31.'],
    ['serviceMinutes', serviceMinutes, (v) => v > 0 && v <= 1440, 'Choose an average service length.'],
    ['currentClients', currentClients, (v) => v >= 0, 'Enter current monthly clients of 0 or more.'],
    ['currentTicket', currentTicket, (v) => v >= 0, 'Enter a current average ticket of $0 or more.'],
  ]);
  if (Object.keys(errors).length) return { ok: false, errors };
  const clients = revenueGoal / averageTicket;
  const hoursPerClient = serviceMinutes / 60;
  const clientsWhole = wholeUp(clients);
  const scenarios = scenarioTickets(averageTicket).map((ticket) => {
    const n = revenueGoal / ticket;
    return { ticket, clients: n, clientsWhole: wholeUp(n), hours: wholeUp(n) * hoursPerClient, yours: Math.abs(ticket - averageTicket) < 1e-9 };
  });
  let current = null;
  if (currentClients > 0) {
    const ticket = currentTicket > 0 ? currentTicket : averageTicket;
    const revenue = currentClients * ticket;
    const neededAtTicket = wholeUp(revenueGoal / ticket);
    current = { clients: currentClients, ticket, ticketEntered: currentTicket > 0, revenue, share: revenue / revenueGoal,
      revenueGap: Math.max(0, revenueGoal - revenue), goalMet: revenue + 0.005 >= revenueGoal,
      neededAtTicket, moreClients: Math.max(0, neededAtTicket - Math.ceil(currentClients - 1e-9)) };
  }
  return {
    ok: true, revenueGoal, averageTicket, clients, clientsWhole,
    clientsPerWeek: clients / WEEKS_PER_MONTH, clientsPerDay: clients / workingDaysPerMonth,
    serviceMinutes, hoursPerMonth: clientsWhole * hoursPerClient, hoursPerDay: (clientsWhole * hoursPerClient) / workingDaysPerMonth,
    hoursPerWeek: (clientsWhole * hoursPerClient) / WEEKS_PER_MONTH, workingDaysPerMonth, scenarios, current,
  };
}
