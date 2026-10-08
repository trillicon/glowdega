// Photo library for /admin: files live in the R2 bucket glowdega-images (binding IMAGES) and are served
// publicly from https://images.glowdega.com/<key>.
//
// env.IMAGES         R2 bucket binding
// env.IMAGES_PREFIX  folder uploads go to: "posts/" is set on production only; unset means "preview/",
//                    so a preview deployment can never write into the real folder
// env.IMAGES_BASE    public base URL (default https://images.glowdega.com)
import { HttpError } from './db.js';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 20;

// Types are decided by the file's first bytes, never by its name or the browser's claim.
const SIGNATURES = [
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { ext: 'gif', type: 'image/gif', test: (b) => String.fromCharCode(...b.slice(0, 4)) === 'GIF8' },
  { ext: 'webp', type: 'image/webp', test: (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
];

export function sniff(bytes) {
  const head = bytes.subarray(0, 12);
  return SIGNATURES.find((s) => s.test(head)) || null;
}

export const prefix = (env) => {
  const p = String(env.IMAGES_PREFIX || 'preview/').replace(/^\/+/, '');
  if (!/^[a-z0-9-]+\/$/.test(p)) throw new HttpError(500, 'IMAGES_PREFIX must look like "posts/".');
  return p;
};

export const publicUrl = (env, key) => `${String(env.IMAGES_BASE || 'https://images.glowdega.com').replace(/\/+$/, '')}/${key}`;

// "Silk Press (final) Ñ.JPG" -> "silk-press-final-n"
export function baseName(filename) {
  const stem = String(filename || '').replace(/\.[^./\\]*$/, '').split(/[/\\]/).pop();
  const clean = stem.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return clean || 'image';
}

// A key inside this environment's folder made only of safe characters.
export function isOwnKey(env, key) {
  const p = prefix(env);
  return typeof key === 'string' && key.startsWith(p) && /^[a-z0-9-]+\/[a-z0-9-]+\.(jpg|png|gif|webp)$/.test(key);
}

export function requireBucket(env) {
  if (!env.IMAGES) throw new HttpError(503, 'Image storage is not connected yet.');
  return env.IMAGES;
}

// Never overwrite: silk-press.jpg, then silk-press-2.jpg, silk-press-3.jpg…
export async function freeKey(bucket, folder, base, ext) {
  for (let n = 1; n <= 200; n++) {
    const key = `${folder}${base}${n === 1 ? '' : '-' + n}.${ext}`;
    if (!(await bucket.head(key))) return key;
  }
  throw new HttpError(409, `Too many files named ${base}. Rename the file and try again.`);
}

export const describe = (env, o) => ({
  key: o.key,
  name: o.key.slice(o.key.indexOf('/') + 1),
  url: publicUrl(env, o.key),
  size: o.size,
  uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : o.uploaded,
});
