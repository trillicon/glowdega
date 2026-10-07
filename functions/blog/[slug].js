// /blog/<slug>: archived posts are static files; anything else is looked up among posts approved in /admin.
import { asset, archiveSlugs, allPosts, notFound, htmlHeaders } from '../_lib/posts.js';
import { articlePage, relatedPosts } from '../_lib/site.js';

export async function onRequestGet({ request, env, params }) {
  const slug = params.slug;
  if (slug.endsWith('.html')) return env.ASSETS.fetch(request);
  if ((await archiveSlugs(env, request)).has(slug)) return env.ASSETS.fetch(request);

  const posts = await allPosts(env, request);
  const i = posts.findIndex((p) => p.live && p.slug === slug);
  if (i === -1) return notFound(env, request);

  const tpl = await (await asset(env, request, '/assets/templates/article.html')).text();
  const body = articlePage(tpl, posts[i], relatedPosts(posts[i], posts));
  return new Response(body, { headers: htmlHeaders() });
}
