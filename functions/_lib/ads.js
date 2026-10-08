// Ads in article slots. Rows live in the D1 table `ads` (migrations/0003_ads.sql); images in R2 under ads/.
//
// Every article has two slots: 'rail' (300x600, right column) and 'inline' (728x90, between photo/meta and text).
// For each slot: active ads of that size inside their date window whose targets share a term with the page (its
// category and tag slugs) → one at random; otherwise an active in-window default ad of that size → one at random;
// otherwise the rail keeps its placeholder and the inline slot is removed.
import { HttpError, nowIso } from './db.js';
import { esc } from './site.js';
import { publicUrl, sniff, baseName, freeKey, tombstone, MAX_BYTES } from './images.js';

export const SIZES = { rail: { width: 300, height: 600, label: '300 × 600' }, inline: { width: 728, height: 90, label: '728 × 90' } };
export const FOLDER = 'ads/';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TARGETS = 200;

export function parseTargets(value) {
  try {
    const a = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return Array.isArray(a) ? a.filter((t) => typeof t === 'string') : [];
  } catch { return []; }
}

// Dates are stored as UTC ISO strings (toISOString), so plain string comparison orders them.
export const inWindow = (ad, now) => (!ad.starts_at || ad.starts_at <= now) && (!ad.ends_at || ad.ends_at > now);
export const isRunning = (ad, now = nowIso()) => ad.status === 'active' && inWindow(ad, now);

export function pickAd(ads, terms, size, { now = nowIso(), random = Math.random } = {}) {
  const pool = ads.filter((a) => a.size === size && isRunning(a, now));
  const want = new Set(terms);
  const targeted = pool.filter((a) => parseTargets(a.targets).some((t) => want.has(t)));
  const choices = targeted.length ? targeted : pool.filter((a) => Number(a.is_default) === 1);
  if (!choices.length) return null;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

// ---------- markup ----------
export function adLink(env, ad) {
  const { width, height } = SIZES[ad.size];
  return `<a href="/go/ad/${Number(ad.id)}" rel="sponsored noopener" target="_blank">`
    + `<img src="${esc(publicUrl(env, ad.image_key))}" alt="${esc(ad.alt)}" width="${width}" height="${height}" loading="lazy"></a>`;
}
// Content of <aside data-ad-slot="rail">.
export const railInner = (env, ad) => `<div class="ad-slot ad-slot--rail ad-slot--filled">${adLink(env, ad)}</div>`;
// Replaces the hidden <div data-ad-slot="inline"> marker.
export const inlineSlot = (env, ad) =>
  `<div class="ad-slot ad-slot--inline ad-slot--filled" data-ad-slot="inline" aria-label="Advertisement">${adLink(env, ad)}</div>`;

// ---------- serving ----------
// Active ads (date windows are checked per pick). A missing table or DB means no ads, never a broken page.
export async function runningAds(env) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, image_key, alt, size, targets, is_default, status, starts_at, ends_at FROM ads WHERE status = 'active'`,
    ).all();
    return results || [];
  } catch (err) {
    if (!/no such table/i.test(String(err))) console.error('runningAds failed', err);
    return [];
  }
}

export function countView(env, ad) {
  return env.DB.prepare('UPDATE ads SET views = views + 1 WHERE id = ?').bind(ad.id).run()
    .catch((err) => console.error('ad view count failed', err));
}

// Ads for a post published from the admin, as articlePage() wants them.
export function adsFor(env, ads, terms, { onView = () => {}, now, random } = {}) {
  const rail = pickAd(ads, terms, 'rail', { now, random });
  const inline = pickAd(ads, terms, 'inline', { now, random });
  for (const ad of [rail, inline]) if (ad) onView(ad);
  return { rail: rail ? railInner(env, rail) : '', inline: inline ? inlineSlot(env, inline) : '' };
}

// Fill the slots of a static archive page (tools/build.py markup) while it streams.
export function fillSlots(response, env, ads, { onView = () => {}, now, random } = {}) {
  let terms = [];
  return new HTMLRewriter()
    .on('article[data-ad-terms]', {
      element(e) { terms = (e.getAttribute('data-ad-terms') || '').split(/\s+/).filter(Boolean); },
    })
    .on('[data-ad-slot="inline"]', {
      element(e) {
        const ad = pickAd(ads, terms, 'inline', { now, random });
        if (!ad) { e.remove(); return; }
        e.replace(inlineSlot(env, ad), { html: true });
        onView(ad);
      },
    })
    .on('aside[data-ad-slot="rail"]', {
      element(e) {
        const ad = pickAd(ads, terms, 'rail', { now, random });
        if (!ad) return;
        e.setInnerContent(railInner(env, ad), { html: true });
        onView(ad);
      },
    })
    .transform(response);
}

// ---------- admin: validation ----------
const bool = (v) => v === true || v === 1 || ['1', 'true', 'on', 'yes'].includes(String(v).toLowerCase());

function isoOrNull(v, label) {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  const t = Date.parse(s);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || !Number.isFinite(t)) throw new HttpError(400, `${label} is not a valid date.`);
  return new Date(t).toISOString();
}

function text(v, label, max, { required = false } = {}) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
  return s;
}

export function cleanLink(v) {
  const s = String(v ?? '').trim();
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'The link must be a full https:// address.'); }
  if (u.protocol !== 'https:' || !/^https:\/\//i.test(s)) throw new HttpError(400, 'The link must start with https://.');
  if (u.username || u.password) throw new HttpError(400, 'The link cannot contain a username or password.');
  if (s.length > 2000) throw new HttpError(400, 'The link is too long.');
  return u.href;
}

export function cleanTargets(v) {
  if (v === undefined) return undefined;
  let list = v;
  if (typeof v === 'string') {
    try { list = JSON.parse(v || '[]'); } catch { throw new HttpError(400, 'Targets must be a list of category or tag slugs.'); }
  }
  if (!Array.isArray(list)) throw new HttpError(400, 'Targets must be a list of category or tag slugs.');
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string' || !SLUG.test(t) || t.length > 80) throw new HttpError(400, `"${String(t).slice(0, 40)}" is not a category or tag slug.`);
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > MAX_TARGETS) throw new HttpError(400, `Pick at most ${MAX_TARGETS} targets.`);
  return out;
}

// Editable fields from a request (form fields or JSON). Only fields present are returned.
export function cleanAdFields(input, { create = false } = {}) {
  const out = {};
  const name = text(input.name, 'Name', 120, { required: create || input.name !== undefined });
  if (name !== undefined) out.name = name;
  if (create || input.link_url !== undefined) out.link_url = cleanLink(input.link_url);
  const alt = text(input.alt, 'Alt text', 300);
  if (alt !== undefined) out.alt = alt;
  if (create || input.size !== undefined) {
    if (!Object.hasOwn(SIZES, String(input.size))) throw new HttpError(400, 'Size must be rail (300 × 600) or inline (728 × 90).');
    out.size = String(input.size);
  }
  const targets = cleanTargets(input.targets);
  if (targets !== undefined) out.targets = JSON.stringify(targets);
  if (input.is_default !== undefined) out.is_default = bool(input.is_default) ? 1 : 0;
  if (input.status !== undefined) {
    if (!['active', 'paused'].includes(String(input.status))) throw new HttpError(400, 'Status must be active or paused.');
    out.status = String(input.status);
  }
  const starts = isoOrNull(input.starts_at, 'Start date');
  if (starts !== undefined) out.starts_at = starts;
  const ends = isoOrNull(input.ends_at, 'End date');
  if (ends !== undefined) out.ends_at = ends;
  return out;
}

// Rules that involve several fields, checked on the ad as it will be saved.
export function checkAd(ad) {
  if (ad.starts_at && ad.ends_at && !(ad.ends_at > ad.starts_at)) throw new HttpError(400, 'The end date must be after the start date.');
  if (!parseTargets(ad.targets).length && Number(ad.is_default) !== 1) {
    throw new HttpError(400, 'Pick at least one category or tag, or make it a default ad.');
  }
}

// ---------- admin: image ----------
export async function readImage(file) {
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) return null;
  if (file.size > MAX_BYTES) throw new HttpError(413, `${file.name} is larger than 10 MB.`);
  if (file.size === 0) throw new HttpError(400, `${file.name} is empty.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) throw new HttpError(415, `${file.name} is not a JPG, PNG, WebP or GIF image.`);
  return { bytes, kind, base: baseName(file.name) };
}

