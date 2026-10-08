// PUT /api/admin/terms/:slug  { category, tags } — re-file a post. Archive posts get a row in post_terms (applied when
// they are served); posts written in /admin are updated in place. DELETE /api/admin/terms/:slug puts an archive post
// back to its built-in category and tags.
import { handle, json, readJson, requireDb, cleanCategory, cleanTags, nowIso, HttpError } from '../../../_lib/db.js';
import { archive, taxonomy } from '../../../_lib/posts.js';

export const onRequestPut = handle(async ({ request, env, params }) => {
  const body = await readJson(request);
  const db = requireDb(env);
  const [arch, cats] = await Promise.all([archive(env, request), taxonomy(env, request)]);
  const category = cleanCategory(body.category, cats);
  if (!category) throw new HttpError(400, 'Pick a category.');
  const tags = cleanTags(body.tags ?? []);
  const slug = String(params.slug);
  const now = nowIso();
  if (arch.some((p) => p.slug === slug)) {
    await db.prepare(`INSERT INTO post_terms (slug, category, tags, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET category = excluded.category, tags = excluded.tags, updated_at = excluded.updated_at`)
      .bind(slug, category, JSON.stringify(tags), now).run();
    return json({ post: { kind: 'archive', slug, category, tags, refiled: true } });
  }
  const row = await db.prepare('SELECT id FROM posts WHERE slug = ?').bind(slug).first();
  if (!row) throw new HttpError(404, 'Post not found.');
  await db.prepare('UPDATE posts SET category = ?, tags = ?, updated_at = ? WHERE id = ?').bind(category, JSON.stringify(tags), now, row.id).run();
  return json({ post: { kind: 'admin', id: row.id, slug, category, tags } });
});

export const onRequestDelete = handle(async ({ env, params }) => {
  await requireDb(env).prepare('DELETE FROM post_terms WHERE slug = ?').bind(String(params.slug)).run();
  return json({ reset: String(params.slug) });
});
