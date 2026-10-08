// Input validation shared by every calculator. Pure: no DOM access.
// A rule describes one field: { name: 'a service price', unit: 'money'|'percent'|'minutes'|'hours'|'number',
//   required, min (default 0), minExclusive, max, maxExclusive, integer }.
import { isFiniteNumber } from './money.js';

const show = (v, unit) => (unit === 'money' ? `$${v.toLocaleString('en-US')}` : unit === 'percent' ? `${v}%` : v.toLocaleString('en-US'));
const NUMERIC = /^-?(\d+(\.\d*)?|\.\d+)$/;

/**
 * Parse what the user typed. Accepts "1,250", "$1,250" and "20%". Blank optional fields count as 0; blank required
 * fields, non-numbers and out-of-range values return an error message written for the user.
 */
export function parseNumber(raw, rule = {}) {
  const name = rule.name || 'a value';
  const unit = rule.unit || 'number';
  const min = isFiniteNumber(rule.min) ? rule.min : 0;
  const s = String(raw ?? '').trim().replace(/[\s,$%]/g, '');
  if (s === '') {
    if (!rule.required) return { ok: true, value: 0, blank: true };
    return { ok: false, error: rule.minExclusive ? `Enter ${name} greater than ${show(min, unit)}.` : `Enter ${name}.` };
  }
  if (!NUMERIC.test(s)) return { ok: false, error: `Enter ${name} as a number, using digits only.` };
  const value = Number(s);
  if (!isFiniteNumber(value)) return { ok: false, error: `Enter ${name} as a number, using digits only.` };
  if (rule.minExclusive ? value <= min : value < min) {
    return { ok: false, error: rule.minExclusive ? `Enter ${name} greater than ${show(min, unit)}.` : `Enter ${name} of ${show(min, unit)} or more.` };
  }
  if (isFiniteNumber(rule.max) && (rule.maxExclusive ? value >= rule.max : value > rule.max)) {
    return { ok: false, error: rule.maxExclusive ? `Enter ${name} below ${show(rule.max, unit)}.` : `Enter ${name} of ${show(rule.max, unit)} or less.` };
  }
  if (rule.integer && !Number.isInteger(value)) return { ok: false, error: `Enter ${name} as a whole number.` };
  return { ok: true, value, blank: false };
}

/** Validate a set of fields: rules = { field: rule }, raw = { field: string }. */
export function validateFields(rules, raw) {
  const values = {}, errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const r = parseNumber(raw[field], rule);
    if (r.ok) values[field] = r.value; else errors[field] = r.error;
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** Percent rule: 0 up to (not including) 100%. Rates of 100% or more make the formulas divide by zero. */
export const percentRule = (name, extra = {}) => ({ name, unit: 'percent', min: 0, max: 100, maxExclusive: true, ...extra });

/** Engine-side guard: each entry is [field, value, test, message]; returns { field: message } for failures. */
export function guard(checks) {
  const errors = {};
  for (const [field, value, test, message] of checks) {
    if (!isFiniteNumber(value) || !test(value)) errors[field] = errors[field] || message;
  }
  return errors;
}

/** True if any value in a (nested) result is NaN, ±Infinity or undefined. Used by tests and the result renderer. */
export function hasBadNumber(obj) {
  if (obj === undefined) return true;
  if (typeof obj === 'number') return !Number.isFinite(obj);
  if (obj && typeof obj === 'object') return Object.values(obj).some(hasBadNumber);
  return false;
}