export async function saveImage(bucket, img) {
  const key = await freeKey(bucket, FOLDER, img.base, img.kind.ext);
  await bucket.put(key, img.bytes, { httpMetadata: { contentType: img.kind.type, cacheControl: 'public, max-age=86400' } });
  return key;
}

// Leave a marker so the name is never reused, then delete. Only keys in ads/ are ever touched.
export async function deleteImage(bucket, key) {
  if (typeof key !== 'string' || !/^ads\/[a-z0-9-]+\.(jpg|png|gif|webp)$/.test(key)) return;
  await bucket.put(tombstone(key), new Uint8Array(0));
  await bucket.delete(key);
}

// Read an admin request body: multipart (with an optional "image" file) or JSON.
export async function readAdRequest(request) {
  const type = request.headers.get('content-type') || '';
  if (type.startsWith('multipart/form-data')) {
    let form;
    try { form = await request.formData(); } catch { throw new HttpError(400, 'The form could not be read.'); }
    const fields = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') fields[k] = v;
    return { fields, file: form.get('image') };
  }
  if (type.startsWith('application/json')) {
    try { return { fields: await request.json(), file: null }; } catch { throw new HttpError(400, 'Expected a JSON body.'); }
  }
  throw new HttpError(415, 'Send the ad as a form upload.');
}

export function describeAd(env, row, now = nowIso()) {
  const state = row.status === 'paused' ? 'paused'
    : row.starts_at && row.starts_at > now ? 'scheduled'
      : row.ends_at && row.ends_at <= now ? 'ended' : 'running';
  return { ...row, targets: parseTargets(row.targets), is_default: Number(row.is_default) === 1,
    image_url: publicUrl(env, row.image_key), state };
}
