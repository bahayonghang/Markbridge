ALTER TABLE bookmark_metadata ADD COLUMN raw_title TEXT;
ALTER TABLE bookmark_metadata ADD COLUMN last_encoded_title TEXT;
CREATE TABLE tag_journal (
    journal_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id),
    created_at INTEGER NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0,
    before_json TEXT NOT NULL
);
CREATE INDEX bookmark_tags_tag ON bookmark_tags(tag_id);
