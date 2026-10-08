// /api/admin/ads/:id
//   PUT     multipart or JSON: any of name, link_url, alt, size, targets, is_default, status, starts_at, ends_at;
//           multipart may also carry a new "image" (the old file is deleted and its name never reused)
//   DELETE  removes the ad and its image
import { handle, json, requireDb, nowIso, HttpError } from '../../../_lib/db.js';
import { requireBucket } from '../../../_lib/images.js';
import { cleanAdFields, checkAd, readAdRequest, readImage, saveImage, deleteImage, describeAd } from '../../../_lib/ads.js';

async function getAd(db, id) {
  if (!/^\d{1,12}$/.test(String(id))) throw new HttpError(404, 'Ad not found.');
  const ad = await db.prepare('SELECT * FROM ads WHERE id = ?').bind(Number(id)).first();
  if (!ad) throw new HttpError(404, 'Ad not found.');
  return ad;
}

export const onRequestPut = handle(async ({ request, env, params }) => {
  const db = requireDb(env);
  const ad = await getAd(db, params.id);
  const { fields, file } = await readAdRequest(request);
  const changes = cleanAdFields(fields);
  if (changes.alt === '') changes.alt = changes.name || ad.name;
  checkAd({ ...ad, ...changes });
  const img = await readImage(file);
  let oldKey = null;
  if (img) {
    const bucket = requireBucket(env);
    changes.image_key = await saveImage(bucket, img);
    oldKey = ad.image_key;
  }
  const keys = Object.keys(changes);
  if (keys.length) {
    await db.prepare(`UPDATE ads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => changes[k]), nowIso(), ad.id).run();
  }
  if (oldKey && oldKey !== changes.image_key) await deleteImage(requireBucket(env), oldKey);
  return json({ ad: describeAd(env, await getAd(db, ad.id)) });
});

export const onRequestDelete = handle(async ({ env, params }) => {
  const db = requireDb(env);
  const ad = await getAd(db, params.id);
  await db.prepare('DELETE FROM ads WHERE id = ?').bind(ad.id).run();
  if (env.IMAGES) await deleteImage(env.IMAGES, ad.image_key);
  return json({ deleted: ad.id });
});
