// /robots.txt: everything public is crawlable except the admin, its API and ad click links.
export function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /go/\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
