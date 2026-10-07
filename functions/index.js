// /: the static home page, with the 12 most popular posts including any approved in /admin.
import { asset, allPosts, livePosts, homeCards, htmlHeaders } from './_lib/posts.js';

export async function onRequestGet({ request, env }) {
  const page = await asset(env, request, '/');
  if (!(await livePosts(env)).length) return page;

  const posts = await allPosts(env, request);
  const popular = await (await asset(env, request, '/assets/popular.json')).json().catch(() => []);
  // "127 POSTS" in the grid header and "127 published posts" in the intro
  const count = () => ({ text(t) { if (/\d+ (POSTS|published posts)/.test(t.text)) t.replace(t.text.replace(/\d+/, String(posts.length))); } });
  return new HTMLRewriter()
    .on('.post-grid', { element(el) { el.setInnerContent(homeCards(posts, popular), { html: true }); } })
    .on('.grid-head span', count())
    .on('.hero-copy p', count())
    .on('meta[name="description"]', {
      element(el) { el.setAttribute('content', el.getAttribute('content').replace(/\d+ skincare posts/, `${posts.length} skincare posts`)); },
    })
    .transform(new Response(page.body, { headers: htmlHeaders() }));
}
