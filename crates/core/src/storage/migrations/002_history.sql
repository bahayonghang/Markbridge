CREATE TABLE operations (
    operation_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id),
    source_epoch INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('planned','applying','applied','uncertain','partial','failed','rolling_back','rolled_back','rollback_conflict')),
    before_json TEXT NOT NULL,
    after_json TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE operation_steps (
    operation_id TEXT NOT NULL REFERENCES operations(operation_id),
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    request_id TEXT NOT NULL UNIQUE,
    target TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('create','update','move','reorder','delete')),
    expected_before TEXT,
    expected_child_ids TEXT,
    payload TEXT NOT NULL,
    receipt TEXT,
    PRIMARY KEY(operation_id,ordinal)
);
CREATE TABLE snapshots (
    operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id),
    schema_version INTEGER NOT NULL,
    tree_before TEXT NOT NULL,
    metadata_before TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    html_backup_path TEXT NOT NULL,
    sidecar_backup_path TEXT NOT NULL
);
CREATE TABLE preview_cache (
    bookmark_id TEXT PRIMARY KEY REFERENCES bookmarks_cache(bookmark_id),
    url_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    safe_metadata TEXT,
    text_excerpt TEXT,
    image_reference TEXT,
    fetched_at INTEGER,
    size INTEGER NOT NULL CHECK(size >= 0)
);
CREATE TABLE ai_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id),
    input_fingerprint TEXT NOT NULL,
    model_reference TEXT NOT NULL,
    provider_reference TEXT NOT NULL,
    state TEXT NOT NULL,
    proposal TEXT,
    error_code TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
