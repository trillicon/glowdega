// A margin shown beside the 30% / 50% lines must never be displayed on the wrong side of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMargin } from '../assets/calc/core/percentages.js';
import { calculateServiceProfitability } from '../assets/calc/core/profit.js';

test('formatMargin: one decimal, cut toward zero, float noise ignored', () => {
  for (const [rate, shown] of [[0.3, '30%'], [0.5, '50%'], [0.2996, '29.9%'], [0.4999, '49.9%'], [0.196, '19.6%'],
    [0.58335, '58.3%'], [0.07, '7%'], [0, '0%'], [-0.1966, '-19.6%'], [NaN, '—']]) {
    assert.equal(formatMargin(rate), shown, `${rate}`);
  }
});

test('a 29.6% margin is never shown as "30%" on the Service Profitability cards', async () => {
  globalThis.document ??= undefined;
  // price 100, labor 45 + rent 12.50 + product 9 + overhead 0.40 + processing 3.5 = 70.40 → 29.6%
  const r = calculateServiceProfitability({ price: 100, durationMinutes: 60, productCost: 9, supplyCost: 0, overhead: 0.4,
    monthlyRent: 2000, hoursPerMonth: 160, processingRate: 0.035, laborHourly: 45, commissionRate: 0, targetHourly: 0 });
  assert.ok(r.margin > 0.295 && r.margin < 0.3, `margin ${r.margin}`);
  assert.equal(r.status, 'below-minimum');
  assert.equal(formatMargin(r.margin), '29.6%');
  const src = (await import('node:fs')).readFileSync(new URL('../assets/calc/calculators/service-profitability.js', import.meta.url), 'utf8');
  assert.match(src, /label: 'Profit margin', value: [^\n]*formatMargin\(r\.margin\)/, 'margin card uses formatMargin');
});
