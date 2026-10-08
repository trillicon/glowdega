// GET /api/admin/terms — every post (archive + written in /admin) with its category and tags, for the Categories tab
// and the post editor: { categories: [{slug, name, description?, count}], tags: [{name, slug, count}], posts: [...] }.
import { handle, json, requireDb, state, nowIso } from '../../../_lib/db.js';
import { archiveWithTerms, taxonomy } from '../../../_lib/posts.js';
import { termSlug, tagNames } from '../../../_lib/site.js';

export function termsListing(arch, rows, cats, now = nowIso()) {
  const posts = [
    ...arch.map((p) => ({ kind: 'archive', slug: p.slug, title: p.title, date: p.date, category: p.category,
      tags: tagNames(p), refiled: !!p.refiled, state: 'published' })),
    ...rows.map((p) => ({ kind: 'admin', id: p.id, slug: p.slug, title: p.title, date: p.publish_at || p.created_at,
      category: p.category, tags: tagNames(p), state: state(p, now) })),
  ];
  const count = new Map();
  const tags = new Map();
  for (const p of posts) {
    count.set(p.category, (count.get(p.category) || 0) + 1);
    for (const t of p.tags) {
      const slug = termSlug(t);
      const x = tags.get(slug) || { slug, name: t, count: 0 };
      x.count++;
      tags.set(slug, x);
    }
  }
  return {
    categories: cats.map((c) => ({ ...c, count: count.get(c.name) || 0 })),
    tags: [...tags.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    posts,
  };
}

export const onRequestGet = handle(async ({ request, env }) => {
  const [arch, cats, { results }] = await Promise.all([archiveWithTerms(env, request), taxonomy(env, request),
    requireDb(env).prepare('SELECT id, slug, title, category, tags, status, publish_at, created_at FROM posts ORDER BY created_at DESC').all()]);
  return json(termsListing(arch, results || [], cats));
});
