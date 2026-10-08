// /api/admin/ads — ads shown in article slots (see functions/_lib/ads.js).
//   GET              every ad with its views and clicks, newest first
//   POST multipart   "image" file + name, link_url, alt, size, targets (JSON array), is_default, starts_at, ends_at
import { handle, json, requireDb, nowIso, HttpError } from '../../../_lib/db.js';
import { requireBucket } from '../../../_lib/images.js';
import { cleanAdFields, checkAd, readAdRequest, readImage, saveImage, describeAd } from '../../../_lib/ads.js';

export const onRequestGet = handle(async ({ env }) => {
  const { results } = await requireDb(env).prepare('SELECT * FROM ads ORDER BY created_at DESC, id DESC').all();
  const now = nowIso();
  return json({ now, ads: results.map((r) => describeAd(env, r, now)) });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const db = requireDb(env);
  const bucket = requireBucket(env);
  if (!(request.headers.get('content-type') || '').startsWith('multipart/form-data')) {
    throw new HttpError(415, 'Send the ad as a form upload with its image.');
  }
  const { fields, file } = await readAdRequest(request);
  const ad = { targets: '[]', is_default: 0, status: 'active', starts_at: null, ends_at: null, ...cleanAdFields(fields, { create: true }) };
  if (!ad.alt) ad.alt = ad.name;
  checkAd(ad);
  const img = await readImage(file);
  if (!img) throw new HttpError(400, 'Choose an image for the ad.');

  const key = await saveImage(bucket, img);
  const now = nowIso();
  const row = await db.prepare(
    `INSERT INTO ads (name, image_key, link_url, alt, size, targets, is_default, status, starts_at, ends_at, views, clicks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?) RETURNING *`,
  ).bind(ad.name, key, ad.link_url, ad.alt, ad.size, ad.targets, ad.is_default, ad.status, ad.starts_at, ad.ends_at, now, now).first();
  return json({ ad: describeAd(env, row) }, 201);
});
