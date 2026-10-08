// Spreading monthly business expenses across appointments.

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
