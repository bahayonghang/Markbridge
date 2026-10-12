CREATE TABLE link_observations (
    profile_id TEXT NOT NULL,
    bookmark_id TEXT NOT NULL,
    url TEXT NOT NULL,
    class TEXT NOT NULL CHECK(class IN ('alive','gone','unknown')),
    http_status INTEGER,
    observed_at INTEGER NOT NULL
);
CREATE INDEX link_observations_lookup ON link_observations(profile_id, bookmark_id, observed_at);
CREATE TABLE maintenance_merges (
    operation_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    keeper_chrome_id TEXT NOT NULL,
    tag_names TEXT NOT NULL,
    added_tag_ids TEXT NOT NULL DEFAULT '[]',
    applied INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE metadata_fts USING fts5(
    bookmark_id UNINDEXED,
    profile_id UNINDEXED,
    summary,
    note,
    tokenize = 'trigram'
);
