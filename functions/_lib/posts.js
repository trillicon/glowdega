// Post data: the static archive (assets/posts.json, written by tools/build.py) merged with
// posts approved in /admin (D1 binding `DB`). Without a DB binding the site serves the archive only.
import { esc, card, year, excerptFrom } from './site.js';

// Fetch a static file, following Pages' clean-URL redirects (/x.html -> /x).
export async function asset(env, request, path) {
  let url = new URL(path, request.url);
  for (let i = 0; i < 3; i++) {
    const res = await env.ASSETS.fetch(new Request(url, { headers: { accept: 'text/html,*/*' } }));
    if (res.status < 300 || res.status >= 400) return res;
    url = new URL(res.headers.get('location'), url);
  }
  throw new Error('too many redirects for ' + path);
}

let archiveCache;
export async function archive(env, request) {
  if (!archiveCache) {
    const res = await asset(env, request, '/assets/posts.json');
    if (!res.ok) throw new Error(`posts.json ${res.status}`);
    archiveCache = await res.json();
  }
  return archiveCache;
}

export async function archiveSlugs(env, request) {
  return new Set((await archive(env, request)).map((p) => p.slug));
}

export const nowIso = () => new Date().toISOString();

// Live = approved and due. Returned in the same shape as archive entries, plus body fields.
export async function livePosts(env) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT slug, title, excerpt, category, hero_image, body_md, publish_at AS date
         FROM posts WHERE status = 'approved' AND publish_at <= ? ORDER BY publish_at DESC`,
    ).bind(nowIso()).all();
    return results.map((p) => ({ ...p, excerpt: p.excerpt || excerptFrom(p.body_md), live: true }));
  } catch (err) {
    console.error('livePosts failed', err);
    return [];
  }
}

const sortKey = (iso) => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z');
export async function allPosts(env, request) {
  const [live, arch] = await Promise.all([livePosts(env), archive(env, request)]);
  return [...live, ...arch].sort((a, b) => sortKey(b.date) - sortKey(a.date));
}

// <main> of /blog, same markup tools/build.py writes into blog.html.
export function archiveMain(posts) {
  const years = [...new Set(posts.map((p) => year(p.date)))].sort((a, b) => b - a);
  const nav = years.map((y) => `<a class="pill" href="#y${y}">${y}</a>`).join('');
  const groups = years.map((y) => {
    const ps = posts.filter((p) => year(p.date) === y);
    return `<section class="grid" id="y${y}"><div class="grid-head"><span>${y}</span><span>${ps.length} post${ps.length === 1 ? '' : 's'}</span></div>`
      + `<div class="post-grid">${ps.map((p) => card(p)).join('')}</div></section>`;
  }).join('');
  return `<section class="page-shell"><div class="eyebrow">GLOWDEGA® / THE ARCHIVE</div><h1>THE GLOW<br>GAZETTE</h1>`
    + `<p class="archive-count">${posts.length} articles, newest first.</p>`
    + `<nav class="archive-nav" aria-label="Jump to year">${nav}</nav></section>${groups}`;
}

// Home page order: the weekly trend ranking in D1 (PUT /api/trending), else the Search Console order baked into
// assets/popular.json by tools/build.py. Returns { ranked: [slug], source: 'trending' | 'static', ... }.
export const HOME_RANKING = 'home_ranking';
export const settingsTable = (db) => db.prepare(
  'CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)').run();

export async function homeRanking(env, request) {
  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT value, updated_at FROM site_settings WHERE key = ?').bind(HOME_RANKING).first();
      if (row) return { ...JSON.parse(row.value), updated_at: row.updated_at, source: 'trending' };
    } catch (err) {
      if (!/no such table/i.test(String(err))) console.error('homeRanking failed', err);
    }
  }
  const res = await asset(env, request, '/assets/popular.json');
  return { ranked: res.ok ? await res.json() : [], source: 'static' };
}

// Home cards: in `popular` order (see homeRanking), the rest newest first; no dates.
export function homeCards(posts, popular = []) {
  const rank = new Map(popular.map((slug, i) => [slug, i]));
  const r = (p) => rank.get(p.slug) ?? rank.size;
  return [...posts].sort((a, b) => r(a) - r(b)).slice(0, 12).map((p) => card(p, { dated: false })).join('');
}

export async function notFound(env, request) {
  const res = await asset(env, request, '/404.html');
  return new Response(res.status === 200 || res.status === 404 ? res.body : 'Not found', {
    status: 404, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export const htmlHeaders = (extra = {}) => ({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=60',
  ...extra,
});

export { esc };
