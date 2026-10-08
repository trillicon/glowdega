// GET / PUT / DELETE /api/admin/posts/:id
import { handle, json, readJson, cleanFields, checkSlug, getPost, requireDb, state, nowIso, HttpError } from '../../../_lib/db.js';
import { taxonomy } from '../../../_lib/posts.js';

export const onRequestGet = handle(async ({ env, params }) => {
  const post = await getPost(env, params.id);
  return json({ post: { ...post, state: state(post) } });
});

// Edits apply immediately, including to published posts.
export const onRequestPut = handle(async (context) => {
  const { request, env, params } = context;
  const post = await getPost(env, params.id);
  const fields = cleanFields(await readJson(request), { categories: await taxonomy(env, request), keepCategory: post.category });
  delete fields.review_note;
  if (fields.title === '') throw new HttpError(400, 'Title cannot be empty.');
  if (fields.body_md === '') throw new HttpError(400, 'Body cannot be empty.');
  if (fields.slug !== undefined && fields.slug !== post.slug) await checkSlug(context, fields.slug, post.id);
  else delete fields.slug;

  const keys = Object.keys(fields);
  if (keys.length) {
    await requireDb(env).prepare(
      `UPDATE posts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ).bind(...keys.map((k) => fields[k]), nowIso(), post.id).run();
  }
  const updated = await getPost(env, post.id);
  return json({ post: { ...updated, state: state(updated) } });
});

// Only drafts and rejected posts can be deleted; unpublish a live post first.
export const onRequestDelete = handle(async ({ env, params }) => {
  const post = await getPost(env, params.id);
  if (post.status === 'approved') throw new HttpError(409, 'Unpublish this post before deleting it.');
  await requireDb(env).prepare('DELETE FROM posts WHERE id = ?').bind(post.id).run();
  return json({ deleted: post.id });
});
