ALTER TABLE preview_cache ADD COLUMN last_used INTEGER NOT NULL DEFAULT 0;
CREATE INDEX preview_cache_lru ON preview_cache(last_used);
