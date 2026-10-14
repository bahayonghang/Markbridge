CREATE TABLE semantic_settings (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    endpoint TEXT,
    model TEXT
);
INSERT INTO semantic_settings(singleton) VALUES(1);
CREATE TABLE semantic_indexes (
    index_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id),
    source_epoch INTEGER NOT NULL,
    generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
    phase TEXT NOT NULL CHECK(phase IN ('running','paused','ready','failed','stale')),
    model TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    digest TEXT,
    dimension INTEGER CHECK(dimension BETWEEN 1 AND 4096),
    recipe INTEGER NOT NULL CHECK(recipe=1),
    failure TEXT
);
CREATE TABLE semantic_members (
    index_id TEXT NOT NULL REFERENCES semantic_indexes(index_id) ON DELETE CASCADE,
    bookmark_id TEXT NOT NULL REFERENCES bookmarks_cache(bookmark_id),
    state TEXT NOT NULL CHECK(state IN ('pending','ready')),
    fingerprint TEXT,
    vector BLOB,
    PRIMARY KEY(index_id,bookmark_id)
);
CREATE TRIGGER semantic_summary_insert AFTER INSERT ON bookmark_metadata
WHEN NEW.summary IS NOT NULL
BEGIN
    UPDATE semantic_indexes SET phase='paused' WHERE phase='ready' AND index_id IN (SELECT index_id FROM semantic_members WHERE bookmark_id=NEW.bookmark_id);
    UPDATE semantic_members SET state='pending',fingerprint=NULL,vector=NULL WHERE bookmark_id=NEW.bookmark_id;
END;
CREATE TRIGGER semantic_summary_update AFTER UPDATE OF summary ON bookmark_metadata
WHEN OLD.summary IS NOT NEW.summary
BEGIN
    UPDATE semantic_indexes SET phase='paused' WHERE phase='ready' AND index_id IN (SELECT index_id FROM semantic_members WHERE bookmark_id=NEW.bookmark_id);
    UPDATE semantic_members SET state='pending',fingerprint=NULL,vector=NULL WHERE bookmark_id=NEW.bookmark_id;
END;
CREATE TRIGGER semantic_summary_delete AFTER DELETE ON bookmark_metadata
WHEN OLD.summary IS NOT NULL
BEGIN
    UPDATE semantic_indexes SET phase='paused' WHERE phase='ready' AND index_id IN (SELECT index_id FROM semantic_members WHERE bookmark_id=OLD.bookmark_id);
    UPDATE semantic_members SET state='pending',fingerprint=NULL,vector=NULL WHERE bookmark_id=OLD.bookmark_id;
END;
CREATE TRIGGER semantic_title_update AFTER UPDATE OF title ON bookmarks_cache
WHEN OLD.title IS NOT NEW.title
BEGIN
    UPDATE semantic_indexes SET phase='paused' WHERE phase='ready' AND index_id IN (SELECT index_id FROM semantic_members WHERE bookmark_id=NEW.bookmark_id);
    UPDATE semantic_members SET state='pending',fingerprint=NULL,vector=NULL WHERE bookmark_id=NEW.bookmark_id;
END;
