// GET /api/admin/ads/terms — categories and tags an ad can target, with how many posts use each.
// Every approved category (assets/taxonomy.json), plus the tags of the archive (with the admin's re-filing applied)
// and of posts published from the admin.
import { handle, json } from '../../../_lib/db.js';
import { archiveWithTerms, livePosts, taxonomy } from '../../../_lib/posts.js';
import { termSlug, tagNames } from '../../../_lib/site.js';

export function collectTerms(archivePosts, live, categories = []) {
  const terms = new Map();
  const add = (slug, name, kind, seen) => {
    if (!slug) return;
    const t = terms.get(slug) || { slug, name, kinds: [], count: 0 };
    if (!t.kinds.includes(kind)) t.kinds.push(kind);
    if (kind === 'category') t.name = name;           // category names are capitalised; prefer them
    if (!seen.has(slug)) { seen.add(slug); t.count++; }
    terms.set(slug, t);
  };
  for (const c of categories) {
    terms.set(c.slug, { slug: c.slug, name: c.name, kinds: ['category'], count: 0 });
  }
  for (const p of archivePosts) {
    const seen = new Set();
    for (const c of p.categories || []) add(c.slug, c.name, 'category', seen);
    for (const t of p.tags || []) add(t.slug, t.name, 'tag', seen);
  }
  for (const p of live) {
    const seen = new Set();
    add(termSlug(p.category), p.category, 'category', seen);
    for (const t of tagNames(p)) add(termSlug(t), t, 'tag', seen);
  }
  return [...terms.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const onRequestGet = handle(async ({ request, env }) => {
  const [arch, live, cats] = await Promise.all([archiveWithTerms(env, request), livePosts(env), taxonomy(env, request)]);
  return json({ terms: collectTerms(arch, live, cats) });
});
