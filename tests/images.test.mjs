// node --test tests/  — photo library: naming, type sniffing, folder isolation, no-overwrite, API handlers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseName, sniff, isOwnKey, freeKey, prefix, MAX_BYTES } from '../functions/_lib/images.js';
import { onRequestGet, onRequestPost, onRequestDelete } from '../functions/api/admin/images.js';

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const GIF = new TextEncoder().encode('GIF89a....');
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const HTML = new TextEncoder().encode('<html><script>alert(1)</script>');

// In-memory stand-in for an R2 bucket binding.
function fakeBucket(keys = []) {
  const store = new Map(keys.map((k, i) => [k, { key: k, size: 10, uploaded: new Date(Date.UTC(2026, 0, 1 + i)) }]));
  return {
    store,
    async head(k) { return store.get(k) || null; },
    async put(k, bytes, opts = {}) { const o = { key: k, size: bytes.length, uploaded: new Date(), httpMetadata: opts.httpMetadata }; store.set(k, o); return o; },
    async delete(k) { store.delete(k); },
    async list({ prefix: p }) { return { objects: [...store.values()].filter((o) => o.key.startsWith(p)), truncated: false }; },
  };
}
const env = (bucket, extra = {}) => ({ IMAGES: bucket, IMAGES_PREFIX: 'posts/', ...extra });
const upload = (files) => {
  const body = new FormData();
  for (const [name, bytes, type = 'image/jpeg'] of files) body.append('file', new File([bytes], name, { type }));
  return new Request('https://x.test/api/admin/images', { method: 'POST', body });
};

test('baseName makes clean, safe file names', () => {
  assert.equal(baseName('Silk Press (final) Ñ.JPG'), 'silk-press-final-n');
  assert.equal(baseName('../../etc/passwd.jpg'), 'passwd');
  assert.equal(baseName('C:\\photos\\Café Shot.png'), 'cafe-shot');
  assert.equal(baseName('???.jpg'), 'image');
  assert.equal(baseName('a'.repeat(200) + '.jpg').length, 60);
});

test('sniff trusts file bytes, not names', () => {
  assert.equal(sniff(JPG).ext, 'jpg');
  assert.equal(sniff(PNG).ext, 'png');
  assert.equal(sniff(GIF).ext, 'gif');
  assert.equal(sniff(WEBP).ext, 'webp');
  assert.equal(sniff(HTML), null);
  assert.equal(sniff(new Uint8Array([])), null);
});

test('isOwnKey only allows safe keys in this environment folder', () => {
  const e = env(null);
  assert.ok(isOwnKey(e, 'posts/silk-press.jpg'));
  assert.ok(!isOwnKey(e, 'img/0059773555a5.jpg'), 'site images are not deletable from the library');
  assert.ok(!isOwnKey(e, 'preview/silk-press.jpg'));
  assert.ok(!isOwnKey(e, 'posts/../img/x.jpg'));
  assert.ok(!isOwnKey(e, 'posts/x.html'));
  assert.ok(!isOwnKey(e, null));
  assert.ok(isOwnKey(env(null, { IMAGES_PREFIX: 'preview/' }), 'preview/a.png'));
});

test('prefix defaults to preview/ (never the live folder) and rejects odd values', () => {
  assert.equal(prefix({}), 'preview/');
  assert.equal(prefix({ IMAGES_PREFIX: 'posts/' }), 'posts/');
  assert.equal(prefix({ IMAGES_PREFIX: 'preview/' }), 'preview/');
  assert.throws(() => prefix({ IMAGES_PREFIX: '../' }));
});

test('freeKey never overwrites', async () => {
  const b = fakeBucket(['posts/a.jpg', 'posts/a-2.jpg']);
  assert.equal(await freeKey(b, 'posts/', 'a', 'jpg'), 'posts/a-3.jpg');
  assert.equal(await freeKey(b, 'posts/', 'a', 'png'), 'posts/a.png');
});

