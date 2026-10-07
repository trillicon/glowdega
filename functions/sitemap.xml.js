// /sitemap.xml: home, the Gazette, the book page and every post (archive + published from /admin).
import { allPosts } from './_lib/posts.js';
import { esc, isoDay } from './_lib/site.js';

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const posts = await allPosts(env, request);
  const url = (path, lastmod) => `<url><loc>${esc(origin + path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  const newest = posts.length ? isoDay(posts[0].date) : '';
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + url('/', newest) + url('/blog', newest) + url('/book')
    + posts.map((p) => url(`/blog/${p.slug}`, isoDay(p.date))).join('')
    + '</urlset>\n';
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
