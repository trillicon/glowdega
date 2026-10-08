// Money helpers. Calculations keep full precision; these functions are only for display.
export const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Round to cents for display. Never feed the result back into a calculation. */
export function roundCurrency(value) {
  if (!isFiniteNumber(value)) return 0;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * "$1,250", "$142", "$68.50". Amounts of $100 or more show whole dollars; smaller amounts show cents unless they are
 * whole. Non-finite input shows an em dash, so NaN/Infinity can never reach the page. Negative amounts keep the sign;
 * use describeProfit() to label a loss in words.
 */
export function formatMoney(value, { cents: forceCents = false, whole: forceWhole = false, up = false } = {}) {
  if (!isFiniteNumber(value)) return '—';
  const r = roundCurrency(value);
  // up: a price to charge, rounded up to the dollar so the shown price never falls short of the target
  if (up) return whole.format(Math.ceil(r - 0.005)).replace('-$0', '$0');
  if (forceWhole) return whole.format(Math.round(value)).replace('-$0', '$0');
  if (forceCents) return cents.format(r);
  // whole dollars from the cent-rounded value, so float noise (727.4999…) can't turn $727.50 into $727
  if (Math.abs(r) >= 100 || Number.isInteger(r)) return whole.format(Math.round(r)).replace('-$0', '$0');
  return cents.format(r);
}

/** Profit, Loss or Break-even, with a positive amount, so the page says "Loss $42" instead of "-$42 profit". */
export function describeProfit(value) {
  if (!isFiniteNumber(value)) return { word: 'Profit', amount: 0, loss: false, even: false };
  if (Math.abs(value) < 0.005) return { word: 'Break-even', amount: 0, loss: false, even: true };
  return value < 0 ? { word: 'Loss', amount: -value, loss: true, even: false } : { word: 'Profit', amount: value, loss: false, even: false };
}

/** Plain number for display: "2.7", "47". */
export function formatNumber(value, digits = 1) {
  if (!isFiniteNumber(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function roundNumber(value, digits = 1) {
  if (!isFiniteNumber(value)) return 0;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
