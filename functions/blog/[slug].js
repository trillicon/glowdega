// /blog/<slug>: archived posts are static files; anything else is looked up among posts approved in /admin.
// Both get their ad slots filled per request (functions/_lib/ads.js), so article pages are not cached.
import { asset, archiveSlugs, allPosts, notFound, htmlHeaders } from '../_lib/posts.js';
import { articlePage, relatedPosts, postTerms } from '../_lib/site.js';
import { runningAds, fillSlots, adsFor, countView } from '../_lib/ads.js';

const NO_STORE = { 'cache-control': 'no-store' };

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const slug = params.slug;
  if (slug.endsWith('.html')) return env.ASSETS.fetch(request);
  const onView = (ad) => context.waitUntil(countView(env, ad));

  if ((await archiveSlugs(env, request)).has(slug)) {
    const [page, ads] = await Promise.all([asset(env, request, `/blog/${slug}`), runningAds(env)]);
    if (!page.ok) return page;
    const body = ads.length ? fillSlots(page, env, ads, { onView }).body : page.body;
    return new Response(body, { headers: htmlHeaders(NO_STORE) });
  }

  const posts = await allPosts(env, request);
  const i = posts.findIndex((p) => p.live && p.slug === slug);
  if (i === -1) return notFound(env, request);

  const [tpl, ads] = await Promise.all([
    asset(env, request, '/assets/templates/article.html').then((r) => r.text()), runningAds(env)]);
  const body = articlePage(tpl, posts[i], relatedPosts(posts[i], posts), adsFor(env, ads, postTerms(posts[i]), { onView }));
  return new Response(body, { headers: htmlHeaders(NO_STORE) });
}
