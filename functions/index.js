// /: the static home page, with its 12 cards re-ordered by the current ranking (weekly trends, see homeRanking)
// and including any posts approved in /admin. With neither, the static page is already in the right order.
import { asset, allPosts, livePosts, homeCards, homeRanking, htmlHeaders } from './_lib/posts.js';

export async function onRequestGet({ request, env }) {
  const page = await asset(env, request, '/');
  const [ranking, live] = await Promise.all([homeRanking(env, request), livePosts(env)]);
  if (ranking.source === 'static' && !live.length) return page;

  const posts = await allPosts(env, request);
  const popular = ranking.ranked;
  // "127 POSTS" in the grid header
  const count = () => ({ text(t) { if (/\d+ (POSTS|published posts)/.test(t.text)) t.replace(t.text.replace(/\d+/, String(posts.length))); } });
  return new HTMLRewriter()
    .on('.post-grid', { element(el) { el.setInnerContent(homeCards(posts, popular), { html: true }); } })
    .on('.grid-head span', count())
    .transform(new Response(page.body, { headers: htmlHeaders() }));
}
