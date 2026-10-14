use super::*;
use crate::storage::{Metadata, PairedOrigin, Profile};
use serde_json::json;
fn id(value: &str) -> Id {
    Id::new(value).unwrap()
}
fn epoch(value: u64) -> SourceEpoch {
    SourceEpoch::new(value).unwrap()
}
fn count(value: u64) -> Counter {
    Counter::new(value).unwrap()
}
fn node(chrome: &str, parent: Option<&str>, position: u64, bookmark: bool) -> BookmarkNode {
    serde_json::from_value(json!({"chromeId":chrome,"parentId":parent,"position":position,"kind":if bookmark{"bookmark"}else{"folder"},"title":format!("Title {chrome}"),"url":if bookmark {Some("https://synthetic.invalid/")}else{None},"folderType":null,"unmodifiable":null,"dateAdded":null,"dateLastUsed":null})).unwrap()
}
fn tree(revision: u64) -> TreeSnapshot {
    TreeSnapshot {
        source_epoch: epoch(1),
        revision: count(revision),
        barrier_seq: count(revision),
        nodes: vec![
            node("0", None, 0, false),
            node("1", Some("0"), 0, true),
            node("2", Some("0"), 1, true),
        ],
    }
}
fn scope() -> SemanticScope {
    SemanticScope {
        profile_id: id("p"),
        source_epoch: epoch(1),
        expected_revision: count(1),
        selected_chrome_ids: vec![id("1"), id("2")],
        folder_id: RequiredNullable(None),
    }
}
async fn fixture() -> (Storage, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(dir.path().join("db.sqlite")).await.unwrap();
    storage
        .create_profile(Profile {
            id: id("p"),
            instance_id: id("i"),
            source_epoch: epoch(1),
            display_name: DisplayName::new("synthetic").unwrap(),
            paired_origin: PairedOrigin::new("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .unwrap(),
            credential_reference: None,
        })
        .await
        .unwrap();
    storage
        .replace_tree(id("p"), id("s"), tree(1))
        .await
        .unwrap();
    storage
        .semantic_save_config(Config {
            enabled: true,
            endpoint: Some("http://127.0.0.1:11434".into()),
            model: Some("embed".into()),
        })
        .await
        .unwrap();
    (storage, dir)
}
async fn seed(storage: &Storage) -> Run {
    let review = storage.semantic_review(scope()).await.unwrap();
    let run = storage.semantic_start(review, id("index")).await.unwrap();
    storage
        .semantic_bind_model(run.clone(), "a".repeat(64), Some(2))
        .await
        .unwrap();
    while let Some(target) = storage.semantic_next(run.clone()).await.unwrap() {
        assert!(
            storage
                .semantic_commit(run.clone(), target, "a".repeat(64), vec![1., 0.])
                .await
                .unwrap()
        );
    }
    storage.semantic_finish(run.clone(), None).await.unwrap();
    run
}
async fn raw(storage: &Storage) -> Vec<(String, String, Option<Vec<u8>>)> {
    storage
        .call(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT bookmark_id,state,vector FROM semantic_members ORDER BY bookmark_id",
                )
                .map_err(storage_error)?;
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(storage_error)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(storage_error)
        })
        .await
        .unwrap()
}
#[tokio::test]
async fn unchanged_snapshot_moves_notes_tags_preserve_vectors_but_all_summary_writers_invalidate() {
    let (storage, _dir) = fixture().await;
    seed(&storage).await;
    let before = raw(&storage).await;
    storage
        .replace_tree(id("p"), id("s"), tree(2))
        .await
        .unwrap();
    assert_eq!(raw(&storage).await, before);
    let mut moved = tree(3);
    moved.nodes[1].position = Position::new(1).unwrap();
    moved.nodes[2].position = Position::new(0).unwrap();
    storage.replace_tree(id("p"), id("s"), moved).await.unwrap();
    let bookmarks = storage.bookmarks(id("p"), epoch(1)).await.unwrap();
    let first = bookmarks
        .iter()
        .find(|b| b.node.chrome_id == id("1"))
        .unwrap()
        .bookmark_id
        .clone();
    let second = bookmarks
        .iter()
        .find(|b| b.node.chrome_id == id("2"))
        .unwrap()
        .bookmark_id
        .clone();
    storage
        .set_metadata(
            first.clone(),
            Metadata {
                display_title: None,
                summary: None,
                note: "note only".into(),
                updated_at: count(4),
            },
        )
        .await
        .unwrap();
    storage
        .mutate_tags(
            id("p"),
            TagCommand::Add {
                chrome_ids: vec![id("1")],
                name: "tag only".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(raw(&storage).await, before);
    storage
        .set_summary(first.clone(), Some("new summary".into()))
        .await
        .unwrap();
    let rows = raw(&storage).await;
    assert_eq!(
        rows.iter().find(|r| r.0 == first.as_str()).unwrap().1,
        "pending"
    );
    assert_eq!(
        rows.iter().find(|r| r.0 == second.as_str()).unwrap().2,
        Some(semantic::encode(&[1., 0.]))
    );
    storage
        .set_metadata(
            second.clone(),
            Metadata {
                display_title: None,
                summary: Some("metadata writer".into()),
                note: String::new(),
                updated_at: count(5),
            },
        )
        .await
        .unwrap();
    assert!(raw(&storage).await.iter().all(|r| r.2.is_none()));
    let run = storage
        .semantic_transition(id("p"), epoch(1), "resume")
        .await
        .unwrap()
        .unwrap();
    storage
        .semantic_bind_model(run.clone(), "a".repeat(64), Some(2))
        .await
        .unwrap();
    while let Some(target) = storage.semantic_next(run.clone()).await.unwrap() {
        storage
            .semantic_commit(run.clone(), target, "a".repeat(64), vec![1., 0.])
            .await
            .unwrap();
    }
    storage.semantic_finish(run, None).await.unwrap();
    let old = first.clone();
    storage.call(move |conn| {let after=super::super::AfterBody {maps:vec![super::super::IdMapBody {request_id:id("restore"),old_chrome_id:id("1"),new_chrome_id:id("2"),old_bookmark_id:old}],..Default::default()};conn.execute("INSERT INTO operations(operation_id,profile_id,source_epoch,state,before_json,after_json,created_at) VALUES('restore-op','p',1,'applied','{}',?1,1)",[serde_json::to_string(&after).unwrap()]).map_err(storage_error)?;Ok(())}).await.unwrap();
    storage
        .copy_mapped_metadata(id("p"), epoch(1), 6)
        .await
        .unwrap();
    assert_eq!(
        raw(&storage)
            .await
            .iter()
            .find(|r| r.0 == second.as_str())
            .unwrap()
            .1,
        "pending"
    );
    assert_eq!(
        storage.metadata(second).await.unwrap().unwrap().summary,
        Some("new summary".into())
    );
    storage.close().await.unwrap();
}
#[tokio::test]
async fn final_deletion_and_recreated_identity_do_not_inherit_frozen_membership() {
    let (storage, _dir) = fixture().await;
    seed(&storage).await;
    let old = raw(&storage).await;
    let mut deleted = tree(2);
    deleted.nodes.remove(1);
    deleted.nodes[1].position = Position::new(0).unwrap();
    storage
        .replace_tree(id("p"), id("s"), deleted)
        .await
        .unwrap();
    assert_eq!(raw(&storage).await.len(), 1);
    let mut restored = tree(3);
    restored.nodes[1].chrome_id = id("new-restored");
    storage
        .replace_tree(id("p"), id("s"), restored)
        .await
        .unwrap();
    assert_eq!(raw(&storage).await.len(), 1);
    assert_eq!(raw(&storage).await[0].2, old[0].2);
    storage.reset_source_epoch(id("p"), epoch(2)).await.unwrap();
    assert!(raw(&storage).await.is_empty());
    assert!(
        storage
            .semantic_run(id("p"), epoch(2))
            .await
            .unwrap()
            .is_none()
    );
    storage.close().await.unwrap();
}
#[tokio::test]
async fn frozen_folder_does_not_absorb_new_children_and_title_change_is_pending() {
    let (storage, _dir) = fixture().await;
    let mut folder = scope();
    folder.selected_chrome_ids.clear();
    folder.folder_id = RequiredNullable(Some(id("0")));
    let review = storage.semantic_review(folder).await.unwrap();
    let run = storage
        .semantic_start(review, id("folder-index"))
        .await
        .unwrap();
    storage
        .semantic_bind_model(run.clone(), "a".repeat(64), Some(2))
        .await
        .unwrap();
    let mut next = tree(2);
    next.nodes[1].title = Title::new("changed actual title").unwrap();
    next.nodes.push(node("new", Some("0"), 2, true));
    storage.replace_tree(id("p"), id("s"), next).await.unwrap();
    assert_eq!(raw(&storage).await.len(), 2);
    let target = storage.semantic_next(run).await.unwrap().unwrap();
    assert!(target.title == "changed actual title" || target.title == "Title 2");
    assert!(raw(&storage).await.iter().all(|r| r.1 == "pending"));
    storage.close().await.unwrap();
}
#[tokio::test]
async fn late_commit_rejects_content_generation_deletion_and_epoch_changes_atomically() {
    for action in ["content", "pause", "disable", "replace", "delete", "epoch"] {
        let (storage, _dir) = fixture().await;
        let review = storage.semantic_review(scope()).await.unwrap();
        let run = storage
            .semantic_start(review, id("race-index"))
            .await
            .unwrap();
        storage
            .semantic_bind_model(run.clone(), "a".repeat(64), Some(2))
            .await
            .unwrap();
        let target = storage.semantic_next(run.clone()).await.unwrap().unwrap();
        match action {
            "content" => storage
                .set_summary(target.bookmark_id.clone(), Some("new".into()))
                .await
                .unwrap(),
            "pause" => {
                storage
                    .semantic_transition(id("p"), epoch(1), "pause")
                    .await
                    .unwrap();
            }
            "disable" => storage
                .semantic_save_config(Config {
                    enabled: false,
                    endpoint: Some("http://127.0.0.1:11434".into()),
                    model: Some("embed".into()),
                })
                .await
                .unwrap(),
            "replace" => storage
                .semantic_save_config(Config {
                    enabled: true,
                    endpoint: Some("http://127.0.0.1:11435".into()),
                    model: Some("embed".into()),
                })
                .await
                .unwrap(),
            "delete" => {
                storage
                    .semantic_transition(id("p"), epoch(1), "delete")
                    .await
                    .unwrap();
            }
            _ => storage.reset_source_epoch(id("p"), epoch(2)).await.unwrap(),
        }
        assert!(
            !storage
                .semantic_commit(run.clone(), target, "a".repeat(64), vec![1., 0.])
                .await
                .unwrap(),
            "{action}"
        );
        storage.semantic_finish(run, None).await.unwrap();
        assert!(
            raw(&storage).await.iter().all(|r| r.2.is_none()),
            "{action}"
        );
        storage.close().await.unwrap();
    }
}
#[tokio::test]
async fn exact_topk_ties_are_stable_and_corrupt_blobs_fail_closed() {
    let (storage, _dir) = fixture().await;
    let run = seed(&storage).await;
    let query = SemanticQuery {
        request_id: id("q"),
        profile_id: id("p"),
        source_epoch: epoch(1),
        index_id: run.index.index_id,
        generation: count(1),
        text: "synthetic".into(),
        top_k: 1,
    };
    let hits = storage
        .semantic_search(query.clone(), vec![1., 0.], CancelFlag::new())
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].score, 1.);
    assert_eq!(hits[0].bookmark_id.as_str(), raw(&storage).await[0].0);
    storage.call(|conn| {conn.execute("UPDATE semantic_members SET vector=?1 WHERE bookmark_id=(SELECT min(bookmark_id) FROM semantic_members)",[vec![0_u8;7]]).map_err(storage_error)?;Ok(())}).await.unwrap();
    assert_eq!(
        storage
            .semantic_search(query, vec![1., 0.], CancelFlag::new())
            .await
            .unwrap_err(),
        ErrorCode::InvalidMessage
    );
    storage.close().await.unwrap();
}
#[tokio::test]
async fn scope_rejects_zero_mixed_duplicate_wrong_epoch_and_over_10k_without_truncation() {
    let (storage, _dir) = fixture().await;
    for bad in [
        SemanticScope {
            selected_chrome_ids: vec![],
            ..scope()
        },
        SemanticScope {
            folder_id: RequiredNullable(Some(id("0"))),
            ..scope()
        },
        SemanticScope {
            selected_chrome_ids: vec![id("1"), id("1")],
            ..scope()
        },
        SemanticScope {
            source_epoch: epoch(2),
            ..scope()
        },
        SemanticScope {
            selected_chrome_ids: vec![id("0")],
            ..scope()
        },
    ] {
        assert!(storage.semantic_review(bad).await.is_err());
    }
    let mut large = tree(2);
    large.nodes.truncate(1);
    for n in 0..10001 {
        large.nodes.push(node(&format!("b{n}"), Some("0"), n, true));
    }
    storage.replace_tree(id("p"), id("s"), large).await.unwrap();
    let folder = SemanticScope {
        expected_revision: count(2),
        selected_chrome_ids: Vec::new(),
        folder_id: RequiredNullable(Some(id("0"))),
        ..scope()
    };
    assert_eq!(
        storage.semantic_review(folder).await.err(),
        Some(ErrorCode::InvalidMessage)
    );
    assert!(raw(&storage).await.is_empty());
    storage.close().await.unwrap();
}
#[tokio::test]
async fn migration_8_backs_up_v7_wal_and_failed_upgrade_rolls_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let mut conn = Connection::open(&path).unwrap();
    for migration in &super::super::MIGRATIONS[..7] {
        conn.execute_batch(migration).unwrap();
    }
    conn.pragma_update(None, "user_version", 7).unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
    conn.execute("INSERT INTO profiles VALUES('p','i',1,'retained','paired',NULL,'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL)",[]).unwrap();
    let mut broken = super::super::MIGRATIONS.to_vec();
    broken.push("INSERT INTO absent_table VALUES(1);");
    assert_eq!(
        super::super::migrate(&mut conn, &path, &broken),
        Err(ErrorCode::MigrationFailed)
    );
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        7
    );
    assert!(
        !conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='semantic_indexes')",
                [],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
    );
    let storage = Storage::open(&path).await.unwrap();
    let backup = Connection::open(storage.migration_backup.as_ref().unwrap()).unwrap();
    assert_eq!(
        backup
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        7
    );
    assert_eq!(
        backup
            .query_row("SELECT display_name FROM profiles WHERE id='p'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
        "retained"
    );
    assert!(!storage.semantic_config().await.unwrap().enabled);
    storage.close().await.unwrap();
    drop(backup);
    drop(conn);
}

