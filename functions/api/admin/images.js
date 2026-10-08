// /api/admin/images — the photo library (R2 bucket glowdega-images).
//   GET               every photo in this environment's folder, newest first
//   POST  multipart   one or more "file" fields; returns the saved photos and their public URLs
//   DELETE ?key=…     removes one photo from this environment's folder
import { handle, json, HttpError } from '../../_lib/db.js';
import { MAX_BYTES, MAX_FILES, sniff, prefix, baseName, isOwnKey, requireBucket, freeKey, describe } from '../../_lib/images.js';

export const onRequestGet = handle(async ({ env }) => {
  const bucket = requireBucket(env);
  const folder = prefix(env);
  const images = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: folder, cursor, limit: 1000 });
    for (const o of page.objects) if (isOwnKey(env, o.key)) images.push(describe(env, o));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && images.length < 5000);
  images.sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)) || a.key.localeCompare(b.key));
  return json({ folder, images });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const bucket = requireBucket(env);
  const folder = prefix(env);
  if (!(request.headers.get('content-type') || '').startsWith('multipart/form-data')) {
    throw new HttpError(415, 'Send the photos as a file upload.');
  }
  let form;
  try { form = await request.formData(); } catch { throw new HttpError(400, 'The upload could not be read.'); }
  const files = form.getAll('file').filter((f) => typeof f === 'object' && f && 'arrayBuffer' in f);
  if (!files.length) throw new HttpError(400, 'Choose at least one photo.');
  if (files.length > MAX_FILES) throw new HttpError(400, `Upload at most ${MAX_FILES} photos at a time.`);

  // Check every file before saving any, so a bad file never leaves a half-finished upload.
  const ready = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) throw new HttpError(413, `${f.name} is larger than 10 MB.`);
    if (f.size === 0) throw new HttpError(400, `${f.name} is empty.`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) throw new HttpError(415, `${f.name} is not a JPG, PNG, WebP or GIF image.`);
    ready.push({ bytes, kind, base: baseName(f.name) });
  }

  const saved = [];
  for (const { bytes, kind, base } of ready) {
    const key = await freeKey(bucket, folder, base, kind.ext);
    const obj = await bucket.put(key, bytes, { httpMetadata: { contentType: kind.type, cacheControl: 'public, max-age=86400' } });
    saved.push(describe(env, obj));
  }
  return json({ images: saved }, 201);
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const bucket = requireBucket(env);
  const key = new URL(request.url).searchParams.get('key');
  if (!isOwnKey(env, key)) throw new HttpError(400, 'That is not a photo in this library.');
  if (!(await bucket.head(key))) throw new HttpError(404, 'That photo is already gone.');
  await bucket.delete(key);
  return json({ deleted: key });
});
