// POST /api/drafts — where AI-written drafts enter the review queue.
// Auth: `Authorization: Bearer <DRAFTS_TOKEN>` (a Pages secret). Drafts are never published from here.
//
// Body (JSON): { title, body_md, excerpt?, category?, tags?, hero_image?, slug?, source? }
// category: one of the names in assets/taxonomy.json; tags: a list of short names.
import { handle, json, readJson, cleanFields, freeSlug, checkSlug, requireDb, nowIso, HttpError, tokenMatches } from '../_lib/db.js';
import { taxonomy } from '../_lib/posts.js';

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await tokenMatches(given, env.DRAFTS_TOKEN))) throw new HttpError(401, 'Invalid or missing drafts token.');

  const input = await readJson(request);
  const fields = cleanFields(input, { requireAll: true, categories: await taxonomy(env, request) });
  let slug;
  if (fields.slug) { await checkSlug(context, fields.slug); slug = fields.slug; } else slug = await freeSlug(context, fields.title);

  const id = crypto.randomUUID();
  const now = nowIso();
  await requireDb(env).prepare(
    `INSERT INTO posts (id, slug, title, excerpt, category, tags, hero_image, body_md, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(id, slug, fields.title, fields.excerpt || '', fields.category || '', fields.tags || '[]', fields.hero_image || '',
    fields.body_md, fields.source || 'api', now, now).run();

  const origin = new URL(request.url).origin;
  return json({ id, slug, status: 'draft', review_url: `${origin}/admin/#${id}` }, 201);
});
