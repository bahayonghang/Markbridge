use super::{Storage, cursor, storage_error};
use markbridge_protocol::{
    Counter, ErrorCode, FolderScope, Id, LibraryQuery, LibraryQueryPage, RequiredNullable,
    SourceEpoch,
};
use rusqlite::{OptionalExtension, named_params};

// One serial worker job reads the cursor, count and page from one SQLite snapshot.
// Values are bound parameters, including every search and pagination field.
impl Storage {
    pub async fn query_library(
        &self,
        profile_id: Id,
        query: LibraryQuery,
    ) -> Result<LibraryQueryPage, ErrorCode> {
        query.validate()?;
        self.call(move |conn| {
            let epoch: i64 = conn.query_row("SELECT source_epoch FROM profiles WHERE id=?1", [profile_id.as_str()], |row| row.get(0))
                .optional().map_err(storage_error)?.ok_or(ErrorCode::WrongProfile)?;
            let source_epoch = SourceEpoch::new(epoch as u64)?;
            let revision = cursor(conn, &profile_id)?.filter(|row| row.source_epoch == source_epoch).map(|row| row.revision).unwrap_or(Counter::new(0)?);
            if query.expected_revision.0.is_some_and(|expected| expected != revision)
                || query.expected_source_epoch.0.is_some_and(|expected| expected != source_epoch) {
                return Err(ErrorCode::Conflict);
            }
            if query.folder_scope != FolderScope::All {
                let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND chrome_id=?3 AND node_kind='folder' AND deleted_at IS NULL)",
                    rusqlite::params![profile_id.as_str(), epoch, query.folder_id.0.as_ref().map(Id::as_str)], |row| row.get(0)).map_err(storage_error)?;
                if !exists { return Err(ErrorCode::InvalidTree); }
            }
            let tags = serde_json::to_string(&query.tag_ids).map_err(|_| ErrorCode::InvalidMessage)?;
            let scope = match query.folder_scope { FolderScope::All => "all", FolderScope::Children => "children", FolderScope::Subtree => "subtree" };
            let fts = format!("\"{}\"", query.query.as_str().replace('"', "\"\""));
            let values = named_params! {
                ":profile": profile_id.as_str(), ":epoch": epoch,
                ":folder": query.folder_id.0.as_ref().map(Id::as_str), ":scope": scope,
                ":text": query.query.as_str(), ":tags": tags,
                ":summary": query.include_summary, ":note": query.include_note,
                ":short": query.query.as_str().chars().count() < 3, ":fts": fts,
                ":limit": query.limit.get() as i64, ":offset": query.offset.get() as i64,
            };
            let mut statement = conn.prepare(QUERY).map_err(storage_error)?;
            let mut rows = statement.query(values).map_err(storage_error)?;
            let mut total = 0;
            let mut items = Vec::new();
            while let Some(row) = rows.next().map_err(storage_error)? {
                total = row.get::<_, i64>(0).map_err(storage_error)? as u64;
                if let Some(json) = row.get::<_, Option<String>>(1).map_err(storage_error)? {
                    items.push(serde_json::from_str(&json).map_err(|_| ErrorCode::StorageError)?);
                }
            }
            let end = query.offset.get() + items.len() as u64;
            Ok(LibraryQueryPage { items, source_epoch, revision, total: Counter::new(total)?, offset: query.offset,
                next_offset: RequiredNullable(if end < total { Some(Counter::new(end)?) } else { None }) })
        }).await
    }
}

