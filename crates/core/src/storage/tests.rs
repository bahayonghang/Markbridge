use super::*;
use markbridge_protocol::{FolderType, NodeKind, Position, Title, Unmodifiable, Url};
fn id(value: &str) -> Id {
    Id::new(value).unwrap()
}
fn count(value: u64) -> Counter {
    Counter::new(value).unwrap()
}
fn epoch(value: u64) -> SourceEpoch {
    SourceEpoch::new(value).unwrap()
}
fn profile(value: &str) -> Profile {
    Profile {
        id: id(value),
        instance_id: id(&format!("instance-{value}")),
        source_epoch: epoch(1),
        display_name: DisplayName::new(value).unwrap(),
        paired_origin: PairedOrigin::new("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .unwrap(),
        credential_reference: Some(id("credential-reference")),
    }
}
fn node(value: &str, parent: Option<&str>, position: u64, url: Option<&str>) -> BookmarkNode {
    BookmarkNode {
        chrome_id: id(value),
        parent_id: parent.map(id),
        position: Position::new(position).unwrap(),
        kind: if url.is_some() {
            NodeKind::Bookmark
        } else {
            NodeKind::Folder
        },
        title: Title::new(format!("合成 {value}")).unwrap(),
        url: url.map(|v| Url::new(v).unwrap()),
        folder_type: None,
        unmodifiable: None,
        date_added: None,
        date_last_used: None,
    }
}
fn tree(revision: u64) -> TreeSnapshot {
    let mut nodes = vec![
        node("0", None, 0, None),
        node("1", Some("0"), 0, None),
        node("2", Some("0"), 1, None),
        node(
            "42",
            Some("1"),
            0,
            Some("https://example.invalid/duplicate"),
        ),
        node(
            "43",
            Some("1"),
            1,
            Some("https://example.invalid/duplicate"),
        ),
        node("managed", Some("0"), 2, None),
        node(
            "managed-child",
            Some("managed"),
            0,
            Some("javascript:alert(1)"),
        ),
    ];
    nodes[1].folder_type = Some(FolderType::BookmarksBar);
    nodes[2].folder_type = Some(FolderType::BookmarksBar);
    nodes[5].unmodifiable = Some(Unmodifiable::Managed);
    nodes[5].folder_type = Some(FolderType::Managed);
    TreeSnapshot {
        source_epoch: epoch(1),
        revision: count(revision),
        barrier_seq: count(revision),
        nodes,
    }
}
fn metadata() -> Metadata {
    Metadata {
        display_title: Some("本地标题".into()),
        summary: Some("合成摘要".into()),
        note: "local-only".into(),
        updated_at: count(123),
    }
}

#[tokio::test]
async fn empty_database_enables_wal_foreign_keys_and_numbered_schema() {
    let directory = tempfile::tempdir().unwrap();
    let storage = Storage::open(directory.path().join("app.sqlite"))
        .await
        .unwrap();
    assert!(storage.migration_backup.is_none());
    storage
        .call(|conn| {
            assert_eq!(
                conn.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                    .unwrap(),
                SCHEMA_VERSION
            );
            assert_eq!(
                conn.pragma_query_value(None, "journal_mode", |r| r.get::<_, String>(0))
                    .unwrap(),
                "wal"
            );
            assert_eq!(
                conn.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))
                    .unwrap(),
                1
            );
            assert!(
                conn.execute(
                    "INSERT INTO bookmark_metadata VALUES('missing',NULL,NULL,'',0)",
                    []
                )
                .is_err()
            );
            for name in [
                "operations",
                "operation_steps",
                "snapshots",
                "ai_jobs",
                "preview_cache",
                "settings",
                "mirror_sources",
                "mirror_bookmarks",
            ] {
                assert!(
                    conn.query_row("SELECT 1 FROM sqlite_master WHERE name=?1", [name], |_| Ok(
                        ()
                    ))
                    .is_ok()
                );
            }
            Ok(())
        })
        .await
        .unwrap();
    storage.close().await.unwrap();
}
#[tokio::test]
async fn profiles_epochs_duplicates_managed_and_sidecars_remain_separate() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let storage = Storage::open(&path).await.unwrap();
    for p in ["profile-a", "profile-b"] {
        storage.create_profile(profile(p)).await.unwrap();
        storage
            .replace_tree(id(p), id("session-a"), tree(1))
            .await
            .unwrap();
    }
    let a = storage.bookmarks(id("profile-a"), epoch(1)).await.unwrap();
    let b = storage.bookmarks(id("profile-b"), epoch(1)).await.unwrap();
    assert_eq!(a.len(), 7);
    assert_eq!(b.len(), 7);
    for node in &a {
        assert!(!b.iter().any(|other| other.bookmark_id == node.bookmark_id));
    }
    let a42 = a
        .iter()
        .find(|n| n.node.chrome_id == id("42"))
        .unwrap()
        .bookmark_id
        .clone();
    let a43 = a
        .iter()
        .find(|n| n.node.chrome_id == id("43"))
        .unwrap()
        .bookmark_id
        .clone();
    storage.set_metadata(a42.clone(), metadata()).await.unwrap();
    assert_eq!(storage.metadata(a43).await.unwrap(), None);
    let protected = tree(1);
    let protected = protected.protected_ids().unwrap();
    assert_eq!(protected.len(), 5);
    assert!(protected.contains("managed-child"));
    assert!(!protected.contains("42"));
    let mut refreshed = tree(2);
    refreshed.nodes.retain(|n| n.chrome_id != id("42"));
    storage
        .replace_tree(id("profile-a"), id("session-a"), refreshed)
        .await
        .unwrap();
    assert_eq!(
        storage.metadata(a42.clone()).await.unwrap(),
        Some(metadata())
    );
    assert!(
        storage
            .bookmarks(id("profile-a"), epoch(1))
            .await
            .unwrap()
            .iter()
            .find(|n| n.bookmark_id == a42)
            .unwrap()
            .deleted_at
            .is_some()
    );
    storage
        .replace_tree(id("profile-a"), id("session-b"), tree(3))
        .await
        .unwrap();
    let restored = storage.bookmarks(id("profile-a"), epoch(1)).await.unwrap();
    let restored42 = restored
        .iter()
        .find(|n| n.node.chrome_id == id("42"))
        .unwrap();
    assert_eq!(restored42.bookmark_id, a42);
    assert_eq!(restored42.deleted_at, None);
    storage
        .reset_source_epoch(id("profile-a"), epoch(2))
        .await
        .unwrap();
    let mut new_epoch = tree(1);
    new_epoch.source_epoch = epoch(2);
    storage
        .replace_tree(id("profile-a"), id("new-session"), new_epoch)
        .await
        .unwrap();
    let new = storage.bookmarks(id("profile-a"), epoch(2)).await.unwrap();
    let new42 = new.iter().find(|n| n.node.chrome_id == id("42")).unwrap();
    assert_ne!(new42.bookmark_id, a42);
    assert_eq!(
        storage.metadata(new42.bookmark_id.clone()).await.unwrap(),
        None
    );
    assert_eq!(
        storage.metadata(a42.clone()).await.unwrap(),
        Some(metadata())
    );
    storage.close().await.unwrap();
    let storage = Storage::open(&path).await.unwrap();
    assert_eq!(storage.metadata(a42).await.unwrap(), Some(metadata()));
    storage.close().await.unwrap();
}
#[tokio::test]
async fn invalid_tree_wrong_profile_stale_revision_and_interrupted_commit_keep_last_cache_cursor() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let storage = Storage::open(&path).await.unwrap();
    storage.create_profile(profile("a")).await.unwrap();
    storage
        .replace_tree(id("a"), id("s"), tree(1))
        .await
        .unwrap();
    let before = storage.bookmarks(id("a"), epoch(1)).await.unwrap();
    let cursor_before = storage.cursor(id("a")).await.unwrap();
    let mut invalid = tree(2);
    invalid.nodes[1].parent_id = Some(id("2"));
    invalid.nodes[2].parent_id = Some(id("1"));
    assert_eq!(
        storage.replace_tree(id("a"), id("s"), invalid).await,
        Err(ErrorCode::InvalidTree)
    );
    let mut invalid = tree(2);
    invalid.nodes[3].parent_id = Some(id("missing"));
    assert_eq!(
        storage.replace_tree(id("a"), id("s"), invalid).await,
        Err(ErrorCode::InvalidTree)
    );
    let mut invalid = tree(2);
    invalid.nodes.push(invalid.nodes[3].clone());
    assert_eq!(
        storage.replace_tree(id("a"), id("s"), invalid).await,
        Err(ErrorCode::InvalidTree)
    );
    assert_eq!(
        storage.replace_tree(id("missing"), id("s"), tree(2)).await,
        Err(ErrorCode::WrongProfile)
    );
    assert_eq!(
        storage.replace_tree(id("a"), id("s"), tree(1)).await,
        Err(ErrorCode::Conflict)
    );
    let mut interrupted = tree(2);
    interrupted.nodes[3].title = Title::new("must rollback").unwrap();
    assert_eq!(
        storage
            .call(
                move |conn| replace_tree(conn, &id("a"), &id("s"), &interrupted, || Err(
                    ErrorCode::Cancelled
                ))
            )
            .await,
        Err(ErrorCode::Cancelled)
    );
    assert_eq!(storage.bookmarks(id("a"), epoch(1)).await.unwrap(), before);
    assert_eq!(storage.cursor(id("a")).await.unwrap(), cursor_before);
    storage.close().await.unwrap();
    let storage = Storage::open(&path).await.unwrap();
    assert_eq!(storage.bookmarks(id("a"), epoch(1)).await.unwrap(), before);
    assert_eq!(storage.cursor(id("a")).await.unwrap(), cursor_before);
    storage.close().await.unwrap();
}
fn version_one(path: &Path) -> Connection {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(MIGRATIONS[0]).unwrap();
    conn.pragma_update(None, "user_version", 1).unwrap();
    conn
}
#[tokio::test]
async fn upgrade_backup_includes_uncheckpointed_wal_and_preserves_old_rows() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let old = version_one(&path);
    old.pragma_update(None, "journal_mode", "WAL").unwrap();
    old.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
    old.execute(
        "INSERT INTO profiles VALUES('a','instance',1,'from-wal','paired',NULL,'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL)",
        [],
    )
    .unwrap();
    assert!(
        std::fs::metadata(path.with_file_name("app.sqlite-wal"))
            .unwrap()
            .len()
            > 0
    );
    let storage = Storage::open(&path).await.unwrap();
    let backup = Connection::open(storage.migration_backup.as_ref().unwrap()).unwrap();
    assert_eq!(
        backup
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        backup
            .query_row("SELECT display_name FROM profiles WHERE id='a'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "from-wal"
    );
    assert!(
        backup
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE name='operations'",
                [],
                |_| Ok(())
            )
            .is_err()
    );
    storage
        .call(|conn| {
            assert_eq!(
                conn.query_row("SELECT display_name FROM profiles WHERE id='a'", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
                "from-wal"
            );
            Ok(())
        })
        .await
        .unwrap();
    storage.close().await.unwrap();
    drop(old);
    drop(backup);
}
#[test]
fn failed_migration_rolls_back_schema_and_rows_then_real_upgrade_recovers() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let mut conn = version_one(&path);
    conn.execute(
        "INSERT INTO profiles VALUES('a','instance',1,'keep','paired',NULL,'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL)",
        [],
    )
    .unwrap();
    let broken = [
        MIGRATIONS[0],
        "CREATE TABLE transient_probe(value TEXT); UPDATE profiles SET display_name='lost'; INSERT INTO missing_table VALUES(1);",
    ];
    assert_eq!(
        migrate(&mut conn, &path, &broken),
        Err(ErrorCode::MigrationFailed)
    );
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("SELECT display_name FROM profiles WHERE id='a'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "keep"
    );
    assert!(
        conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE name='transient_probe'",
            [],
            |_| Ok(())
        )
        .is_err()
    );
    drop(conn);
    let mut conn = Connection::open(&path).unwrap();
    assert!(migrate(&mut conn, &path, MIGRATIONS).unwrap().is_some());
    assert_eq!(
        conn.query_row("SELECT display_name FROM profiles WHERE id='a'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "keep"
    );
    let backups: Vec<_> = std::fs::read_dir(directory.path())
        .unwrap()
        .flatten()
        .filter(|f| f.file_name().to_string_lossy().contains("pre-v1"))
        .collect();
    assert_eq!(backups.len(), 2);
}
#[test]
fn backup_failure_stops_before_schema_changes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let mut conn = version_one(&path);
    let inaccessible = directory.path().join("missing-directory/app.sqlite");
    assert_eq!(
        migrate(&mut conn, &inaccessible, MIGRATIONS),
        Err(ErrorCode::StorageError)
    );
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
}
#[tokio::test]
async fn newer_schema_is_rejected_without_journal_change_backup_or_file_mutation() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("newer.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES('keep'); PRAGMA user_version=999;",
    )
    .unwrap();
    drop(conn);
    let before = std::fs::read(&path).unwrap();
    assert!(matches!(
        Storage::open(&path).await,
        Err(ErrorCode::StorageNewerSchema)
    ));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}
