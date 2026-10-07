// POST /api/drafts — where AI-written drafts enter the review queue.
// Auth: `Authorization: Bearer <DRAFTS_TOKEN>` (a Pages secret). Drafts are never published from here.
//
// Body (JSON): { title, body_md, excerpt?, category?, hero_image?, slug?, source? }
import { handle, json, readJson, cleanFields, freeSlug, checkSlug, requireDb, nowIso, HttpError } from '../_lib/db.js';

async function tokenMatches(given, expected) {
  if (!expected || expected.length < 32) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await tokenMatches(given, env.DRAFTS_TOKEN))) throw new HttpError(401, 'Invalid or missing drafts token.');

  const input = await readJson(request);
  const fields = cleanFields(input, { requireAll: true });
  let slug;
  if (fields.slug) { await checkSlug(context, fields.slug); slug = fields.slug; } else slug = await freeSlug(context, fields.title);

  const id = crypto.randomUUID();
  const now = nowIso();
  await requireDb(env).prepare(
    `INSERT INTO posts (id, slug, title, excerpt, category, hero_image, body_md, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(id, slug, fields.title, fields.excerpt || '', fields.category || '', fields.hero_image || '',
    fields.body_md, fields.source || 'api', now, now).run();

  const origin = new URL(request.url).origin;
  return json({ id, slug, status: 'draft', review_url: `${origin}/admin/#${id}` }, 201);
});
