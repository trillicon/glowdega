// /go/ad/:id — counts a click on a running ad and sends the reader to its link. Anything else goes home.
import { nowIso } from '../../_lib/db.js';

const go = (location) => new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

export async function onRequestGet({ request, env, params }) {
  const home = new URL('/', request.url).href;
  if (!env.DB || !/^\d{1,12}$/.test(String(params.id))) return go(home);
  const now = nowIso();
  try {
    const row = await env.DB.prepare(
      `UPDATE ads SET clicks = clicks + 1
        WHERE id = ? AND status = 'active' AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)
        RETURNING link_url`,
    ).bind(Number(params.id), now, now).first();
    if (row && /^https:\/\//i.test(row.link_url)) return go(row.link_url);
  } catch (err) {
    if (!/no such table/i.test(String(err))) console.error('ad click failed', err);
  }
  return go(home);
}