test('POST saves sniffed type, clean name, public URL; duplicates get -2', async () => {
  const b = fakeBucket(['posts/silk-press.jpg']);
  const res = await onRequestPost({ request: upload([['Silk Press.jpeg', JPG], ['logo.gif', PNG, 'image/gif']]), env: env(b) });
  assert.equal(res.status, 201);
  const { images } = await res.json();
  assert.deepEqual(images.map((i) => i.key), ['posts/silk-press-2.jpg', 'posts/logo.png']);
  assert.equal(images[0].url, 'https://images.glowdega.com/posts/silk-press-2.jpg');
  assert.equal(b.store.get('posts/logo.png').httpMetadata.contentType, 'image/png');
});

test('POST rejects non-images and oversize files and saves nothing', async () => {
  const b = fakeBucket();
  let res = await onRequestPost({ request: upload([['ok.jpg', JPG], ['evil.jpg', HTML]]), env: env(b) });
  assert.equal(res.status, 415);
  assert.equal(b.store.size, 0, 'a bad file must not leave the good one half-saved');
  const big = new Uint8Array(MAX_BYTES + 1); big.set(JPG);
  res = await onRequestPost({ request: upload([['big.jpg', big]]), env: env(b) });
  assert.equal(res.status, 413);
  res = await onRequestPost({ request: upload([]), env: env(b) });
  assert.equal(res.status, 400);
  res = await onRequestPost({ request: new Request('https://x.test/', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }), env: env(b) });
  assert.equal(res.status, 415);
  assert.equal(b.store.size, 0);
});

test('POST without the R2 binding says storage is not connected', async () => {
  const res = await onRequestPost({ request: upload([['a.jpg', JPG]]), env: {} });
  assert.equal(res.status, 503);
});

test('GET lists only this folder, newest first', async () => {
  const b = fakeBucket(['img/site.jpg', 'posts/old.jpg', 'posts/new.jpg', 'preview/test.jpg']);
  const { images, folder } = await (await onRequestGet({ env: env(b) })).json();
  assert.equal(folder, 'posts/');
  assert.deepEqual(images.map((i) => i.key), ['posts/new.jpg', 'posts/old.jpg']);
});

test('DELETE removes only own-folder photos', async () => {
  const b = fakeBucket(['img/site.jpg', 'posts/a.jpg']);
  const del = (key) => onRequestDelete({ request: new Request('https://x.test/api/admin/images?key=' + encodeURIComponent(key), { method: 'DELETE' }), env: env(b) });
  assert.equal((await del('img/site.jpg')).status, 400);
  assert.ok(b.store.has('img/site.jpg'));
  assert.equal((await del('posts/missing.jpg')).status, 404);
  assert.equal((await del('posts/a.jpg')).status, 200);
  assert.ok(!b.store.has('posts/a.jpg'));
});

test('admin photo page never opens a blocking browser dialog', async () => {
  const { readFile } = await import('node:fs/promises');
  const code = (await readFile(new URL('../admin/images.js', import.meta.url), 'utf8')).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(prompt|alert|confirm)\s*\(/);
});

test('admin.css keeps @import first so the font loads, and [hidden] wins over display rules', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../admin/admin.css', import.meta.url), 'utf8');
  assert.match(css, /^@import /);
  assert.match(css, /\[hidden\]\{display:none!important\}/);
});

test('a deleted name is never reused (cached copies of the old photo would show)', async () => {
  const b = fakeBucket(['posts/a.jpg']);
  const del = await onRequestDelete({ request: new Request('https://x.test/api/admin/images?key=posts%2Fa.jpg', { method: 'DELETE' }), env: env(b) });
  assert.equal(del.status, 200);
  const { images } = await (await onRequestPost({ request: upload([['a.jpg', JPG]]), env: env(b) })).json();
  assert.equal(images[0].key, 'posts/a-2.jpg');
  const list = await (await onRequestGet({ env: env(b) })).json();
  assert.deepEqual(list.images.map((i) => i.key), ['posts/a-2.jpg'], 'markers are not listed');
});
