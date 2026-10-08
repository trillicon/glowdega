// Percent helpers. Users type percents (20); the engine works with rates (0.2).
import { isFiniteNumber } from './money.js';

export const toRate = (percent) => (isFiniteNumber(percent) ? percent / 100 : 0);

/** Rate → whole-number percent for display (0.687 → 69). */
export function roundPercent(rate, digits = 0) {
  if (!isFiniteNumber(rate)) return 0;
  const f = 10 ** digits;
  return Math.round(rate * 100 * f) / f;
}

/** Rate → "69%". */
export function formatPercent(rate, digits = 0) {
  if (!isFiniteNumber(rate)) return '—';
  return `${roundPercent(rate, digits).toLocaleString('en-US')}%`;
}
