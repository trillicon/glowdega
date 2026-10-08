// node --test tests/  — ads: choosing an ad per slot, admin API validation and storage, click redirect, page filling.
// D1 is faked with node:sqlite running the real migrations; R2 with an in-memory map; HTMLRewriter runs in the real
// Workers runtime through the miniflare that ships with wrangler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pickAd, cleanAdFields, checkAd, adsFor } from '../functions/_lib/ads.js';
import { articlePage, RAIL_PLACEHOLDER, postTerms } from '../functions/_lib/site.js';
import { onRequestGet as listAds, onRequestPost as createAd } from '../functions/api/admin/ads/index.js';
import { onRequestPut as updateAd, onRequestDelete as deleteAd } from '../functions/api/admin/ads/[id].js';
import { collectTerms } from '../functions/api/admin/ads/terms.js';
import { onRequestGet as goAd } from '../functions/go/ad/[id].js';
import { onRequestGet as blogPage } from '../functions/blog/[slug].js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script>');
const NOW = '2026-10-07T12:00:00.000Z';

// ---------- fakes ----------
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const m of ['0001_posts.sql', '0003_ads.sql']) db.exec(readFileSync(join(ROOT, 'migrations', m), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { db.prepare(sql).run(...args); return { success: true }; },
  });
  return { sqlite: db, prepare: (sql) => stmt(sql) };
}
function fakeBucket(keys = []) {
  const store = new Map(keys.map((k) => [k, { key: k, size: 1 }]));
  return {
    store,
    async head(k) { return store.get(k) || null; },
    async put(k, bytes, opts = {}) { const o = { key: k, size: bytes.length, httpMetadata: opts.httpMetadata }; store.set(k, o); return o; },
    async delete(k) { store.delete(k); },
  };
}
const fakeAssets = {
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = path.startsWith('/blog/') ? join(ROOT, path + '.html') : join(ROOT, path);
    return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
  },
};
const makeEnv = (extra = {}) => ({ DB: fakeD1(), IMAGES: fakeBucket(), ASSETS: fakeAssets, ...extra });

const ad = (id, fields = {}) => ({ id, size: 'rail', status: 'active', targets: '[]', is_default: 0, starts_at: null, ends_at: null,
  image_key: `ads/a${id}.jpg`, alt: `Ad ${id}`, ...fields });
const pick = (ads, terms, size = 'rail', random = () => 0) => pickAd(ads, terms, size, { now: NOW, random });

