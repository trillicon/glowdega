-- Gazette posts written outside the static archive (AI drafts reviewed in /admin).
-- A post is live when status = 'approved' and publish_at <= now (UTC, ISO 8601).
CREATE TABLE posts (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '',
  hero_image   TEXT NOT NULL DEFAULT '',
  body_md      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  publish_at   TEXT,
  source       TEXT NOT NULL DEFAULT '',
  review_note  TEXT NOT NULL DEFAULT '',
  reviewed_by  TEXT NOT NULL DEFAULT '',
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX posts_live ON posts (status, publish_at);
