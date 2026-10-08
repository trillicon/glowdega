-- Categories and tags. Categories come from assets/taxonomy.json (validated in functions/_lib/db.js).
-- Tags of posts written in /admin: a JSON list of names.
ALTER TABLE posts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

-- Category and tags the admin set for ARCHIVE posts (assets/posts.json), applied when they are served.
CREATE TABLE IF NOT EXISTS post_terms (
  slug        TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL
);

-- Old free-text categories that have an approved equivalent. Others (e.g. "Admin") stay as they are: the editor shows
-- them as an old category and asks for a new one before publishing.
UPDATE posts SET category = 'Hair & Scalp' WHERE lower(trim(category)) IN ('hair', 'scalp', 'hair care');
UPDATE posts SET category = 'Acne' WHERE lower(trim(category)) = 'acne';
UPDATE posts SET category = 'Skingredients' WHERE lower(trim(category)) IN ('skingredients', 'ingredients');
UPDATE posts SET category = 'Skin Conditions' WHERE lower(trim(category)) = 'skin conditions';
UPDATE posts SET category = 'Skin Care Scams' WHERE lower(trim(category)) = 'skin care scams';
UPDATE posts SET category = 'Hyperpigmentation' WHERE lower(trim(category)) = 'hyperpigmentation';
UPDATE posts SET category = 'Health & Wellness' WHERE lower(trim(category)) IN ('health', 'self care', 'wellness', 'food', 'nutrition');
UPDATE posts SET category = 'Hair Removal' WHERE lower(trim(category)) IN ('hair removal', 'sugaring', 'waxing');
UPDATE posts SET category = 'Sun Care' WHERE lower(trim(category)) IN ('sun care', 'sunscreen');
UPDATE posts SET category = 'Esthetician Life & Business' WHERE lower(trim(category)) IN ('business', 'esthetician life');
UPDATE posts SET category = 'Skin Care Routines' WHERE lower(trim(category)) IN ('skin care', 'skincare', 'skin care routine', 'routines');
