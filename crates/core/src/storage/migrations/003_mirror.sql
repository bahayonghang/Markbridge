ALTER TABLE mirror_sources ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE mirror_sources ADD COLUMN file_status TEXT NOT NULL DEFAULT 'stale';
ALTER TABLE mirror_sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mirror_sources ADD COLUMN last_read_at INTEGER;
ALTER TABLE mirror_sources ADD COLUMN error_code TEXT;
ALTER TABLE mirror_sources ADD COLUMN watching INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX mirror_source_path ON mirror_sources(selected_path);
