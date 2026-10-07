// /blog: the static archive page, regenerated when posts approved in /admin are live.
import { asset, allPosts, livePosts, archiveMain, htmlHeaders } from '../_lib/posts.js';

export async function onRequestGet({ request, env }) {
  const page = await asset(env, request, '/blog');
  if (!(await livePosts(env)).length) return page;

  const posts = await allPosts(env, request);
  return new HTMLRewriter()
    .on('main', { element(el) { el.setInnerContent(archiveMain(posts), { html: true }); } })
    .on('meta[name="description"]', {
      element(el) { el.setAttribute('content', el.getAttribute('content').replace(/\d+ articles/, `${posts.length} articles`)); },
    })
    .transform(new Response(page.body, { headers: htmlHeaders() }));
}
