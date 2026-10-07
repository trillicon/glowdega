// /blog/<slug>: archived posts are static files; anything else is looked up among posts approved in /admin.
import { asset, archive, archiveSlugs, allPosts, livePosts, notFound, htmlHeaders } from '../_lib/posts.js';
import { articlePage, card } from '../_lib/site.js';

export async function onRequestGet({ request, env, params }) {
  const slug = params.slug;
  if (slug.endsWith('.html')) return env.ASSETS.fetch(request);
  if ((await archiveSlugs(env, request)).has(slug)) {
    const page = await env.ASSETS.fetch(request);
    // The newest archived post links forward to the oldest post published from /admin.
    if ((await archive(env, request))[0].slug !== slug) return page;
    const live = await livePosts(env);
    if (!live.length) return page;
    return new HTMLRewriter()
      .on('.post-grid--pair', { element(el) { el.prepend(card(live[live.length - 1], 'Newer'), { html: true }); } })
      .transform(new Response(page.body, { status: page.status, headers: htmlHeaders() }));
  }

  const posts = await allPosts(env, request);
  const i = posts.findIndex((p) => p.live && p.slug === slug);
  if (i === -1) return notFound(env, request);

  const tpl = await (await asset(env, request, '/assets/templates/article.html')).text();
  const body = articlePage(tpl, posts[i], { newer: posts[i - 1], older: posts[i + 1] });
  return new Response(body, { headers: htmlHeaders() });
}
