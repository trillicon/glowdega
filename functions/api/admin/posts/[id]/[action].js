// POST /api/admin/posts/:id/approve    { publish_at? }  — publish now, or at a future time (ISO 8601)
// POST /api/admin/posts/:id/reject     { note? }
// POST /api/admin/posts/:id/unpublish  — take a published or scheduled post back to draft
import { handle, json, readJson, getPost, requireDb, state, nowIso, HttpError } from '../../../../_lib/db.js';

const ACTIONS = {
  async approve(post, body) {
    let when = nowIso();
    if (body.publish_at) {
      const t = Date.parse(body.publish_at);
      if (Number.isNaN(t)) throw new HttpError(400, 'Invalid publish date.');
      if (t > Date.now() + 366 * 864e5) throw new HttpError(400, 'Publish date is more than a year away.');
      when = new Date(Math.max(t, Date.now())).toISOString();
    }
    if (!post.title || !post.body_md) throw new HttpError(400, 'A post needs a title and a body before it can be approved.');
    return { status: 'approved', publish_at: when, review_note: '' };
  },
  async reject(post, body) {
    if (post.status === 'approved') throw new HttpError(409, 'Unpublish this post before rejecting it.');
    return { status: 'rejected', publish_at: null, review_note: String(body.note || '').slice(0, 2000) };
  },
  async unpublish(post) {
    if (post.status !== 'approved') throw new HttpError(409, 'This post is not published or scheduled.');
    return { status: 'draft', publish_at: null };
  },
};

export const onRequestPost = handle(async ({ request, env, params, data }) => {
  const action = ACTIONS[params.action];
  if (!action) throw new HttpError(404, 'Unknown action.');
  const post = await getPost(env, params.id);
  const body = request.headers.get('content-length') === '0' ? {} : await readJson(request).catch(() => ({}));
  const changes = { ...(await action(post, body)), reviewed_by: data.adminEmail, reviewed_at: nowIso(), updated_at: nowIso() };

  const keys = Object.keys(changes);
  await requireDb(env).prepare(`UPDATE posts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => changes[k]), post.id).run();
  const updated = await getPost(env, post.id);
  return json({ post: { ...updated, state: state(updated) } });
});