function insert(env, fields = {}) {
  const a = { name: 'Ad', image_key: 'ads/x.jpg', link_url: 'https://shop.example/x', alt: 'Shop', size: 'rail', targets: '[]',
    is_default: 0, status: 'active', starts_at: null, ends_at: null, ...fields };
  const r = env.DB.sqlite.prepare(`INSERT INTO ads (name, image_key, link_url, alt, size, targets, is_default, status, starts_at, ends_at,
    created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.name, a.image_key, a.link_url, a.alt, a.size, a.targets, a.is_default, a.status, a.starts_at, a.ends_at, NOW, NOW);
  return Number(r.lastInsertRowid);
}
const row = (env, id) => env.DB.sqlite.prepare('SELECT * FROM ads WHERE id = ?').get(id);

function form(fields, image = ['banner.jpg', JPG]) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  if (image) body.append('image', new File([image[1]], image[0], { type: 'image/jpeg' }));
  return body;
}
const GOOD = { name: 'Spring sale', link_url: 'https://shop.example/spring', alt: 'Spring sale', size: 'rail', targets: '["acne"]' };
const post = (env, fields, image) => createAd({ env, request: new Request('https://x.test/api/admin/ads', { method: 'POST', body: form(fields, image) }) });
const put = (env, id, body) => updateAd({ env, params: { id: String(id) }, request: new Request('https://x.test/api/admin/ads/' + id,
  body instanceof FormData ? { method: 'PUT', body } : { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });

// ---------- choosing ----------
test('an ad targeting the page category is chosen over the default', () => {
  const ads = [ad(1, { is_default: 1 }), ad(2, { targets: '["skin-care"]' })];
  assert.equal(pick(ads, ['skin-care', 'acne-scars']).id, 2);
});

test('an ad targeting one of the page tags is chosen', () => {
  const ads = [ad(1, { is_default: 1 }), ad(2, { targets: '["hyperpigmentation"]' }), ad(3, { targets: '["health"]' })];
  assert.equal(pick(ads, ['skin-care', 'hyperpigmentation']).id, 2);
});

test('with no targeted match the default of that size runs', () => {
  const ads = [ad(1, { targets: '["health"]' }), ad(2, { is_default: 1 }), ad(3, { is_default: 1, size: 'inline' })];
  assert.equal(pick(ads, ['acne']).id, 2);
  assert.equal(pick(ads, ['acne'], 'inline').id, 3);
  assert.equal(pick(ads, []).id, 2, 'pages without terms still get the default');
});

test('with no match and no default nothing is chosen: rail keeps the placeholder, no inline slot', () => {
  const ads = [ad(1, { targets: '["health"]' }), ad(2, { size: 'inline', targets: '["health"]' })];
  assert.equal(pick(ads, ['acne']), null);
  assert.equal(pick(ads, ['acne'], 'inline'), null);
  const tpl = readFileSync(join(ROOT, 'assets/templates/article.html'), 'utf8');
  const html = articlePage(tpl, { title: 'T', body_md: 'Hi', date: NOW, category: 'Acne' }, [], adsFor({}, ads, ['acne'], { now: NOW }));
  assert.ok(html.includes(`data-ad-slot="rail">${RAIL_PLACEHOLDER}</aside>`));
  assert.ok(!html.includes('data-ad-slot="inline"'));
  assert.ok(html.includes('<article data-ad-terms="acne">'));
});

test('paused ads and ads outside their dates never run, even as defaults', () => {
  const ads = [
    ad(1, { targets: '["acne"]', status: 'paused' }),
    ad(2, { targets: '["acne"]', starts_at: '2026-10-08T00:00:00.000Z' }),
    ad(3, { targets: '["acne"]', ends_at: '2026-10-07T00:00:00.000Z' }),
    ad(4, { targets: '["acne"]', ends_at: NOW }),                                      // ends_at is exclusive
    ad(5, { is_default: 1, status: 'paused' }),
  ];
  assert.equal(pick(ads, ['acne']), null);
  ads.push(ad(6, { targets: '["acne"]', starts_at: '2026-10-01T00:00:00.000Z', ends_at: '2026-10-31T00:00:00.000Z' }));
  assert.equal(pick(ads, ['acne']).id, 6);
});

test('the random choice is only ever among eligible ads, and covers all of them', () => {
  const ads = [ad(1, { targets: '["acne"]' }), ad(2, { targets: '["acne","face"]' }), ad(3, { targets: '["acne"]', status: 'paused' }),
    ad(4, { is_default: 1 }), ad(5, { targets: '["acne"]', size: 'inline' }), ad(6, { targets: '["health"]' })];
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(pick(ads, ['acne'], 'rail', () => i / 100).id);
  seen.add(pick(ads, ['acne'], 'rail', () => 0.9999999).id);
  assert.deepEqual([...seen].sort(), [1, 2]);
  const defaults = [ad(7, { is_default: 1 }), ad(8, { is_default: 1 }), ad(9, { is_default: 1, ends_at: '2026-01-01T00:00:00.000Z' })];
  const rotated = new Set([0, 0.5, 0.99].map((r) => pick(defaults, ['x'], 'rail', () => r).id));
  assert.deepEqual([...rotated].sort(), [7, 8], 'several defaults rotate');
});

test('live posts target their category slug', () => {
  assert.deepEqual(postTerms({ category: 'Skin Care & Acne' }), ['skin-care-and-acne']);
  assert.deepEqual(postTerms({ category: '' }), []);
});

// ---------- validation ----------
test('validation rejects http links, bad sizes, bad dates, non-slug targets and untargeted ads', () => {
  const bad = (input, re) => assert.throws(() => { const f = cleanAdFields(input, { create: true }); checkAd({ targets: '[]', ...f }); }, re);
  bad({ ...GOOD, link_url: 'http://shop.example/' }, /https/);
  bad({ ...GOOD, link_url: 'javascript:alert(1)' }, /https/);
  bad({ ...GOOD, link_url: 'shop.example' }, /https/);
  bad({ ...GOOD, size: 'banner' }, /Size/);
  bad({ ...GOOD, starts_at: 'next tuesday' }, /Start date/);
  bad({ ...GOOD, ends_at: '2026-13-45' }, /End date/);
  bad({ ...GOOD, starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-09T00:00:00Z' }, /after the start/);
  bad({ ...GOOD, starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-10T00:00:00Z' }, /after the start/);
  bad({ ...GOOD, targets: '["Acne Scars"]' }, /slug/);
  bad({ ...GOOD, targets: '"acne"' }, /list/);
  bad({ ...GOOD, targets: '[]' }, /default/);
  bad({ ...GOOD, name: '' }, /Name/);
  const ok = cleanAdFields({ ...GOOD, targets: '[]', is_default: '1', starts_at: '2026-10-10T07:00:00Z', ends_at: '' }, { create: true });
  assert.deepEqual([ok.is_default, ok.starts_at, ok.ends_at], [1, '2026-10-10T07:00:00.000Z', null]);
});

test('POST stores a sniffed image under ads/ without overwriting, and the row', async () => {
  const env = makeEnv({ IMAGES: fakeBucket(['ads/banner.jpg']) });
  const res = await post(env, GOOD, ['Banner.JPG', PNG]);
  assert.equal(res.status, 201);
  const { ad: saved } = await res.json();
  assert.equal(saved.image_key, 'ads/banner.png', 'type comes from the bytes');
  const again = await (await post(env, GOOD, ['banner.jpg', JPG])).json();
  assert.equal(again.ad.image_key, 'ads/banner-2.jpg');
  assert.equal(env.IMAGES.store.get('ads/banner-2.jpg').httpMetadata.contentType, 'image/jpeg');
  assert.deepEqual(saved.targets, ['acne']);
  assert.equal(saved.image_url, 'https://images.glowdega.com/ads/banner.png');
  assert.equal(row(env, saved.id).link_url, 'https://shop.example/spring');
});

test('POST rejects non-images, missing images, oversize files and bad fields, saving nothing', async () => {
  const env = makeEnv();
  assert.equal((await post(env, GOOD, ['evil.jpg', HTML])).status, 415);
  assert.equal((await post(env, GOOD, null)).status, 400);
  const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set(JPG);
  assert.equal((await post(env, GOOD, ['big.jpg', big])).status, 413);
  assert.equal((await post(env, { ...GOOD, link_url: 'http://shop.example/' })).status, 400);
  assert.equal((await post(env, { ...GOOD, size: 'skyscraper' })).status, 400);
  assert.equal((await post(env, { ...GOOD, ends_at: 'soon' })).status, 400);
  const json = await createAd({ env, request: new Request('https://x.test/', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }) });
  assert.equal(json.status, 415);
  assert.equal(env.IMAGES.store.size, 0);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ads').get().n, 0);
});

test('PUT updates fields, pauses, replaces the image (old one deleted, name never reused); DELETE removes all', async () => {
  const env = makeEnv();
  const { ad: a } = await (await post(env, GOOD)).json();
  let res = await put(env, a.id, { status: 'paused', targets: ['acne', 'face'], ends_at: '2026-12-01T08:00:00Z' });
  assert.equal(res.status, 200);
  const r = row(env, a.id);
  assert.deepEqual([r.status, r.targets, r.ends_at], ['paused', '["acne","face"]', '2026-12-01T08:00:00.000Z']);
  assert.equal((await put(env, a.id, { link_url: 'http://x.example' })).status, 400);
  assert.equal((await put(env, a.id, { starts_at: '2026-12-02T00:00:00Z' })).status, 400, 'start after the saved end');
  assert.equal((await put(env, a.id, { targets: [], is_default: false })).status, 400);
  assert.equal((await put(env, 999, { status: 'active' })).status, 404);

  res = await put(env, a.id, form({ name: 'Spring sale v2' }, ['banner.jpg', JPG]));
  const { ad: b } = await res.json();
  assert.equal(b.image_key, 'ads/banner-2.jpg');
  assert.ok(!env.IMAGES.store.has('ads/banner.jpg') && env.IMAGES.store.has('ads/.deleted/banner.jpg'));
  assert.equal(b.name, 'Spring sale v2');

  res = await deleteAd({ env, params: { id: String(a.id) } });
  assert.equal(res.status, 200);
  assert.equal(row(env, a.id), undefined);
  assert.ok(!env.IMAGES.store.has('ads/banner-2.jpg') && env.IMAGES.store.has('ads/.deleted/banner-2.jpg'));
  const c = await (await post(env, GOOD)).json();
  assert.equal(c.ad.image_key, 'ads/banner-3.jpg', 'deleted names are never reused');
  assert.ok(c.ad.id > a.id, 'ids are never reused either');
});

test('GET lists ads with views, clicks and state', async () => {
  const env = makeEnv();
  insert(env, { status: 'paused' });
  const id = insert(env, { starts_at: '2099-01-01T00:00:00.000Z' });
  env.DB.sqlite.prepare('UPDATE ads SET views = 40, clicks = 2 WHERE id = ?').run(id);
  const { ads } = await (await listAds({ env })).json();
  assert.deepEqual(ads.map((a) => [a.state, a.views, a.clicks]), [['scheduled', 40, 2], ['paused', 0, 0]]);
});

test('terms merge categories and tags by slug, with post counts', () => {
  const terms = collectTerms([
    { categories: [{ slug: 'acne', name: 'Acne' }], tags: [{ slug: 'acne', name: 'acne' }, { slug: 'sleep', name: 'sleep' }] },
    { categories: [{ slug: 'health', name: 'Health' }], tags: [{ slug: 'acne', name: 'acne' }] },
  ], [{ category: 'Acne' }, { category: '' }]);
  assert.deepEqual(terms.find((t) => t.slug === 'acne'), { slug: 'acne', name: 'Acne', kinds: ['category', 'tag'], count: 3 });
  assert.deepEqual(terms.map((t) => t.slug), ['acne', 'health', 'sleep']);
});

// ---------- clicks ----------
test('/go/ad/<id> counts the click and redirects; unknown, paused, ended or odd ids go home uncounted', async () => {
  const env = makeEnv();
  const id = insert(env, { link_url: 'https://shop.example/landing?utm=glowdega' });
  const paused = insert(env, { status: 'paused' });
  const ended = insert(env, { ends_at: '2026-01-01T00:00:00.000Z' });
  const go = (x) => goAd({ env, params: { id: String(x) }, request: new Request('https://glowdega.com/go/ad/' + x) });
  let res = await go(id);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://shop.example/landing?utm=glowdega');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  await go(id);
  assert.equal(row(env, id).clicks, 2);
  for (const x of [999, paused, ended, 'abc', '1 OR 1=1']) {
    res = await go(x);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://glowdega.com/');
  }
  assert.equal(row(env, paused).clicks + row(env, ended).clicks, 0);
  res = await goAd({ env: {}, params: { id: '1' }, request: new Request('https://glowdega.com/go/ad/1') });
  assert.equal(res.headers.get('location'), 'https://glowdega.com/', 'no database: still a safe redirect');
});

// ---------- serving ----------
test('a live admin post shows the ad targeting its category, counts the view, and is not cached', async () => {
  const env = makeEnv();
  env.DB.sqlite.prepare(`INSERT INTO posts (id, slug, title, category, body_md, status, publish_at, created_at, updated_at)
    VALUES ('p1', 'new-acne-post', 'New acne post', 'Acne', 'Hello', 'approved', '2026-01-01T00:00:00.000Z', ?, ?)`).run(NOW, NOW);
  const target = insert(env, { targets: '["acne"]', image_key: 'ads/acne.jpg', alt: 'Acne <kit>' });
  insert(env, { is_default: 1 });
  const waits = [];
  const res = await blogPage({ env, params: { slug: 'new-acne-post' }, request: new Request('https://x.test/blog/new-acne-post'), waitUntil: (p) => waits.push(p) });
  const html = await res.text();
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(html.includes(`<a href="/go/ad/${target}" rel="sponsored noopener" target="_blank"><img src="https://images.glowdega.com/ads/acne.jpg" alt="Acne &lt;kit&gt;" width="300" height="600" loading="lazy"></a>`));
  assert.ok(!html.includes('data-ad-slot="inline"'), 'no inline ad, no inline slot');
  await Promise.all(waits);
  assert.equal(row(env, target).views, 1);
});

test('an archive page with no ads running is the static page, uncached', async () => {
  const env = makeEnv();
  const res = await blogPage({ env, params: { slug: '8-ways-actually-get-sleep' }, request: new Request('https://x.test/blog/8-ways-actually-get-sleep'), waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), readFileSync(join(ROOT, 'blog/8-ways-actually-get-sleep.html'), 'utf8'));
});

// HTMLRewriter only exists in the Workers runtime: run fillSlots inside miniflare (bundled with wrangler).
const MINIFLARE = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'wrangler', 'node_modules', 'miniflare');
test('HTMLRewriter fills the slots of a real archive page by its terms', async () => {
  assert.ok(existsSync(MINIFLARE), `miniflare not found at ${MINIFLARE}; install wrangler for this node (npm i -g wrangler)`);
  const mfLib = await import(pathToFileURL(join(MINIFLARE, 'dist', 'src', 'index.js')).href);
  // miniflare 5 takes a new options shape; it still converts the classic (v4) one, which is what we write.
  const options = (o) => (mfLib.convertV4MiniflareOptions ? mfLib.convertV4MiniflareOptions(o) : o);
  const lib = ['ads.js', 'db.js', 'images.js', 'posts.js', 'site.js', 'marked.esm.js'];
  const worker = `import { fillSlots } from './functions/_lib/ads.js';
    export default { async fetch(req) {
      const { html, ads } = await req.json();
      const views = [];
      const out = await fillSlots(new Response(html), {}, ads, { onView: (a) => views.push(a.id), now: '${NOW}', random: () => 0 }).text();
      return Response.json({ out, views });
    } };`;
  const mf = new mfLib.Miniflare(options({
    compatibilityDate: '2024-09-23', modulesRoot: ROOT,
    modules: [{ type: 'ESModule', path: join(ROOT, 'worker.mjs'), contents: worker },
      ...lib.map((f) => ({ type: 'ESModule', path: join(ROOT, 'functions', '_lib', f) }))],
  }));
  try {
    const page = readFileSync(join(ROOT, 'blog/8-ways-actually-get-sleep.html'), 'utf8');   // terms: self-care … sleep …
    const run = async (ads) => (await mf.dispatchFetch('http://x/', { method: 'POST', body: JSON.stringify({ html: page, ads }) })).json();

    let { out, views } = await run([ad(1, { targets: '["sleep"]' }), ad(2, { is_default: 1 }), ad(3, { size: 'inline', targets: '["self-care"]', alt: 'Rest "kit"' }),
      ad(4, { targets: '["acne"]' })]);
    assert.match(out, /<aside class="ad-rail" aria-label="Advertisement" data-ad-slot="rail"><div class="ad-slot ad-slot--rail ad-slot--filled"><a href="\/go\/ad\/1" rel="sponsored noopener" target="_blank"><img src="https:\/\/images.glowdega.com\/ads\/a1.jpg" alt="Ad 1" width="300" height="600" loading="lazy"><\/a><\/div><\/aside>/);
    assert.ok(out.includes('<hr class="article-rule"><div class="ad-slot ad-slot--inline ad-slot--filled" data-ad-slot="inline" aria-label="Advertisement"><a href="/go/ad/3" rel="sponsored noopener" target="_blank"><img src="https://images.glowdega.com/ads/a3.jpg" alt="Rest &quot;kit&quot;" width="728" height="90" loading="lazy"></a></div><div class="article-layout">'));
    assert.ok(!out.includes('Advertisement</span>'), 'placeholder replaced');
    assert.deepEqual(views.sort(), [1, 3]);

    ({ out, views } = await run([ad(4, { targets: '["acne"]' }), ad(5, { size: 'inline', targets: '["acne"]' })]));
    assert.ok(out.includes(`data-ad-slot="rail">${RAIL_PLACEHOLDER}</aside>`), 'no match, no default: rail placeholder stays');
    assert.ok(!out.includes('data-ad-slot="inline"'), 'and the inline slot is removed');
    assert.deepEqual(views, []);
    assert.equal(out.replace(/<div class="ad-slot ad-slot--inline"[^>]*><\/div>/, ''), page.replace(/<div class="ad-slot ad-slot--inline"[^>]*><\/div>/, ''));
  } finally {
    await mf.dispose();
  }
});

test('admin ads page never opens a blocking browser dialog', () => {
  const code = readFileSync(join(ROOT, 'admin/ads.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(prompt|alert|confirm)\s*\(/);
});