#[tokio::test]
async fn ten_thousand_synthetic_vectors_scan_exact_topk_without_scope_truncation() {
    let (storage, _dir) = fixture().await;
    let mut large = tree(2);
    large.nodes.truncate(1);
    for n in 0..10000 {
        large.nodes.push(node(&format!("b{n}"), Some("0"), n, true));
    }
    storage.replace_tree(id("p"), id("s"), large).await.unwrap();
    let folder = SemanticScope {
        expected_revision: count(2),
        selected_chrome_ids: Vec::new(),
        folder_id: RequiredNullable(Some(id("0"))),
        ..scope()
    };
    let review = storage.semantic_review(folder).await.unwrap();
    assert_eq!(review.targets.len(), 10000);
    let run = storage
        .semantic_start(review, id("10k-index"))
        .await
        .unwrap();
    storage
        .semantic_bind_model(run.clone(), "a".repeat(64), Some(2))
        .await
        .unwrap();
    // Deterministic fixture vectors, not a model or model-quality/performance assertion.
    storage.call(|conn| {
        let tx=conn.transaction().map_err(storage_error)?;
        let entries={let mut statement=tx.prepare("SELECT bookmark_id,chrome_id,title FROM bookmarks_cache WHERE node_kind='bookmark' AND deleted_at IS NULL ORDER BY bookmark_id").map_err(storage_error)?;statement.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(storage_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(storage_error)?};
        {let mut update=tx.prepare("UPDATE semantic_members SET state='ready',fingerprint=?2,vector=?3 WHERE bookmark_id=?1").map_err(storage_error)?;for (bookmark,chrome,title) in entries {let vector=match chrome.as_str() {"b0"=>[1.,0.],"b1"=>[-1.,0.],_=>[0.,1.]};let fingerprint=semantic::fingerprint(&id("p"),epoch(1),&id(&bookmark),&title,"");update.execute(params![bookmark,fingerprint,semantic::encode(&vector)]).map_err(storage_error)?;}}
        tx.commit().map_err(storage_error)
    }).await.unwrap();
    storage.semantic_finish(run.clone(), None).await.unwrap();
    let status = storage
        .semantic_status(id("p"), epoch(1))
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    assert_eq!(
        (status.total, status.ready, status.pending),
        (10000, 10000, 0)
    );
    assert_eq!(status.stored_bytes.get(), 80000);
    let query = SemanticQuery {
        request_id: id("10k-query"),
        profile_id: id("p"),
        source_epoch: epoch(1),
        index_id: run.index.index_id,
        generation: count(1),
        text: "synthetic".into(),
        top_k: 50,
    };
    let hits = storage
        .semantic_search(query.clone(), vec![1., 0.], CancelFlag::new())
        .await
        .unwrap();
    assert_eq!(hits.len(), 50);
    assert_eq!(hits[0].chrome_id, id("b0"));
    assert_eq!(hits[0].score, 1.);
    assert!(hits[1..].iter().all(|hit| hit.score == 0.));
    assert!(
        hits[1..]
            .windows(2)
            .all(|pair| pair[0].bookmark_id.as_str() < pair[1].bookmark_id.as_str())
    );
    let opposite = storage
        .semantic_search(query, vec![-1., 0.], CancelFlag::new())
        .await
        .unwrap();
    assert_eq!(opposite[0].chrome_id, id("b1"));
    assert_eq!(opposite[0].score, 1.);
    storage.close().await.unwrap();
}
