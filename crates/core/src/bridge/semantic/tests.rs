use super::*;
use crate::semantic::tests::{Script, show, tags, vector};
use crate::storage::{Metadata, PairedOrigin, Profile, Storage};
use serde_json::json;

fn id(value: &str) -> Id {
    Id::new(value).unwrap()
}
fn epoch() -> SourceEpoch {
    SourceEpoch::new(1).unwrap()
}
fn count(value: u64) -> Counter {
    Counter::new(value).unwrap()
}
fn tree(revision: u64) -> TreeSnapshot {
    let nodes=serde_json::from_value(json!([
        {"chromeId":"0","parentId":null,"position":0,"kind":"folder","title":"root","url":null,"folderType":null,"unmodifiable":null,"dateAdded":null,"dateLastUsed":null},
        {"chromeId":"1","parentId":"0","position":0,"kind":"bookmark","title":"Approved title","url":"https://url-canary.invalid/?secret=url-only","folderType":null,"unmodifiable":null,"dateAdded":null,"dateLastUsed":null},
        {"chromeId":"2","parentId":"0","position":1,"kind":"bookmark","title":"Second title","url":"https://example.invalid/","folderType":null,"unmodifiable":null,"dateAdded":null,"dateLastUsed":null}
    ])).unwrap();
    TreeSnapshot {
        source_epoch: epoch(),
        revision: count(revision),
        barrier_seq: count(revision),
        nodes,
    }
}
async fn fixture(mock: Arc<dyn Transport>) -> (Bridge, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("semantic.sqlite");
    let storage = Storage::open(&path).await.unwrap();
    storage
        .create_profile(Profile {
            id: id("p"),
            instance_id: id("i"),
            source_epoch: epoch(),
            display_name: DisplayName::new("profile-canary").unwrap(),
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
    let bookmark = storage
        .bookmarks(id("p"), epoch())
        .await
        .unwrap()
        .into_iter()
        .find(|b| b.node.chrome_id == id("1"))
        .unwrap()
        .bookmark_id;
    storage
        .set_metadata(
            bookmark,
            Metadata {
                display_title: Some("display-canary".into()),
                summary: Some("Saved summary".into()),
                note: "note-canary".into(),
                updated_at: count(1),
            },
        )
        .await
        .unwrap();
    storage
        .mutate_tags(
            id("p"),
            TagCommand::Add {
                chrome_ids: vec![id("1")],
                name: "tag-canary".into(),
            },
        )
        .await
        .unwrap();
    storage.close().await.unwrap();
    let mut bridge = Bridge::open(&path, Arc::new(super::super::ai::EmptyCredentials))
        .await
        .unwrap();
    let mut runtime = Runtime::new().unwrap();
    runtime.transport = mock;
    bridge.semantic = Arc::new(runtime);
    (bridge, dir)
}
fn config(enabled: bool) -> SemanticConfig {
    SemanticConfig {
        enabled,
        endpoint: RequiredNullable(Some("http://localhost:11434".into())),
        model: RequiredNullable(Some("embed".into())),
    }
}
fn scope() -> SemanticScope {
    SemanticScope {
        profile_id: id("p"),
        source_epoch: epoch(),
        expected_revision: count(1),
        selected_chrome_ids: vec![id("1")],
        folder_id: RequiredNullable(None),
    }
}
fn success_steps() -> Vec<semantic::Result<serde_json::Value>> {
    let digest = "a".repeat(64);
    vec![
        Ok(tags(&digest)),
        Ok(show()),
        Ok(vector()),
        Ok(tags(&digest)),
        Ok(show()),
    ]
}
async fn ready(bridge: &Bridge) -> SemanticIndex {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let status = bridge.semantic_status(id("p"), epoch()).await.unwrap();
            if let Some(index) = status.index.0
                && index.phase != SemanticPhase::Running
            {
                return index;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}
#[tokio::test]
async fn defaults_disabled_save_review_and_restart_never_call_http() {
    let mock = Script::new(Vec::new());
    let (bridge, dir) = fixture(mock.clone()).await;
    assert!(!bridge.semantic_settings().await.unwrap().enabled);
    bridge.save_semantic_config(config(false)).await.unwrap();
    assert!(bridge.semantic_review_scope(scope()).await.is_err());
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    assert_eq!(review.count, 1);
    assert_eq!(review.upper_bytes.get(), 16384);
    assert!(mock.calls.lock().unwrap().is_empty());
    bridge.shutdown().await.unwrap();
    let reopened = Bridge::open(
        dir.path().join("semantic.sqlite"),
        Arc::new(super::super::ai::EmptyCredentials),
    )
    .await
    .unwrap();
    assert!(reopened.semantic_settings().await.unwrap().enabled);
    assert!(
        reopened
            .semantic_status(id("p"), epoch())
            .await
            .unwrap()
            .index
            .0
            .is_none()
    );
    reopened.shutdown().await.unwrap();
}
#[tokio::test]
async fn confirmed_scope_build_sends_only_title_summary_serially_and_delete_preserves_sidecars() {
    let mock = Script::new(success_steps());
    let (bridge, _dir) = fixture(mock.clone()).await;
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    bridge
        .semantic_start_index(review.review_id.clone())
        .await
        .unwrap();
    assert_eq!(
        bridge
            .semantic_start_index(review.review_id)
            .await
            .unwrap_err(),
        ErrorCode::Conflict
    );
    let index = ready(&bridge).await;
    assert_eq!(index.phase, SemanticPhase::Ready);
    assert_eq!(index.ready, 1);
    assert_eq!(index.dimension.0, Some(2));
    {
        let calls = mock.calls.lock().unwrap();
        assert_eq!(
            calls.iter().filter(|(route, _)| route == "embed").count(),
            1
        );
        let body = calls
            .iter()
            .find(|(route, _)| route == "embed")
            .unwrap()
            .1
            .as_ref()
            .unwrap()
            .to_string();
        assert!(body.contains("Approved title") && body.contains("Saved summary"));
        for denied in [
            "url-canary",
            "note-canary",
            "tag-canary",
            "display-canary",
            "profile-canary",
            "authorization",
        ] {
            assert!(!body.contains(denied));
        }
    }
    let storage = bridge.semantic_storage().await.unwrap();
    let before = storage.bookmarks(id("p"), epoch()).await.unwrap();
    let first = before.iter().find(|b| b.node.chrome_id == id("1")).unwrap();
    let metadata = storage.metadata(first.bookmark_id.clone()).await.unwrap();
    drop(storage);
    assert!(
        bridge
            .semantic_delete_index(id("p"), epoch())
            .await
            .unwrap()
            .index
            .0
            .is_none()
    );
    let storage = bridge.semantic_storage().await.unwrap();
    assert_eq!(storage.bookmarks(id("p"), epoch()).await.unwrap(), before);
    assert_eq!(
        storage.metadata(first.bookmark_id.clone()).await.unwrap(),
        metadata
    );
    drop(storage);
    bridge.shutdown().await.unwrap();
}
#[tokio::test]
async fn changed_review_summary_or_revision_cannot_authorize_later_text() {
    let mock = Script::new(Vec::new());
    let (bridge, _dir) = fixture(mock.clone()).await;
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    let storage = bridge.semantic_storage().await.unwrap();
    let bookmark = storage
        .bookmarks(id("p"), epoch())
        .await
        .unwrap()
        .into_iter()
        .find(|b| b.node.chrome_id == id("1"))
        .unwrap()
        .bookmark_id;
    storage
        .set_summary(bookmark.clone(), Some("Changed".into()))
        .await
        .unwrap();
    drop(storage);
    assert_eq!(
        bridge
            .semantic_start_index(review.review_id)
            .await
            .unwrap_err(),
        ErrorCode::Conflict
    );
    assert!(mock.calls.lock().unwrap().is_empty());
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    let storage = bridge.semantic_storage().await.unwrap();
    storage
        .replace_tree(id("p"), id("s"), tree(2))
        .await
        .unwrap();
    drop(storage);
    assert_eq!(
        bridge
            .semantic_start_index(review.review_id)
            .await
            .unwrap_err(),
        ErrorCode::Conflict
    );
    assert!(mock.calls.lock().unwrap().is_empty());
    bridge.shutdown().await.unwrap();
}
struct Blocking {
    started: Notify,
}
impl Transport for Blocking {
    fn request<'a>(
        &'a self,
        _: &'a str,
        route: &'a str,
        _: Option<serde_json::Value>,
        _: &'a CancelFlag,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = semantic::Result<serde_json::Value>> + Send + 'a>,
    > {
        Box::pin(async move {
            match route {
                "tags" => Ok(tags(&"a".repeat(64))),
                "show" => Ok(show()),
                _ => {
                    self.started.notify_one();
                    std::future::pending().await
                }
            }
        })
    }
}
#[tokio::test]
async fn pause_and_disable_advance_generation_before_cancelling_network_and_restart_is_paused() {
    let mock = Arc::new(Blocking {
        started: Notify::new(),
    });
    let (bridge, dir) = fixture(mock.clone()).await;
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    let started = bridge
        .semantic_start_index(review.review_id)
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    mock.started.notified().await;
    let paused = bridge
        .semantic_pause(id("p"), epoch())
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    assert!(paused.generation.get() > started.generation.get());
    assert_eq!(paused.phase, SemanticPhase::Paused);
    assert_eq!(paused.ready, 0);
    bridge.semantic_resume(id("p"), epoch()).await.unwrap();
    mock.started.notified().await;
    bridge.save_semantic_config(config(false)).await.unwrap();
    let disabled = bridge
        .semantic_status(id("p"), epoch())
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    assert!(disabled.generation.get() > paused.generation.get());
    assert_eq!(disabled.phase, SemanticPhase::Paused);
    assert_eq!(disabled.ready, 0);
    bridge.shutdown().await.unwrap();
    let reopened = Bridge::open(
        dir.path().join("semantic.sqlite"),
        Arc::new(super::super::ai::EmptyCredentials),
    )
    .await
    .unwrap();
    assert_eq!(
        reopened
            .semantic_status(id("p"), epoch())
            .await
            .unwrap()
            .index
            .0
            .unwrap()
            .phase,
        SemanticPhase::Paused
    );
    reopened.shutdown().await.unwrap();
}
#[tokio::test]
async fn duplicate_query_owner_cannot_replace_cancelled_request_or_escape_profile() {
    let mock = Script::new(success_steps());
    let (mut bridge, _dir) = fixture(mock).await;
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    bridge.semantic_start_index(review.review_id).await.unwrap();
    let index = ready(&bridge).await;
    let blocking = Arc::new(Blocking {
        started: Notify::new(),
    });
    let mut runtime = Runtime::new().unwrap();
    runtime.transport = blocking.clone();
    bridge.semantic = Arc::new(runtime);
    let query = SemanticQuery {
        request_id: id("q"),
        profile_id: id("p"),
        source_epoch: epoch(),
        index_id: index.index_id,
        generation: index.generation,
        text: "query-canary".into(),
        top_k: 5,
    };
    let clone = bridge.clone();
    let query_clone = query.clone();
    let task = tokio::spawn(async move { clone.semantic_query(query_clone).await.unwrap() });
    blocking.started.notified().await;
    assert_eq!(
        bridge.semantic_query(query.clone()).await.unwrap_err(),
        ErrorCode::Conflict
    );
    bridge
        .semantic_cancel_query(id("other"), id("q"))
        .await
        .unwrap();
    assert!(!task.is_finished());
    bridge
        .semantic_cancel_query(id("p"), id("q"))
        .await
        .unwrap();
    assert_eq!(
        task.await.unwrap().failure.0,
        Some(SemanticFailure::Cancelled)
    );
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
async fn stale_config_and_detected_model_change_cannot_be_resurrected_by_toggles_or_pause() {
    for change_config in [true, false] {
        let mut steps = success_steps();
        if !change_config {
            steps[3] = Ok(tags(&"b".repeat(64)));
        }
        let mock = Script::new(steps);
        let (bridge, _dir) = fixture(mock.clone()).await;
        bridge.save_semantic_config(config(true)).await.unwrap();
        let review = bridge.semantic_review_scope(scope()).await.unwrap();
        bridge.semantic_start_index(review.review_id).await.unwrap();
        ready(&bridge).await;
        let mut changed = config(true);
        if change_config {
            changed.endpoint = RequiredNullable(Some("http://localhost:11435".into()));
            bridge.save_semantic_config(changed.clone()).await.unwrap();
        }
        changed.enabled = false;
        bridge.save_semantic_config(changed.clone()).await.unwrap();
        changed.enabled = true;
        bridge.save_semantic_config(changed).await.unwrap();
        let index = bridge
            .semantic_pause(id("p"), epoch())
            .await
            .unwrap()
            .index
            .0
            .unwrap();
        assert_eq!(index.phase, SemanticPhase::Stale);
        assert!(bridge.semantic_resume(id("p"), epoch()).await.is_err());
        let before = mock.calls.lock().unwrap().len();
        let result = bridge
            .semantic_query(SemanticQuery {
                request_id: id("stale-q"),
                profile_id: id("p"),
                source_epoch: epoch(),
                index_id: index.index_id,
                generation: index.generation,
                text: "must-never-send".into(),
                top_k: 5,
            })
            .await
            .unwrap();
        assert_eq!(result.failure.0, Some(SemanticFailure::StaleIndex));
        assert!(result.hits.is_empty());
        assert_eq!(mock.calls.lock().unwrap().len(), before);
        bridge.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn restart_freezes_running_generation_and_shutdown_cancels_active_build_without_waiting_for_network()
 {
    let mock = Script::new(Vec::new());
    let (bridge, dir) = fixture(mock.clone()).await;
    bridge.save_semantic_config(config(true)).await.unwrap();
    let storage = bridge.semantic_storage().await.unwrap();
    let review = storage.semantic_review(scope()).await.unwrap();
    let run = storage
        .semantic_start(review, id("crash-index"))
        .await
        .unwrap();
    drop(storage);
    // A stopped persisted running row models process interruption, without an active task.
    let owned = bridge.inner.lock().await.storage.take().unwrap();
    owned.close().await.unwrap();
    drop(bridge);
    let reopened = Bridge::open(
        dir.path().join("semantic.sqlite"),
        Arc::new(super::super::ai::EmptyCredentials),
    )
    .await
    .unwrap();
    let index = reopened
        .semantic_status(id("p"), epoch())
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    assert_eq!(index.phase, SemanticPhase::Paused);
    assert!(index.generation.get() > run.index.generation.get());
    reopened.shutdown().await.unwrap();
    assert!(mock.calls.lock().unwrap().is_empty());
    let blocking = Arc::new(Blocking {
        started: Notify::new(),
    });
    let (bridge, _dir) = fixture(blocking.clone()).await;
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    bridge.semantic_start_index(review.review_id).await.unwrap();
    blocking.started.notified().await;
    tokio::time::timeout(Duration::from_secs(1), bridge.shutdown())
        .await
        .unwrap()
        .unwrap();
    assert!(bridge.semantic.control.lock().await.builds.is_empty());
}

#[tokio::test]
async fn query_detected_model_version_change_marks_only_bound_generation_stale() {
    let mut steps = success_steps();
    steps.extend([Ok(tags(&"b".repeat(64))), Ok(show())]);
    let mock = Script::new(steps);
    let (bridge, _dir) = fixture(mock.clone()).await;
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    bridge.semantic_start_index(review.review_id).await.unwrap();
    let index = ready(&bridge).await;
    let query = SemanticQuery {
        request_id: id("changed-query"),
        profile_id: id("p"),
        source_epoch: epoch(),
        index_id: index.index_id.clone(),
        generation: index.generation,
        text: "never-send-model-changed".into(),
        top_k: 5,
    };
    assert_eq!(
        bridge
            .semantic_query(query.clone())
            .await
            .unwrap()
            .failure
            .0,
        Some(SemanticFailure::ModelChanged)
    );
    let stale = bridge
        .semantic_status(id("p"), epoch())
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    assert_eq!(stale.phase, SemanticPhase::Stale);
    assert!(stale.generation.get() > index.generation.get());
    let before = mock.calls.lock().unwrap().len();
    let result = bridge
        .semantic_query(SemanticQuery {
            request_id: id("restored-query"),
            generation: stale.generation,
            ..query.clone()
        })
        .await
        .unwrap();
    assert_eq!(result.failure.0, Some(SemanticFailure::StaleIndex));
    assert_eq!(mock.calls.lock().unwrap().len(), before);
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    bridge.semantic_start_index(review.review_id).await.unwrap();
    let storage = bridge.semantic_storage().await.unwrap();
    assert!(
        !storage
            .semantic_mark_stale(query, SemanticFailure::ModelChanged)
            .await
            .unwrap()
    );
    drop(storage);
    let status = bridge
        .semantic_status(id("p"), epoch())
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    assert_ne!(status.index_id, index.index_id);
    assert_ne!(status.phase, SemanticPhase::Stale);
    bridge.shutdown().await.unwrap();
}

struct SerialBuild {
    embeds: std::sync::atomic::AtomicUsize,
    active: Arc<std::sync::atomic::AtomicUsize>,
    max_active: std::sync::atomic::AtomicUsize,
    shows: std::sync::atomic::AtomicUsize,
    started: Notify,
    second_metadata: Notify,
}
struct ActiveInput(Arc<std::sync::atomic::AtomicUsize>);
impl Drop for ActiveInput {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
impl Transport for SerialBuild {
    fn request<'a>(
        &'a self,
        _: &'a str,
        route: &'a str,
        _: Option<serde_json::Value>,
        _: &'a CancelFlag,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = semantic::Result<serde_json::Value>> + Send + 'a>,
    > {
        Box::pin(async move {
            match route {
                "tags" => Ok(tags(&"a".repeat(64))),
                "show" => {
                    if self.shows.fetch_add(1, Ordering::SeqCst) >= 1 {
                        self.second_metadata.notify_one();
                    }
                    Ok(show())
                }
                _ => {
                    self.embeds.fetch_add(1, Ordering::SeqCst);
                    let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                    self.max_active.fetch_max(active, Ordering::SeqCst);
                    let _active = ActiveInput(self.active.clone());
                    self.started.notify_one();
                    std::future::pending().await
                }
            }
        })
    }
}
#[tokio::test]
async fn two_profiles_share_one_cancellable_build_input_permit() {
    let mock = Arc::new(SerialBuild {
        embeds: Default::default(),
        active: Arc::new(Default::default()),
        max_active: Default::default(),
        shows: Default::default(),
        started: Notify::new(),
        second_metadata: Notify::new(),
    });
    let (bridge, _dir) = fixture(mock.clone()).await;
    let storage = bridge.semantic_storage().await.unwrap();
    storage
        .create_profile(Profile {
            id: id("p2"),
            instance_id: id("i2"),
            source_epoch: epoch(),
            display_name: DisplayName::new("second synthetic").unwrap(),
            paired_origin: PairedOrigin::new("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .unwrap(),
            credential_reference: None,
        })
        .await
        .unwrap();
    storage
        .replace_tree(id("p2"), id("s2"), tree(1))
        .await
        .unwrap();
    drop(storage);
    bridge.save_semantic_config(config(true)).await.unwrap();
    let review = bridge.semantic_review_scope(scope()).await.unwrap();
    bridge.semantic_start_index(review.review_id).await.unwrap();
    mock.started.notified().await;
    let second = SemanticScope {
        profile_id: id("p2"),
        ..scope()
    };
    let review = bridge.semantic_review_scope(second).await.unwrap();
    bridge.semantic_start_index(review.review_id).await.unwrap();
    mock.second_metadata.notified().await;
    let paused = bridge
        .semantic_pause(id("p2"), epoch())
        .await
        .unwrap()
        .index
        .0
        .unwrap();
    assert_eq!(paused.ready, 0);
    assert_eq!(mock.embeds.load(Ordering::SeqCst), 1);
    assert_eq!(mock.max_active.load(Ordering::SeqCst), 1);
    bridge.semantic_pause(id("p"), epoch()).await.unwrap();
    assert_eq!(mock.active.load(Ordering::SeqCst), 0);
    bridge.semantic_resume(id("p2"), epoch()).await.unwrap();
    mock.started.notified().await;
    assert_eq!(mock.embeds.load(Ordering::SeqCst), 2);
    assert_eq!(mock.max_active.load(Ordering::SeqCst), 1);
    bridge.shutdown().await.unwrap();
    assert_eq!(mock.active.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn cancel_before_registration_is_bounded_profile_scoped_and_never_expires_into_http_permission()
 {
    let mock = Script::new(Vec::new());
    let (bridge, _dir) = fixture(mock.clone()).await;
    let query = SemanticQuery {
        request_id: id("late"),
        profile_id: id("p"),
        source_epoch: epoch(),
        index_id: id("old-index"),
        generation: count(1),
        text: "must-not-send".into(),
        top_k: 5,
    };
    bridge
        .semantic_cancel_query(id("p"), id("late"))
        .await
        .unwrap();
    tokio::time::advance(Duration::from_secs(86400)).await;
    let owned = bridge.inner.lock().await.storage.take().unwrap();
    let result = bridge.semantic_query(query.clone()).await.unwrap();
    assert_eq!(result.failure.0, Some(SemanticFailure::Cancelled));
    bridge.inner.lock().await.storage = Some(owned);
    assert!(mock.calls.lock().unwrap().is_empty());
    bridge
        .semantic_cancel_query(id("p2"), id("other-profile"))
        .await
        .unwrap();
    let result = bridge
        .semantic_query(SemanticQuery {
            request_id: id("other-profile"),
            ..query.clone()
        })
        .await
        .unwrap();
    assert_eq!(result.failure.0, Some(SemanticFailure::Disabled));
    assert!(mock.calls.lock().unwrap().is_empty());
    for n in 0..127 {
        bridge
            .semantic_cancel_query(id("p"), id(&format!("pending-{n}")))
            .await
            .unwrap();
    }
    bridge
        .semantic_cancel_query(id("p"), id("pending-0"))
        .await
        .unwrap();
    assert_eq!(
        bridge
            .semantic_cancel_query(id("p"), id("overflow"))
            .await
            .unwrap_err(),
        ErrorCode::LimitExceeded
    );
    assert_eq!(
        bridge
            .semantic_query(SemanticQuery {
                request_id: id("new-at-cap"),
                ..query.clone()
            })
            .await
            .unwrap_err(),
        ErrorCode::LimitExceeded
    );
    let lease = bridge.semantic.lease("q\0p\0pending-0".to_owned()).unwrap();
    assert!(lease.flag.is_cancelled());
    bridge
        .semantic_cancel_query(id("p"), id("fill-again"))
        .await
        .unwrap();
    bridge
        .semantic_cancel_query(id("p"), id("pending-0"))
        .await
        .unwrap();
    assert_eq!(
        bridge.semantic.lease("q\0p\0pending-0".to_owned()).err(),
        Some(ErrorCode::Conflict)
    );
    drop(lease);
    assert!(mock.calls.lock().unwrap().is_empty());
    bridge.shutdown().await.unwrap();
}
