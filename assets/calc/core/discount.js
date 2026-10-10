// Discounts and promotions. Pure; rates are fractions.
import { guard } from './validation.js';
import { serviceCostParts, profitAt } from './costs.js';
import { MIN_PROFIT_MARGIN, marginTone, belowMinimumMargin } from './pricing.js';

const EPS = 1e-9;
const CENT = 0.005;

/**
 * What a discount costs one service. Costs come from serviceCostParts: products, other overhead, the rent share for the
 * service time and labor are the same at any price; commission and card fees are shares of the price actually charged.
 *   sale price             = regular price × (1 − discount)
 *   profit at price P      = P × (1 − commission − processing) − fixed cost per service
 *   profit lost            = profit before − profit after;   reduction % = profit lost ÷ profit before
 *   break-even discount    = 1 − (fixed cost ÷ (1 − commission − processing)) ÷ regular price      profit = $0, labor paid
 *   max target discount    = 1 − (fixed cost ÷ (1 − commission − processing − target margin)) ÷ regular price
 * The target margin is at least 30% (MIN_PROFIT_MARGIN), like the Service Pricing Calculator. A discount of 100% or more
 * is rejected. When the regular price already misses a mark, that discount is 0 and the flag says so.
 */
export function calculateDiscount({ regularPrice, discountRate = 0, targetMargin = MIN_PROFIT_MARGIN, promoAppointments = 0, ...cost }) {
  const errors = guard([
    ['regularPrice', regularPrice, (v) => v > 0, 'Enter a regular service price greater than $0.'],
    ['discountRate', discountRate, (v) => v >= 0 && v < 1, 'Enter a discount below 100%.'],
    ['targetMargin', targetMargin, (v) => v >= MIN_PROFIT_MARGIN - EPS, 'Enter a profit margin of at least 30%.'],
    ['targetMargin', targetMargin, (v) => v < 1, 'Enter a profit margin below 100%.'],
    ['promoAppointments', promoAppointments, (v) => v >= 0, 'Enter promotional appointments of 0 or more.'],
  ]);
  const parts = serviceCostParts(cost);
  if (!parts.ok) Object.assign(errors, parts.errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  if (parts.priceRate + targetMargin >= 1 - EPS) {
    const message = 'Payment processing, commission and profit margin together must be below 100% of the price.';
    return { ok: false, errors: { targetMargin: message, ...(parts.commissionRate > 0 ? { commissionRate: message } : {}) } };
  }
  const keep = 1 - parts.priceRate;
  const salePrice = regularPrice * (1 - discountRate);
  const before = profitAt(parts, regularPrice);
  const after = profitAt(parts, salePrice);
  const profitLost = before.profit - after.profit;
  const breakEvenSalePrice = parts.fixedPerService / keep;
  const targetSalePrice = parts.fixedPerService / (keep - targetMargin);
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const breakEvenDiscount = clamp(1 - breakEvenSalePrice / regularPrice);
  const targetDiscount = clamp(1 - targetSalePrice / regularPrice);
  let status;
  if (discountRate < EPS) status = 'none';
  else if (after.profit < -CENT) status = 'loss';
  else if (after.profit <= CENT) status = 'even';
  else if (after.margin >= targetMargin - EPS) status = 'target';
  else status = 'below-target';
  const n = promoAppointments;
  return {
    ok: true, ...parts, regularPrice, discountRate, targetMargin, salePrice, discountAmount: regularPrice - salePrice,
    before, after, profitLost, reductionRate: before.profit > CENT ? profitLost / before.profit : 0, regularProfitable: before.profit > CENT,
    breakEvenSalePrice, breakEvenDiscount, targetSalePrice, targetDiscount, regularMeetsTarget: before.margin >= targetMargin - EPS,
    status,
    // tone: no discount → the full price's margin (orange if it misses the target); a discount that keeps the target →
    // the sale price's margin; below target, break-even or a loss → 'warn'
    tone: status === 'none' ? (before.profit > CENT && before.margin >= targetMargin - EPS ? marginTone(before.margin) : 'warn')
      : status === 'target' ? marginTone(after.margin) : 'warn',
    afterBelowMinimum: belowMinimumMargin(after.profit, after.margin), beforeBelowMinimum: belowMinimumMargin(before.profit, before.margin),
    promo: n > 0 ? {
      appointments: n, revenueWithout: regularPrice * n, revenueWith: salePrice * n,
      profitWithout: before.profit * n, profitWith: after.profit * n, profitDifference: (after.profit - before.profit) * n,
      // extra full-price-profit appointments it would take to earn back what the promotion gives away
      appointmentsToRecover: before.profit > CENT ? Math.ceil((profitLost * n) / before.profit - EPS) : 0,
    } : null,
  };
}
