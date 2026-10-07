// GET /api/admin/posts — every post in the review queue, newest activity first.
import { handle, json, requireDb, state, nowIso } from '../../../_lib/db.js';

export const onRequestGet = handle(async ({ env, data }) => {
  const { results } = await requireDb(env).prepare(
    `SELECT id, slug, title, category, status, publish_at, source, review_note, reviewed_by, reviewed_at, created_at, updated_at
       FROM posts ORDER BY updated_at DESC`,
  ).all();
  const now = nowIso();
  return json({ admin: data.adminEmail, now, posts: results.map((p) => ({ ...p, state: state(p, now) })) });
});
