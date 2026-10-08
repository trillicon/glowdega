// node --test tests/  — categories & tags, the affiliate note, the article template and the admin preview.
// D1 is faked with node:sqlite running the real migrations; static files come from the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { articlePage, relatedPosts, termSlug, filedUnder, AFFILIATE_NOTE, tagNames } from '../functions/_lib/site.js';
import { cleanFields, cleanTags, MAX_TAGS } from '../functions/_lib/db.js';
import { allPosts, archiveWithTerms } from '../functions/_lib/posts.js';
import { onRequestPost as submitDraft } from '../functions/api/drafts.js';
import { onRequestPut as updatePost } from '../functions/api/admin/posts/[id].js';
import { onRequestPost as postAction } from '../functions/api/admin/posts/[id]/[action].js';
import { onRequestGet as listTerms } from '../functions/api/admin/terms/index.js';
import { onRequestPut as putTerms, onRequestDelete as resetTerms } from '../functions/api/admin/terms/[slug].js';
import { onRequestGet as previewPage } from '../functions/admin/preview/[id].js';
import { onRequestGet as sitemap } from '../functions/sitemap.xml.js';
import { collectTerms } from '../functions/api/admin/ads/terms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const TAXONOMY = JSON.parse(read('assets/taxonomy.json'));
const ARCHIVE = JSON.parse(read('assets/posts.json'));
const NAMES = TAXONOMY.map((c) => c.name);
const NOW = '2026-10-07T12:00:00.000Z';
const TOKEN = 'a'.repeat(64);
// Workers' crypto.subtle.timingSafeEqual (used by tokenMatches) is not in Node.
crypto.subtle.timingSafeEqual ??= (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));

function fakeD1(migrations = ['0001_posts.sql', '0003_ads.sql', '0004_terms.sql']) {
  const db = new DatabaseSync(':memory:');
  for (const m of migrations) db.exec(read(join('migrations', m)));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { db.prepare(sql).run(...args); return { success: true }; },
  });
  return { sqlite: db, prepare: (sql) => stmt(sql) };
}
const fakeAssets = {
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = path.startsWith('/blog/') ? join(ROOT, path + '.html') : join(ROOT, path);
    return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
  },
};
const makeEnv = (extra = {}) => ({ DB: fakeD1(), ASSETS: fakeAssets, DRAFTS_TOKEN: TOKEN, ...extra });
function insertPost(env, fields = {}) {
  const p = { id: 'p1', slug: 'new-post', title: 'New post', category: 'Acne', tags: '[]', body_md: 'Hello', status: 'draft',
    publish_at: null, ...fields };
  env.DB.sqlite.prepare(`INSERT INTO posts (id, slug, title, category, tags, body_md, status, publish_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, p.slug, p.title, p.category, p.tags, p.body_md, p.status, p.publish_at, NOW, NOW);
  return p;
}
const jsonReq = (url, method, body, headers = {}) =>
  new Request('https://x.test' + url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
const draft = (env, body) => submitDraft({ env, request: jsonReq('/api/drafts', 'POST', body, { authorization: `Bearer ${TOKEN}` }) });
const put = (env, id, body) => updatePost({ env, params: { id }, request: jsonReq('/api/admin/posts/' + id, 'PUT', body) });
const putT = (env, slug, body) => putTerms({ env, params: { slug }, request: jsonReq('/api/admin/terms/' + slug, 'PUT', body) });

// ---------- the list ----------
test('taxonomy.json holds the 13 approved categories, slugs made from their names', () => {
  assert.deepEqual(NAMES, ['Acne', 'Acne Scars', 'Hyperpigmentation', 'Skin Conditions', 'Sun Care', 'Hair & Scalp', 'Hair Removal',
    'Skingredients', 'Skin Care Routines', 'Facials & Treatments', 'Health & Wellness', 'Skin Care Scams', 'Esthetician Life & Business']);
  for (const c of TAXONOMY) assert.equal(c.slug, termSlug(c.name));
});

test('every archive post has exactly one approved category, and its old WordPress categories became tags', () => {
  assert.equal(ARCHIVE.length, 127);
  for (const p of ARCHIVE) {
    assert.ok(NAMES.includes(p.category), `${p.slug}: ${p.category}`);
    assert.deepEqual(p.categories, [{ slug: termSlug(p.category), name: p.category }]);
    const slugs = p.tags.map((t) => t.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${p.slug}: duplicate tags`);
    assert.ok(!slugs.includes(p.categories[0].slug), `${p.slug}: category repeated as a tag`);
  }
  const by = Object.fromEntries(ARCHIVE.map((p) => [p.slug, p]));
  const tagged = (slug, tag) => by[slug].tags.some((t) => t.slug === tag);
  assert.ok(tagged('glowin6-week-six', 'glowin6-challenge'), '#GlowIn6 Challenge is a tag now');
  assert.ok(tagged('do-you-need-a-skincare-fridge', 'beauty'), 'old category "Beauty" kept as a tag for ads');
  assert.ok(tagged('comedogenic', 'skin-care-scams') && tagged('fungal-acne-is-fake', 'skingredients'));
  assert.equal(by['hyperpigmentation-handbook-defeating-dark-spots'].category, 'Hyperpigmentation', 'dark spots, not Skin Conditions');
  assert.equal(by['hyperpigmentation-sunscreen'].category, 'Hyperpigmentation', 'dark spots, not Skin Care');
  assert.equal(by['sunscreen-guide'].category, 'Sun Care');
  assert.ok(!ARCHIVE.some((p) => p.tags.some((t) => t.slug === 'uncategorized')));
  const mapping = JSON.parse(read('tools/categories.json'));
  for (const v of [...Object.values(mapping.map), ...Object.values(mapping.posts)]) assert.ok(NAMES.includes(v), v);
});

