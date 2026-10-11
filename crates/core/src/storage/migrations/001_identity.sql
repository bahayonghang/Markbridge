CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    source_epoch INTEGER NOT NULL CHECK(source_epoch >= 1),
    display_name TEXT NOT NULL,
    pairing_state TEXT NOT NULL CHECK(pairing_state IN ('paired','revoked')),
    last_synced_at INTEGER,
    paired_origin TEXT NOT NULL,
    credential_reference TEXT
);
CREATE TABLE mirror_sources (
    id TEXT PRIMARY KEY,
    selected_path TEXT NOT NULL,
    paired_profile_id TEXT REFERENCES profiles(id),
    association_status TEXT NOT NULL CHECK(association_status IN ('independent','confirmed'))
);
CREATE TABLE bookmarks_cache (
    bookmark_id TEXT PRIMARY KEY DEFAULT ('b:' || lower(hex(randomblob(16)))),
    profile_id TEXT NOT NULL REFERENCES profiles(id),
    source_epoch INTEGER NOT NULL CHECK(source_epoch >= 1),
    chrome_id TEXT NOT NULL,
    parent_id TEXT,
    position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 100000),
    node_kind TEXT NOT NULL CHECK(node_kind IN ('folder','bookmark')),
    title TEXT NOT NULL,
    url TEXT,
    folder_type TEXT,
    unmodifiable TEXT,
    node_json TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision >= 0),
    deleted_at INTEGER,
    UNIQUE(profile_id,source_epoch,chrome_id)
);
CREATE INDEX cache_parent ON bookmarks_cache(profile_id,source_epoch,parent_id,position);
CREATE TABLE bookmark_metadata (
    bookmark_id TEXT PRIMARY KEY REFERENCES bookmarks_cache(bookmark_id),
    display_title TEXT,
    summary TEXT,
    note TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE
);
CREATE TABLE bookmark_tags (
    bookmark_id TEXT NOT NULL REFERENCES bookmarks_cache(bookmark_id),
    tag_id TEXT NOT NULL REFERENCES tags(id),
    PRIMARY KEY(bookmark_id,tag_id)
);
CREATE TABLE source_cursors (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id),
    source_epoch INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    last_seq INTEGER NOT NULL CHECK(last_seq >= 0),
    revision INTEGER NOT NULL CHECK(revision >= 0)
);
-- Mirror cache identity never shares the profile namespace or local sidecar ID.
CREATE TABLE mirror_bookmarks (
    mirror_source_id TEXT NOT NULL REFERENCES mirror_sources(id),
    chrome_id TEXT NOT NULL,
    node_json TEXT NOT NULL,
    PRIMARY KEY(mirror_source_id,chrome_id)
);
