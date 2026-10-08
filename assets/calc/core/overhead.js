// Spreading monthly business expenses across appointments, and rent across the hours you work.
import { guard } from './validation.js';

/** Hours a month rent is spread over when nobody says otherwise: 40 hours × 4 weeks. */
export const DEFAULT_HOURS_PER_MONTH = 160;
export const MAX_HOURS_PER_MONTH = 744; // every hour of a 31-day month

/**
 * Overhead carried by one appointment: monthly overhead / monthly appointments.
 * Returns 0 when there is no overhead, and null when there is overhead but no appointments to carry it
 * (the caller must ask for the appointment count rather than divide by zero).
 */
export function allocateOverhead(monthlyOverhead, monthlyAppointments) {
  if (!(monthlyOverhead > 0)) return 0;
  if (!(monthlyAppointments > 0)) return null;
  return monthlyOverhead / monthlyAppointments;
}

/**
 * Rent carried by one service, by the time it takes:
 *   rent per hour = monthly rent ÷ hours worked per month
 *   rent share    = rent per hour × service hours
 * $2,000 rent, 160 hours, a 90-minute facial → $12.50/hour × 1.5 = $18.75.
 * Hours per month must be above 0 even when rent is $0, so a bad entry never hides behind a blank rent.
 */
export function allocateRent({ monthlyRent = 0, hoursPerMonth = DEFAULT_HOURS_PER_MONTH, durationMinutes = 0 }) {
  const errors = guard([
    ['monthlyRent', monthlyRent, (v) => v >= 0, 'Enter monthly rent of $0 or more.'],
    ['hoursPerMonth', hoursPerMonth, (v) => v > 0 && v <= MAX_HOURS_PER_MONTH, 'Enter the hours you work per month: more than 0 and no more than 744.'],
    ['durationMinutes', durationMinutes, (v) => v >= 0, 'Enter a service duration of 0 minutes or more.'],
  ]);
  if (Object.keys(errors).length) return { ok: false, errors };
  const rentPerHour = monthlyRent / hoursPerMonth;
  return { ok: true, rentPerHour, rentShare: rentPerHour * (durationMinutes / 60) };
}
