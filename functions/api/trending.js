// /api/trending — the home page order, most trending first, written weekly by the drafts job.
// PUT (Authorization: Bearer <DRAFTS_TOKEN>): { ranked: [slug, ...], terms?: [{ term, score }], generated?: "YYYY-MM-DD" }
// GET: the stored ranking (public; it is only an order of public posts and search terms).
// Stored in D1, so a new order is live immediately without a deploy.
import { handle, json, readJson, requireDb, nowIso, HttpError, tokenMatches } from '../_lib/db.js';
import { HOME_RANKING, settingsTable, homeRanking } from '../_lib/posts.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const onRequestPut = handle(async ({ request, env }) => {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await tokenMatches(given, env.DRAFTS_TOKEN))) throw new HttpError(401, 'Invalid or missing drafts token.');
  const input = await readJson(request);
  const ranked = Array.isArray(input.ranked) ? [...new Set(input.ranked)] : [];
  if (!ranked.length || ranked.length > 1000 || !ranked.every((s) => typeof s === 'string' && SLUG.test(s))) {
    throw new HttpError(400, 'ranked must be 1–1000 post slugs.');
  }
  const terms = (Array.isArray(input.terms) ? input.terms : []).slice(0, 50)
    .filter((t) => t && typeof t.term === 'string' && t.term.length <= 120)
    .map((t) => ({ term: t.term, score: Number(t.score) || 0 }));
  const generated = /^\d{4}-\d{2}-\d{2}$/.test(input.generated || '') ? input.generated : nowIso().slice(0, 10);
  const value = JSON.stringify({ ranked, terms, generated });

  const db = requireDb(env);
  await settingsTable(db);
  await db.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(HOME_RANKING, value, nowIso()).run();
  return json({ ok: true, ranked: ranked.length, terms: terms.length, generated });
});

export const onRequestGet = handle(async ({ request, env }) => json(await homeRanking(env, request)));
