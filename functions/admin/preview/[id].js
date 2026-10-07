// /admin/preview/:id — a post rendered exactly as it will appear on /blog/<slug>, whatever its status.
import { asset, allPosts } from '../../_lib/posts.js';
import { articlePage, relatedPosts, esc } from '../../_lib/site.js';
import { getPost, state, nowIso, HttpError } from '../../_lib/db.js';

export async function onRequestGet({ request, env, params }) {
  let post;
  try {
    post = await getPost(env, params.id);
  } catch (err) {
    return new Response(err instanceof HttpError ? err.message : 'Error', { status: err.status || 500 });
  }
  const s = state(post);
  const date = post.publish_at || nowIso();
  const posts = (await allPosts(env, request)).filter((p) => p.slug !== post.slug);

  const tpl = await (await asset(env, request, '/assets/templates/article.html')).text();
  const banner = `<div class="admin-preview-bar">PREVIEW • ${esc(s.toUpperCase())} • /blog/${esc(post.slug)}`
    + ` <a href="/admin/#${esc(post.id)}">Back to admin</a></div>`;
  const html = articlePage(tpl, { ...post, date }, relatedPosts({ ...post, date }, posts))
    .replace('<head>', '<head><meta name="robots" content="noindex">')
    .replace('<body>', `<body><style>.admin-preview-bar{position:sticky;top:0;z-index:50;background:#111;color:#dfff00;font:700 12px/1 "DM Sans",Arial,sans-serif;letter-spacing:.08em;padding:12px 4vw}.admin-preview-bar a{color:#fff;margin-left:16px}</style>${banner}`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