#[tokio::test]
async fn unversioned_existing_data_is_preserved_and_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("unversioned.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES('keep');")
        .unwrap();
    drop(conn);
    let before = std::fs::read(&path).unwrap();
    assert!(matches!(
        Storage::open(&path).await,
        Err(ErrorCode::MigrationFailed)
    ));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row("SELECT value FROM keep", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "keep"
    );
}
#[tokio::test]
async fn blocking_sqlite_worker_does_not_block_current_thread_async_runtime() {
    let directory = tempfile::tempdir().unwrap();
    let storage = Storage::open(directory.path().join("app.sqlite"))
        .await
        .unwrap();
    let result = tokio::time::timeout(
        Duration::from_millis(10),
        storage.call(|_| {
            std::thread::sleep(Duration::from_millis(100));
            Ok(())
        }),
    )
    .await;
    assert!(result.is_err());
    // A dropped waiter does not kill the worker or leave an open transaction.
    assert_eq!(storage.cursor(id("absent")).await.unwrap(), None);
    storage.close().await.unwrap();
}
#[tokio::test]
async fn mirror_namespace_and_operation_snapshot_fields_survive_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("app.sqlite");
    let storage = Storage::open(&path).await.unwrap();
    storage.create_profile(profile("a")).await.unwrap();
    storage
        .replace_tree(id("a"), id("session"), tree(1))
        .await
        .unwrap();
    let before = storage.bookmarks(id("a"), epoch(1)).await.unwrap();
    storage.call(|conn| {
        conn.execute("INSERT INTO mirror_sources(id,selected_path,paired_profile_id,association_status) VALUES('a','synthetic-file-path',NULL,'independent')", []).unwrap();
        conn.execute("INSERT INTO mirror_bookmarks VALUES('a','42','{}')", []).unwrap();
        conn.execute("INSERT INTO operations VALUES('op','a',1,'planned','{}',NULL,1)", []).unwrap();
        conn.execute("INSERT INTO operation_steps VALUES('op',0,'step',NULL,'create',NULL,NULL,'{}',NULL)", []).unwrap();
        conn.execute("INSERT INTO snapshots VALUES('op',1,'[]','{}',1,'synthetic.html','synthetic.json')", []).unwrap();
        Ok(())
    }).await.unwrap();
    assert_eq!(storage.bookmarks(id("a"), epoch(1)).await.unwrap(), before);
    storage.close().await.unwrap();
    let storage = Storage::open(&path).await.unwrap();
    storage.call(|conn| {
        let preserved: (String, String, String) = conn.query_row("SELECT operations.state, operation_steps.request_id, snapshots.sidecar_backup_path FROM operations JOIN operation_steps USING(operation_id) JOIN snapshots USING(operation_id) WHERE operation_id='op'", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
        assert_eq!(preserved, ("planned".into(),"step".into(),"synthetic.json".into()));
        assert!(conn.execute("INSERT INTO operation_steps VALUES('op',1,'step',NULL,'create',NULL,NULL,'{}',NULL)", []).is_err());
        Ok(())
    }).await.unwrap();
    storage.close().await.unwrap();
    assert!(PairedOrigin::new("https://example.invalid").is_err());
    assert!(PairedOrigin::new("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/path").is_err());
}

