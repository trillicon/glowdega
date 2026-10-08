// Working time: how many hours a year are available, and how many of those are with clients.
export const WEEKS_PER_YEAR = 52;
export const WEEKS_PER_MONTH = 52 / 12;

export function workingHours({ workingWeeksPerYear, workingDaysPerWeek, hoursPerDay, nonClientHoursPerDay = 0 }) {
  const clientHoursPerDay = hoursPerDay - nonClientHoursPerDay;
  const days = workingDaysPerWeek * workingWeeksPerYear;
  return { clientHoursPerDay, annualHours: hoursPerDay * days, annualClientHours: clientHoursPerDay * days, annualDays: days };
}
