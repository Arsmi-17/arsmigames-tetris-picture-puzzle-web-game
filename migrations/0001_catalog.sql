-- Picture catalog: metadata and URLs only. Image files live in R2.
CREATE TABLE pictures (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  thumb_url TEXT,
  alt TEXT NOT NULL,
  attribution TEXT,
  license TEXT,
  min_challenge INTEGER NOT NULL DEFAULT 0,
  max_challenge INTEGER NOT NULL DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'unpublished')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  content_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK (min_challenge <= max_challenge)
);

CREATE INDEX pictures_status_order ON pictures (status, sort_order);

-- Every attempt to write the public catalog, so a failed publish is visible
-- and can be retried.
CREATE TABLE catalog_publications (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  picture_count INTEGER,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  published_by TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  picture_id TEXT,
  detail TEXT
);