#[tokio::test]
async fn mirror_storage_does_not_copy_tags_or_metadata_by_url() {
    use markbridge_protocol::MirrorFileStatus;
    let directory = tempfile::tempdir().unwrap();
    let storage = Storage::open(directory.path().join("app.sqlite"))
        .await
        .unwrap();
    for name in ["profile-a", "profile-b"] {
        storage.create_profile(profile(name)).await.unwrap();
        storage
            .replace_tree(id(name), id("session"), tree(1))
            .await
            .unwrap();
    }
    let a = storage.bookmarks(id("profile-a"), epoch(1)).await.unwrap();
    let b = storage.bookmarks(id("profile-b"), epoch(1)).await.unwrap();
    let a_mark = a.iter().find(|row| row.node.url.is_some()).unwrap().clone();
    let b_mark = b
        .iter()
        .find(|row| row.node.url == a_mark.node.url)
        .unwrap()
        .clone();
    assert_ne!(a_mark.bookmark_id, b_mark.bookmark_id);
    storage
        .set_metadata(a_mark.bookmark_id.clone(), metadata())
        .await
        .unwrap();
    let tagged = a_mark.bookmark_id.as_str().to_owned();
    storage
        .call(move |conn| {
            conn.execute(
                "INSERT INTO tags(id,name,normalized_name) VALUES('tag-1','工作','工作')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO bookmark_tags(bookmark_id,tag_id) VALUES(?1,'tag-1')",
                [tagged],
            )
            .unwrap();
            Ok(())
        })
        .await
        .unwrap();
    storage
        .put_mirror(
            StoredMirror {
                id: id("mirror-a"),
                path: "C:/synthetic/Default".into(),
                display_name: DisplayName::new("Personal").unwrap(),
                paired_profile_id: Some(id("profile-a")),
                confirmed: true,
                watching: false,
                file_status: MirrorFileStatus::Current,
                revision: 1,
                last_read_at: Some(1),
                error_code: None,
                nodes: vec![a_mark.node.clone()],
            },
            true,
        )
        .await
        .unwrap();
    let tags = storage
        .call(|conn| {
            let mut statement = conn
                .prepare("SELECT bookmark_id FROM bookmark_tags ORDER BY bookmark_id")
                .unwrap();
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap();
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(storage_error)
        })
        .await
        .unwrap();
    assert_eq!(tags, vec![a_mark.bookmark_id.as_str().to_owned()]);
    assert!(
        storage
            .metadata(b_mark.bookmark_id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        storage
            .metadata(a_mark.bookmark_id)
            .await
            .unwrap()
            .is_some()
    );
    storage.close().await.unwrap();
}