test('archive pages show the category and tags under "Filed under", as site.js filedUnder() writes them', () => {
  for (const p of ARCHIVE.slice(0, 40)) {
    const page = read(`blog/${p.slug}.html`);
    assert.ok(page.includes(filedUnder(p.category, p.tags.map((t) => t.name))), p.slug);
  }
});

// ---------- the affiliate note, the template and the preview ----------
test('every archive post and every admin post opens with the affiliate note', () => {
  const note = `<div class="prose"><p class="affiliate-note">${AFFILIATE_NOTE}</p>`;
  assert.equal(AFFILIATE_NOTE, 'Friendly reminder: this post contains affiliate links, which help support the Glowdega Archive. If you buy through them, I may earn a commission at no extra cost to you.');
  const pages = readdirSync(join(ROOT, 'blog')).filter((f) => f.endsWith('.html'));
  assert.equal(pages.length, 127);
  for (const f of pages) assert.ok(read(`blog/${f}`).includes(note), f);
  const html = articlePage(read('assets/templates/article.html'), { title: 'T', body_md: 'First line.', date: NOW, category: 'Acne' });
  assert.ok(html.includes(`${note}<p>First line.</p>`));
  assert.match(read('assets/style.css'), /\.prose \.affiliate-note\{font-style:italic;font-size:8pt/);
});

test('the article template uses root-absolute links, so /admin/preview/<id> is styled', async () => {
  const tpl = read('assets/templates/article.html');
  assert.ok(!tpl.includes('../'), 'no relative ../ links');
  assert.ok(tpl.includes('<link rel="stylesheet" href="/assets/style.css">'));
  const env = makeEnv();
  insertPost(env, { id: 'd1', slug: 'draft-one', tags: '["Night routine"]' });
  const res = await previewPage({ env, params: { id: 'd1' }, request: new Request('https://x.test/admin/preview/d1') });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(html.includes('href="/assets/style.css"'));
  assert.ok(!/(href|src)="\.\.\//.test(html), 'nothing resolves under /admin/');
  assert.ok(html.includes(filedUnder('Acne', ['Night routine'])));
  assert.ok(html.includes('class="affiliate-note"'));
});

test('every page footer links the affiliate disclosure, which is in the sitemap', async () => {
  const pages = [...readdirSync(ROOT).filter((f) => f.endsWith('.html')),
    ...readdirSync(join(ROOT, 'pages')).map((f) => `pages/${f}`), ...readdirSync(join(ROOT, 'blog')).map((f) => `blog/${f}`),
    'assets/templates/article.html'];
  for (const p of pages) assert.match(read(p).match(/<footer>.*?<\/footer>/s)?.[0] || '', /affiliate-disclosure\.html">Affiliate Disclosure<\/a>/, p);
  const doc = read('affiliate-disclosure.html');
  assert.ok(doc.includes('<a href="mailto:book@fairyglowmother.com">book@fairyglowmother.com</a>'));
  assert.ok(doc.includes('<p><em>Last updated: October 2026</em></p>'));
  const xml = await (await sitemap({ env: { ASSETS: fakeAssets }, request: new Request('https://glowdega.com/sitemap.xml') })).text();
  assert.ok(xml.includes('<loc>https://glowdega.com/affiliate-disclosure</loc>'));
});

// ---------- validation ----------
test('categories must come from the list; tags are short, few and de-duplicated', () => {
  assert.equal(cleanFields({ category: 'hair & scalp' }, { categories: TAXONOMY }).category, 'Hair & Scalp');
  assert.throws(() => cleanFields({ category: 'Hair' }, { categories: TAXONOMY }), (e) => e.status === 400 && /"Hair" is not a category\. Use one of: Acne, Acne Scars/.test(e.message));
  assert.equal(cleanFields({ category: 'Admin' }, { categories: TAXONOMY, keepCategory: 'Admin' }).category, 'Admin', 'an old category saved unchanged is fine');
  assert.equal(cleanFields({ category: '' }, { categories: TAXONOMY }).category, '');
  assert.deepEqual(cleanTags(['Sleep', ' sleep ', 'Night  routine', '']), ['Sleep', 'Night routine']);
  assert.deepEqual(cleanTags('acne, sleep'), ['acne', 'sleep']);
  assert.equal(cleanFields({ tags: ['a', 'b'] }, { categories: TAXONOMY }).tags, '["a","b"]');
  assert.throws(() => cleanTags(['x'.repeat(41)]), /too long/);
  assert.throws(() => cleanTags(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`)), /at most/);
  assert.throws(() => cleanTags([1]), /list/);
  assert.throws(() => cleanTags({ a: 1 }), /list/);
  assert.throws(() => cleanTags(['!!!']), /letter or number/);
});

test('POST /api/drafts takes tags and refuses a category not on the list', async () => {
  const env = makeEnv();
  let res = await draft(env, { title: 'Scalp care', body_md: 'Hi', category: 'Hair', tags: ['scalp'] });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Use one of: .*Hair & Scalp/);
  res = await draft(env, { title: 'Scalp care', body_md: 'Hi', category: 'Hair & Scalp', tags: ['scalp', 'Dandruff', 'scalp'] });
  assert.equal(res.status, 201);
  const row = env.DB.sqlite.prepare('SELECT category, tags FROM posts').get();
  assert.deepEqual({ ...row }, { category: 'Hair & Scalp', tags: '["scalp","Dandruff"]' });
  res = await draft(env, { title: 'X', body_md: 'Hi', tags: Array.from({ length: 20 }, (_, i) => `tag ${i}`) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at most 15 tags/);
});

test('migration 0004 maps old "Hair" drafts to Hair & Scalp and keeps others (e.g. Admin) editable', async () => {
  const env = makeEnv({ DB: fakeD1(['0001_posts.sql']) });
  for (const [id, category] of [['h', 'Hair'], ['a', 'Admin'], ['x', 'acne']]) {
    env.DB.sqlite.prepare(`INSERT INTO posts (id, slug, title, category, body_md, created_at, updated_at) VALUES (?, ?, 'T', ?, 'B', ?, ?)`)
      .run(id, 'slug-' + id, category, NOW, NOW);
  }
  env.DB.sqlite.exec(read('migrations/0004_terms.sql'));
  const cats = Object.fromEntries(env.DB.sqlite.prepare('SELECT id, category, tags FROM posts').all().map((r) => [r.id, [r.category, r.tags]]));
  assert.deepEqual(cats, { h: ['Hair & Scalp', '[]'], a: ['Admin', '[]'], x: ['Acne', '[]'] });

  let res = await put(env, 'a', { title: 'Edited', category: 'Admin', tags: ['ops'] });
  assert.equal(res.status, 200, 'saving the old category unchanged works');
  assert.equal((await res.json()).post.title, 'Edited');
  assert.equal((await put(env, 'a', { category: 'Hair' })).status, 400, 'but it cannot be changed to another unlisted one');
  const approve = () => postAction({ env, params: { id: 'a', action: 'approve' }, data: { adminEmail: 'a@x' }, request: jsonReq('/x', 'POST', {}) });
  res = await approve();
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /old category/);
  assert.equal((await put(env, 'a', { category: 'Esthetician Life & Business' })).status, 200);
  assert.equal((await approve()).status, 200);
});

// ---------- related posts ----------
test('related posts weigh the category (3) and shared tags, like tools/build.py', () => {
  const post = { slug: 'me', category: 'Acne', tags: '["sleep","diet"]', date: NOW };
  const posts = [
    { slug: 'near', category: 'Skin Care Routines', tags: [], date: NOW },
    { slug: 'cat', category: 'Acne', tags: [], date: '2020-01-01T00:00:00' },
    { slug: 'cat+tag', category: 'Acne', tags: [{ slug: 'diet', name: 'diet' }], date: '2019-01-01T00:00:00' },
    { slug: 'two-tags', category: 'Health & Wellness', tags: [{ slug: 'sleep', name: 'Sleep' }, { slug: 'diet', name: 'diet' }], date: '2018-01-01T00:00:00' },
    { slug: 'one-tag', category: 'Health & Wellness', tags: '["Sleep"]', date: '2018-01-01T00:00:00' },
  ];
  assert.deepEqual(relatedPosts(post, posts).map((p) => p.slug), ['cat+tag', 'cat', 'two-tags', 'one-tag']);
  assert.deepEqual(tagNames({ tags: 'oops' }), []);
});

// ---------- archive overrides (Categories tab) ----------
test('re-filing an archive post stores an override that cards, listings and ad terms use', async () => {
  const env = makeEnv();
  const slug = '8-ways-actually-get-sleep';
  assert.equal((await putT(env, slug, { category: 'Hair', tags: [] })).status, 400);
  assert.equal((await putT(env, slug, { category: '', tags: [] })).status, 400);
  assert.equal((await putT(env, 'no-such-post', { category: 'Acne', tags: [] })).status, 404);
  const res = await putT(env, slug, { category: 'Skin Care Routines', tags: ['sleep', 'Night routine'] });
  assert.equal(res.status, 200);
  const req = new Request('https://x.test/');
  const p = (await allPosts(env, req)).find((x) => x.slug === slug);
  assert.equal(p.category, 'Skin Care Routines');
  assert.deepEqual(p.tags, [{ slug: 'sleep', name: 'sleep' }, { slug: 'night-routine', name: 'Night routine' }]);
  assert.equal(ARCHIVE.find((x) => x.slug === slug).category, 'Health & Wellness', 'posts.json itself is untouched');

  const { categories, tags, posts } = await (await listTerms({ env, request: req })).json();
  assert.equal(posts.length, 127);
  assert.equal(categories.reduce((n, c) => n + c.count, 0), 127);
  assert.equal(categories.find((c) => c.name === 'Skin Care Routines').count,
    ARCHIVE.filter((x) => x.category === 'Skin Care Routines').length + 1);
  assert.ok(tags.some((t) => t.slug === 'night-routine'));
  assert.deepEqual(posts.find((x) => x.slug === slug), { kind: 'archive', slug, title: p.title, date: p.date,
    category: 'Skin Care Routines', tags: ['sleep', 'Night routine'], refiled: true, state: 'published' });

  const terms = collectTerms(await archiveWithTerms(env, req), [], TAXONOMY);
  assert.ok(terms.find((t) => t.slug === 'night-routine'));
  assert.equal(terms.filter((t) => t.kinds.includes('category')).length, 13, 'all 13 categories are targetable, even unused ones');
  assert.equal(terms.find((t) => t.slug === 'hair-and-scalp').count, 0);
  assert.ok(terms.find((t) => t.slug === 'beauty' && t.kinds.includes('tag')), 'old categories stay targetable as tags');

  await resetTerms({ env, params: { slug } });
  assert.equal((await allPosts(env, req)).find((x) => x.slug === slug).category, 'Health & Wellness');
});

test('re-filing a post written in /admin updates it in place', async () => {
  const env = makeEnv();
  insertPost(env, { id: 'p9', slug: 'admin-post', category: 'Admin', status: 'approved', publish_at: '2026-01-01T00:00:00.000Z' });
  const res = await putT(env, 'admin-post', { category: 'Acne', tags: 'sleep, diet' });
  assert.equal(res.status, 200);
  assert.deepEqual({ ...env.DB.sqlite.prepare('SELECT category, tags FROM posts').get() }, { category: 'Acne', tags: '["sleep","diet"]' });
  const p = (await allPosts(env, new Request('https://x.test/'))).find((x) => x.slug === 'admin-post');
  assert.equal(p.category, 'Acne');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM post_terms').get().n, 0);
});

test('without migration 0004 (no tags column, no post_terms) live posts and the archive still load', async () => {
  const env = makeEnv({ DB: fakeD1(['0001_posts.sql']) });
  env.DB.sqlite.prepare(`INSERT INTO posts (id, slug, title, category, body_md, status, publish_at, created_at, updated_at)
    VALUES ('x', 'old-db-post', 'T', 'Acne', 'B', 'approved', '2026-01-01T00:00:00.000Z', ?, ?)`).run(NOW, NOW);
  const posts = await allPosts(env, new Request('https://x.test/'));
  assert.equal(posts.length, 128);
  assert.ok(posts.some((p) => p.slug === 'old-db-post'));
});

test('Ads tab names the live default of each size, or says the book banner shows', async () => {
  const { liveDefaults } = await import('../admin/ads.js');
  const ads = [{ name: 'Spring', size: 'inline', is_default: true, state: 'running' }, { name: 'Paused', size: 'rail', is_default: true, state: 'paused' },
    { name: 'Targeted', size: 'rail', is_default: false, state: 'running' }];
  assert.deepEqual(liveDefaults(ads), [{ size: 'rail', names: [] }, { size: 'inline', names: ['Spring'] }]);
});

test('admin: category select from taxonomy.json, tags with autocomplete, Categories tab, live defaults in Ads', () => {
  const html = read('admin/index.html');
  assert.match(html, /<select name="category">/);
  assert.match(html, /id="tagBox"/);
  assert.match(html, /<a href="#categories" data-view="categories">Categories<\/a>/);
  assert.match(html, /id="adDefaults"/);
  const terms = read('admin/terms.js');
  assert.match(terms, /fetch\('\/assets\/taxonomy\.json'/);
  assert.match(terms, /old category — pick a new one/);
  assert.match(terms, /list', 'tagSuggestions'/);
  assert.match(read('admin/ads.js'), /None — the book banner shows/);
  for (const f of ['admin/terms.js', 'admin/admin.js']) {
    // admin.js already uses confirm() for unsaved changes on navigation; terms.js must not add dialogs.
    if (f === 'admin/terms.js') assert.doesNotMatch(read(f).replace(/\/\/.*$/gm, ''), /\b(prompt|alert|confirm)\s*\(/);
  }
});
