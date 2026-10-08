-- Ads shown in article slots (functions/_lib/ads.js). Managed in /admin → Ads.
-- size:    'rail' = 300x600 beside the text, 'inline' = 728x90 between photo/meta and text
-- targets: JSON array of term slugs (category or tag slugs, e.g. ["acne","skin-care"])
-- An ad runs when status = 'active' and now is in [starts_at, ends_at) (NULL = open-ended).
-- AUTOINCREMENT: a deleted ad's id (and its /go/ad/<id> link) is never given to a new ad.
CREATE TABLE IF NOT EXISTS ads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  image_key   TEXT NOT NULL,
  link_url    TEXT NOT NULL CHECK (link_url LIKE 'https://%'),
  alt         TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL CHECK (size IN ('rail', 'inline')),
  targets     TEXT NOT NULL DEFAULT '[]',
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  starts_at   TEXT,
  ends_at     TEXT,
  views       INTEGER NOT NULL DEFAULT 0,
  clicks      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ads_running ON ads (status, size);
