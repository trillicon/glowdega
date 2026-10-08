// GET /api/admin/ads/terms — categories and tags an ad can target, with how many posts use each.
// From assets/posts.json (the archive) plus the categories of posts published from the admin.
import { handle, json } from '../../../_lib/db.js';
import { archive, livePosts } from '../../../_lib/posts.js';
import { termSlug } from '../../../_lib/site.js';

export function collectTerms(archivePosts, live) {
  const terms = new Map();
  const add = (slug, name, kind, seen) => {
    if (!slug) return;
    const t = terms.get(slug) || { slug, name, kinds: [], count: 0 };
    if (!t.kinds.includes(kind)) t.kinds.push(kind);
    if (kind === 'category') t.name = name;           // category names are capitalised; prefer them
    if (!seen.has(slug)) { seen.add(slug); t.count++; }
    terms.set(slug, t);
  };
  for (const p of archivePosts) {
    const seen = new Set();
    for (const c of p.categories || []) add(c.slug, c.name, 'category', seen);
    for (const t of p.tags || []) add(t.slug, t.name, 'tag', seen);
  }
  for (const p of live) add(termSlug(p.category), p.category, 'category', new Set());
  return [...terms.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const onRequestGet = handle(async ({ request, env }) => {
  const [arch, live] = await Promise.all([archive(env, request), livePosts(env)]);
  return json({ terms: collectTerms(arch, live) });
});
