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

/**
 * Margin → "19.6%" / "30%". One decimal, cut toward zero (never rounded up), so a margin shown next to the
 * 30% and 50% lines is never displayed on the wrong side of them (29.96% → "29.9%", not "30%").
 */
export function formatMargin(rate) {
  if (!isFiniteNumber(rate)) return '—';
  const tenths = Math.trunc(Math.round(rate * 1e7) / 1e4); // round off float noise first (0.3 * 1000 = 299.999…)
  return `${(tenths / 10 + 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}
