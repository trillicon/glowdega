-- Small key/value settings written by automation. functions/_lib/posts.js also creates this table if missing.
-- home_ranking: {"ranked": [slug, ...], "terms": [{term, score}], "generated": "YYYY-MM-DD"} from PUT /api/trending.
CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
