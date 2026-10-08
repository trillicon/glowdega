// D1 access for posts written in /admin or submitted through /api/drafts.
import { archiveSlugs, nowIso } from './posts.js';
import { termSlug } from './site.js';

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
export const fail = (status, error) => json({ error }, status);

export function requireDb(env) {
  if (!env.DB) throw new HttpError(503, 'The posts database is not connected yet.');
  return env.DB;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Wrap a handler so HttpErrors become JSON responses.
export const handle = (fn) => async (context) => {
  try {
    return await fn(context);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    console.error(err);
    return fail(500, 'Something went wrong.');
  }
};

export const slugify = (s) =>
  String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

// Slug must not collide with an archived post or another post in D1.
export async function checkSlug(context, slug, exceptId = '') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new HttpError(400, 'The URL slug can only use lowercase letters, numbers and single dashes.');
  }
  if ((await archiveSlugs(context.env, context.request)).has(slug)) {
    throw new HttpError(409, `/blog/${slug} is already used by an archived post.`);
  }
  const row = await requireDb(context.env).prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').bind(slug, exceptId).first();
  if (row) throw new HttpError(409, `/blog/${slug} is already used by another post.`);
}

export async function freeSlug(context, base) {
  const root = slugify(base) || 'post';
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? root : `${root}-${n}`;
    try { await checkSlug(context, slug); return slug; } catch (err) { if (err.status !== 409) throw err; }
  }
  throw new HttpError(409, 'Could not find a free URL slug.');
}

const LIMITS = { title: 200, excerpt: 400, category: 60, hero_image: 1000, body_md: 200_000, source: 80, review_note: 2000 };

export const MAX_TAGS = 15;
export const MAX_TAG_LENGTH = 40;

// A category must be one of the approved names (assets/taxonomy.json). `keep` is the post's saved category: an old
// one from before the list existed may be saved again unchanged, so those drafts stay editable.
export function cleanCategory(value, categories, { keep = null } = {}) {
  const v = String(value ?? '').trim();
  if (!v || v === keep) return v;
  const names = categories.map((c) => c.name);
  const hit = names.find((n) => n.toLowerCase() === v.toLowerCase());
  if (hit) return hit;
  throw new HttpError(400, `"${v.slice(0, 60)}" is not a category. Use one of: ${names.join(', ')}.`);
}

// Tags: a list (or comma-separated text) of short names, de-duplicated by slug.
export function cleanTags(value) {
  let list = value;
  if (typeof value === 'string') {
    try { list = value.trim().startsWith('[') ? JSON.parse(value) : value.split(','); } catch { list = null; }
  }
  if (!Array.isArray(list)) throw new HttpError(400, 'Tags must be a list of words or short phrases.');
  const out = [];
  const seen = new Set();
  for (const t of list) {
    if (typeof t !== 'string') throw new HttpError(400, 'Tags must be a list of words or short phrases.');
    const name = t.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > MAX_TAG_LENGTH) throw new HttpError(400, `The tag "${name.slice(0, 40)}…" is too long (max ${MAX_TAG_LENGTH} characters).`);
    const slug = termSlug(name);
    if (!slug) throw new HttpError(400, `The tag "${name}" needs at least one letter or number.`);
    if (!seen.has(slug)) { seen.add(slug); out.push(name); }
  }
  if (out.length > MAX_TAGS) throw new HttpError(400, `Use at most ${MAX_TAGS} tags.`);
  return out;
}

// Pick and validate editable fields from a request body. `categories` = the taxonomy; `keepCategory` = the saved
// category of the post being edited (see cleanCategory).
export function cleanFields(input, { requireAll = false, categories, keepCategory = null } = {}) {
  const out = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    if (input[k] === undefined || input[k] === null) continue;
    const v = String(input[k]).trim();
    if (v.length > max) throw new HttpError(400, `${k.replace('_', ' ')} is too long (max ${max} characters).`);
    out[k] = v;
  }
  if (out.hero_image && !/^(https:\/\/|\/assets\/img\/)/i.test(out.hero_image)) {
    throw new HttpError(400, 'Hero image must be an https:// URL.');
  }
  if (requireAll && (!out.title || !out.body_md)) throw new HttpError(400, 'A title and a body are required.');
  if (out.category !== undefined) {
    if (!categories) throw new Error('cleanFields: pass the taxonomy to validate a category');
    out.category = cleanCategory(out.category, categories, { keep: keepCategory });
  }
  if (input.tags !== undefined && input.tags !== null) out.tags = JSON.stringify(cleanTags(input.tags));
  if (input.slug !== undefined) out.slug = String(input.slug).trim().toLowerCase();
  return out;
}

export async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Expected a JSON body.'); }
}

export async function getPost(env, id) {
  const post = await requireDb(env).prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!post) throw new HttpError(404, 'Post not found.');
  return post;
}

// Derived state shown in the admin: draft, scheduled, published, rejected.
export const state = (p, now = nowIso()) =>
  p.status === 'approved' ? (p.publish_at > now ? 'scheduled' : 'published') : p.status;

export { nowIso };

// Bearer token check for the automation endpoints (/api/drafts, /api/trending), constant-time.
export async function tokenMatches(given, expected) {
  if (!expected || expected.length < 32) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