// Traverse folders through the parent index; bookmark leaves need no recursive
// lookup. CROSS JOIN keeps that index lookup inside the small parent walk instead
// of scanning the entire profile for each parent. Materialize matched identities
// once for count/page, then fetch node JSON for at most one page. The total's LEFT
// JOIN still returns a row when the page is empty or beyond the end.
const QUERY: &str = "WITH RECURSIVE
parents(chrome_id,path) AS (
  SELECT CASE WHEN :scope='all' THEN NULL ELSE :folder END,''
  UNION ALL
  SELECT c.chrome_id,t.path||printf('%06d:',c.position)||c.chrome_id||'/'
    FROM parents t CROSS JOIN bookmarks_cache c ON c.parent_id IS t.chrome_id
    WHERE c.profile_id=:profile AND c.source_epoch=:epoch AND c.deleted_at IS NULL
      AND c.node_kind='folder' AND :scope<>'children'
),
matches AS MATERIALIZED (
  SELECT c.bookmark_id,c.chrome_id,t.path||printf('%06d:',c.position)||c.chrome_id AS path
    FROM parents t CROSS JOIN bookmarks_cache c ON c.parent_id IS t.chrome_id
  LEFT JOIN bookmark_metadata m ON m.bookmark_id=c.bookmark_id
  WHERE c.profile_id=:profile AND c.source_epoch=:epoch AND c.deleted_at IS NULL
  AND (:text='' OR instr(c.title,:text)>0 OR instr(COALESCE(c.url,''),:text)>0
    OR (((:summary AND instr(COALESCE(m.summary,''),:text)>0) OR (:note AND instr(COALESCE(m.note,''),:text)>0))
      AND (:short OR c.bookmark_id IN (SELECT bookmark_id FROM metadata_fts WHERE metadata_fts MATCH :fts AND profile_id=:profile))))
  AND NOT EXISTS (SELECT 1 FROM json_each(:tags) wanted WHERE NOT EXISTS
    (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id=c.bookmark_id AND bt.tag_id=wanted.value))
),
page AS (
  SELECT bookmark_id,chrome_id,path FROM matches ORDER BY path,chrome_id LIMIT :limit OFFSET :offset
)
SELECT totals.total,c.node_json FROM (SELECT count(*) AS total FROM matches) totals
LEFT JOIN page ON true
LEFT JOIN bookmarks_cache c ON c.bookmark_id=page.bookmark_id
ORDER BY page.path,page.chrome_id";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{PairedOrigin, Profile};
    use markbridge_protocol::{BookmarkNode, DisplayName, Title, TreeSnapshot};
    use std::time::Instant;

    // Explicit diagnostic only: seed a fresh temporary database from an isolated
    // synthetic fixture. This does not open or mutate the native acceptance cache.
    #[tokio::test]
    #[ignore = "set MARKBRIDGE_LIBRARY_BENCH_FIXTURE to the isolated B10K nodes.json"]
    async fn library_query_b10k_diagnostic() {
        let fixture = std::env::var("MARKBRIDGE_LIBRARY_BENCH_FIXTURE").unwrap();
        let nodes: Vec<BookmarkNode> =
            serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        assert_eq!(nodes.len(), 11004);
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("query.sqlite"))
            .await
            .unwrap();
        let id = Id::new("benchmark").unwrap();
        let epoch = SourceEpoch::new(1).unwrap();
        let one = Counter::new(1).unwrap();
        storage
            .create_profile(Profile {
                id: id.clone(),
                instance_id: Id::new("benchmark-instance").unwrap(),
                source_epoch: epoch,
                display_name: DisplayName::new("Synthetic B10K").unwrap(),
                paired_origin: PairedOrigin::new(
                    "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                )
                .unwrap(),
                credential_reference: None,
            })
            .await
            .unwrap();
        storage
            .replace_tree(
                id.clone(),
                Id::new("benchmark-session").unwrap(),
                TreeSnapshot {
                    source_epoch: epoch,
                    revision: one,
                    barrier_seq: one,
                    nodes,
                },
            )
            .await
            .unwrap();
        storage
            .call(|conn| {
                let version: String = conn
                    .query_row("SELECT sqlite_version()", [], |row| row.get(0))
                    .map_err(storage_error)?;
                println!("SQLite {version}; synthetic nodes=11004; no native acceptance claim");
                {
                    let mut statement = conn
                        .prepare(&format!("EXPLAIN QUERY PLAN {QUERY}"))
                        .map_err(storage_error)?;
                    let mut rows = statement.raw_query();
                    println!("PLAN combined count and page");
                    while let Some(row) = rows.next().map_err(storage_error)? {
                        println!("{}", row.get::<_, String>(3).map_err(storage_error)?);
                    }
                }
                Ok(())
            })
            .await
            .unwrap();
        for (name, scope, folder, text, total) in [
            ("marker", FolderScope::All, None, "MB05MARK", 1),
            ("children", FolderScope::Children, Some("0"), "", 3),
            ("all", FolderScope::All, None, "", 11004),
        ] {
            let query = LibraryQuery {
                folder_id: RequiredNullable(folder.map(|value| Id::new(value).unwrap())),
                folder_scope: scope,
                query: Title::new(text).unwrap(),
                tag_ids: vec![],
                include_summary: false,
                include_note: false,
                offset: Counter::new(0).unwrap(),
                limit: Counter::new(200).unwrap(),
                expected_revision: RequiredNullable(None),
                expected_source_epoch: RequiredNullable(None),
            };
            let mut samples = Vec::new();
            for sample in 0..31 {
                let started = Instant::now();
                let page = storage
                    .query_library(id.clone(), query.clone())
                    .await
                    .unwrap();
                let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(page.total.get(), total);
                if sample > 0 {
                    samples.push(elapsed);
                }
            }
            println!("{name} samples_ms={samples:?}");
            samples.sort_by(f64::total_cmp);
            println!(
                "{name} median_ms={:.3} p95_ms={:.3} max_ms={:.3}",
                samples[14], samples[28], samples[29]
            );
        }
        storage.close().await.unwrap();
    }
}
