//! Disposable Chrome profile for B100. This is not part of the default suite.
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};

use markbridge_protocol::{
    BookmarkNode, BridgeConnection, Counter, EditAction, FolderType, Id, Mutation, NodeKind,
    OperationState, OrganizationPhase, Title,
};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::{sleep, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use super::super::Bridge;
use super::super::credentials::CredentialStore;
use super::MemoryCredentials;

const DAILY_LEN: u64 = 849515;
const DAILY_SHA: &str = "DD95B7E69602227CAC98CEEE037DFF6DD359BC42AA1D27913D272A0F2DA20F82";

#[tokio::test]
#[ignore = "disposable Chrome profile; not the default suite"]
async fn disposable_chrome_b100_apply_interrupt_and_rollback() {
    let mut report = Report::new();
    let before = daily_bookmarks();
    report.set(
        "dailyBefore",
        serde_json::json!({"length": before.0, "sha256": before.1}),
    );
    assert_eq!(before.0, DAILY_LEN);
    assert_eq!(before.1, DAILY_SHA);

    let extension = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/extension/dist")
        .canonicalize()
        .unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let model_port = listener.local_addr().unwrap().port();
    let model = tokio::spawn(serve_model(listener));
    let credentials: std::sync::Arc<dyn CredentialStore> =
        std::sync::Arc::new(MemoryCredentials::default());
    let models: std::sync::Arc<dyn CredentialStore> =
        std::sync::Arc::new(MemoryCredentials::default());
    let transport: std::sync::Arc<dyn crate::ai::ModelTransport> =
        std::sync::Arc::new(crate::ai::ReqwestTransport::new().unwrap());
    let bridge = Bridge::open_with_ai(
        scratch.path().join("cache.sqlite"),
        credentials.clone(),
        models,
        transport,
    )
    .await
    .unwrap();
    bridge
        .save_ai_config(
            true,
            "ollama".into(),
            format!("http://127.0.0.1:{model_port}/api/chat"),
            "stub".into(),
        )
        .await
        .unwrap();
    let bridge_port = free_port();
    bridge.start(bridge_port).await.unwrap();

    let debug_port = free_port();
    let mut chrome = Chrome::launch(debug_port);
    let browser = timeout(Duration::from_secs(15), browser_socket(debug_port))
        .await
        .expect("chrome debugging port")
        .expect("json/version");
    report.set("browser", serde_json::json!(browser.0));
    let mut browser_cdp = Cdp::connect(&browser.1).await;
    let loaded = browser_cdp
        .call(
            "Extensions.loadUnpacked",
            serde_json::json!({"path": extension}),
        )
        .await;
    let extension_id = loaded["id"].as_str().expect("extension id").to_owned();
    assert_eq!(extension_id.len(), 32);
    let page = format!("chrome-extension://{extension_id}/options.html");
    browser_cdp
        .call("Target.createTarget", serde_json::json!({"url": page}))
        .await;
    let page_socket = timeout(
        Duration::from_secs(10),
        find_page(debug_port, &extension_id),
    )
    .await
    .expect("options page")
    .expect("options socket");
    let mut page_cdp = Cdp::connect(&page_socket).await;
    let created = timeout(Duration::from_secs(30), async {
        loop {
            match page_cdp.eval(BOOKMARKS_JS).await {
                Ok(value) if value.get("rollA").and_then(|item| item.as_str()).is_some() => {
                    return value;
                }
                _ => sleep(Duration::from_millis(200)).await,
            }
        }
    })
    .await
    .expect("bookmark create");
    let roll_a = created["rollA"].as_str().unwrap().to_owned();
    let roll_b = created["rollB"].as_str().unwrap().to_owned();
    let nested = created["nested"].as_str().unwrap().to_owned();
    let stayed: Vec<String> = created["stayed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_owned())
        .collect();
    let batch: Vec<String> = created["batch"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_owned())
        .collect();
    assert!(batch.iter().all(|id| !stayed.iter().any(|item| item == id)));
    assert_eq!(batch.len() + stayed.len(), 100);

    let offer = bridge.begin_pairing("disposable".into()).await.unwrap();
    let code = serde_json::to_string(&offer.pairing_code).unwrap();
    page_cdp
        .eval(&format!(
            "chrome.runtime.sendMessage({{type:'pair', code:{code}}})"
        ))
        .await
        .expect("pair command");
    let profile = timeout(
        Duration::from_secs(20),
        confirm_when_seen(&bridge, &offer.profile_id),
    )
    .await
    .expect("pairing instance")
    .unwrap();
    timeout(Duration::from_secs(20), wait_live(&bridge, &profile))
        .await
        .expect("live tree");
    report.set("paired", serde_json::json!(true));

    let roll_a_id = Id::new(&roll_a).unwrap();
    let bookmark_id = {
        let inner = bridge.inner.lock().await;
        let epoch = inner
            .profiles
            .get(profile.as_str())
            .unwrap()
            .identity
            .source_epoch;
        let rows = inner
            .storage()
            .unwrap()
            .bookmarks(profile.clone(), epoch)
            .await
            .unwrap();
        rows.into_iter()
            .find(|row| row.node.chrome_id.as_str() == roll_a)
            .unwrap()
            .bookmark_id
    };
    {
        let inner = bridge.inner.lock().await;
        inner
            .storage()
            .unwrap()
            .set_metadata(
                bookmark_id.clone(),
                crate::storage::Metadata {
                    display_title: None,
                    summary: Some("sidecar summary".into()),
                    note: "sidecar note".into(),
                    updated_at: Counter::new(1).unwrap(),
                },
            )
            .await
            .unwrap();
    }
    let initial = bridge.cache(profile.clone()).await.unwrap().0;
    let bar = bar_id(&initial);
    let before_tree = outline(&initial, &bar);
    let before_nested = outline(&initial, &nested);
    let nested_node = initial
        .iter()
        .find(|node| node.chrome_id.as_str() == nested)
        .unwrap();
    assert_eq!(nested_node.kind, NodeKind::Folder);
    assert_eq!(nested_node.title.as_str(), "分类");
    assert_eq!(
        nested_node.parent_id.as_ref().map(Id::as_str),
        Some(bar.as_str())
    );
    assert!(before_nested.len() >= 2);
    let mut shape = tree_shape(&initial);
    shape["nestedChildTitles"] = serde_json::Value::Array(
        before_nested
            .iter()
            .map(|row| row["title"].clone())
            .collect(),
    );
    shape["protected"] = serde_json::json!(protected_rows(&initial, &initial));
    assert_eq!(shape["bookmarkCount"].as_u64(), Some(100));
    assert!(shape["nestedFolders"].as_u64().unwrap() >= 1);
    assert_eq!(shape["duplicateUrl"].as_bool(), Some(true));
    assert_eq!(shape["chineseTitle"].as_bool(), Some(true));
    assert_eq!(shape["englishTitle"].as_bool(), Some(true));
    assert_eq!(shape["separator"].as_str(), Some("|"));
    assert_no_url(&shape);
    for row in &before_tree {
        assert_no_url(row);
    }
    report.set("shape", shape.clone());
    let small_job = organize(
        &bridge,
        &profile,
        &[Id::new(&roll_a).unwrap(), Id::new(&roll_b).unwrap()],
        0,
    )
    .await;
    timeout(
        Duration::from_secs(20),
        wait_phase(&bridge, &small_job, OrganizationPhase::Applied),
    )
    .await
    .expect("small apply");
    let small = bridge
        .organization_plan(small_job)
        .await
        .unwrap()
        .operation_id
        .0
        .unwrap();
    let revision = revision_of(&bridge, &profile).await;
    let undone = bridge
        .apply_edit(
            profile.clone(),
            revision,
            EditAction::Undo {
                operation_id: small,
            },
            false,
        )
        .await
        .unwrap();
    timeout(
        Duration::from_secs(20),
        wait_operation(
            &bridge,
            &profile,
            &undone.operation_id,
            OperationState::RolledBack,
        ),
    )
    .await
    .expect("small undo");
    let restored = timeout(Duration::from_secs(10), async {
        loop {
            let nodes = bridge.cache(profile.clone()).await.unwrap().0;
            if outline(&nodes, &bar) == before_tree && outline(&nodes, &nested) == before_nested {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(
        restored.is_ok(),
        "undo did not restore nested sibling order"
    );
    let metadata = {
        let inner = bridge.inner.lock().await;
        inner
            .storage()
            .unwrap()
            .metadata(bookmark_id)
            .await
            .unwrap()
            .unwrap()
    };
    assert_eq!(metadata.note, "sidecar note");
    assert_eq!(metadata.summary.as_deref(), Some("sidecar summary"));
    report.set(
        "rollback",
        serde_json::json!({
            "restored": true,
            "noteKept": true,
            "summaryKept": true,
            "nestedFolder": nested_node.title.as_str(),
            "siblings": before_nested,
            "tree": before_tree,
        }),
    );

    let revision = revision_of(&bridge, &profile).await;
    let renamed = bridge
        .apply_edit(
            profile.clone(),
            revision,
            EditAction::Update {
                chrome_id: roll_a_id.clone(),
                title: Some(Title::new("RollA renamed").unwrap()),
                url: None,
            },
            false,
        )
        .await
        .unwrap();
    timeout(Duration::from_secs(15), async {
        loop {
            if title_of(&bridge, &profile, &roll_a).await.as_deref() == Some("RollA renamed") {
                return;
            }
            sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .expect("renamed title");
    page_cdp
        .eval(&format!(
            "chrome.bookmarks.update({},{{title:'RollA external'}})",
            serde_json::to_string(&roll_a).unwrap()
        ))
        .await
        .expect("external title");
    timeout(Duration::from_secs(10), async {
        loop {
            if title_of(&bridge, &profile, &roll_a).await.as_deref() == Some("RollA external") {
                return;
            }
            sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .expect("external title reached the cache");
    let revision = revision_of(&bridge, &profile).await;
    let conflict = bridge
        .apply_edit(
            profile.clone(),
            revision,
            EditAction::Undo {
                operation_id: renamed.operation_id.clone(),
            },
            false,
        )
        .await
        .unwrap();
    assert_eq!(conflict.state, OperationState::RollbackConflict);
    assert_eq!(
        title_of(&bridge, &profile, &roll_a).await.as_deref(),
        Some("RollA external")
    );
    bridge
        .review_operation(profile.clone(), conflict.operation_id)
        .await
        .unwrap();
    report.set("externalEditKept", serde_json::json!(true));

    let ids: Vec<Id> = batch.iter().map(|id| Id::new(id).unwrap()).collect();
    let ready = ready_plan(&bridge, &profile, &ids, 5).await;
    let rejected: Vec<String> = ready
        .assignments
        .iter()
        .filter(|item| item.rejected)
        .map(|item| item.chrome_id.as_str().to_owned())
        .collect();
    assert_eq!(rejected.len(), 5);
    assert!(ready.scope.iter().all(|item| {
        batch.iter().any(|id| id == item.chrome_id.as_str())
            && !stayed.iter().any(|id| id == item.chrome_id.as_str())
    }));
    chrome.capture();
    report.set("chromePids", serde_json::json!(chrome.pids.len()));
    let job = ready.job_id.clone();
    let database = scratch.path().join("cache.sqlite");
    let watch = StepWatch::spawn(
        database.clone(),
        job.as_str().to_owned(),
        chrome.pids.clone(),
    );
    let applied = bridge
        .apply_organization(job.clone(), ready.plan_hash)
        .await
        .unwrap();
    assert_eq!(
        applied.phase,
        OrganizationPhase::Applying,
        "{:?}",
        applied.failure_message
    );
    let pids = chrome.pids.clone();
    let hit = timeout(Duration::from_secs(60), async {
        loop {
            let plan = bridge.organization_plan(job.clone()).await.unwrap();
            let at_forty = plan
                .uncertain
                .iter()
                .any(|range| range.start.get() <= 39 && range.end.get() > 39);
            if at_forty {
                suspend_pids(&pids);
                return plan;
            }
            if matches!(
                plan.phase,
                OrganizationPhase::Applied
                    | OrganizationPhase::Failed
                    | OrganizationPhase::Invalid
                    | OrganizationPhase::Cancelled
            ) {
                return plan;
            }
            if plan
                .applied
                .first()
                .is_some_and(|range| range.end.get() >= 30)
            {
                tokio::task::yield_now().await;
            } else {
                sleep(Duration::from_millis(5)).await;
            }
        }
    })
    .await
    .expect("step 40");
    drop(watch);
    drop(chrome);
    timeout(Duration::from_secs(10), async {
        loop {
            let state = bridge.state().await;
            let live = state.profiles.iter().any(|item| {
                item.profile_id == profile && item.connection == BridgeConnection::Live
            });
            if !live {
                return;
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("session drop");
    report.set(
        "interrupted",
        serde_json::json!({
            "phase": hit.phase,
            "applied": ranges(&hit.applied),
            "pending": ranges(&hit.pending),
            "uncertain": ranges(&hit.uncertain),
        }),
    );
    assert!(
        hit.uncertain
            .iter()
            .any(|range| range.start.get() == 39 && range.end.get() == 40),
        "step 40 was not left uncertain: {}",
        serde_json::to_string(&ranges(&hit.uncertain)).unwrap()
    );

    let after_tree = bridge.cache(profile.clone()).await.unwrap().0;
    let database = scratch.path().join("cache.sqlite");
    bridge.shutdown().await.unwrap();
    let bridge = Bridge::open(&database, credentials).await.unwrap();
    let recovered = bridge.organization_plan(job.clone()).await.unwrap();
    assert_eq!(recovered.phase, OrganizationPhase::Partial);
    assert_eq!(recovered.applied[0].start.get(), 0);
    assert_eq!(recovered.applied[0].end.get(), 39);
    assert_eq!(recovered.uncertain[0].start.get(), 39);
    assert_eq!(recovered.uncertain[0].end.get(), 40);
    assert_eq!(recovered.pending[0].start.get(), 40);
    let operation_id = recovered.operation_id.0.clone().unwrap();
    let steps = {
        let inner = bridge.inner.lock().await;
        inner
            .storage()
            .unwrap()
            .operation(operation_id)
            .await
            .unwrap()
            .steps
    };
    let receipts: Vec<_> = steps
        .iter()
        .map(|step| {
            serde_json::json!({
                "ordinal": step.ordinal,
                "kind": kind_name(&step.payload),
                "state": step.receipt.as_ref().map(|receipt| state_name(&receipt.state)),
            })
        })
        .collect();
    assert!(receipts.len() > 40);
    assert!(receipts[..39].iter().all(|item| item["state"] == "applied"));
    assert!(receipts[39]["state"].is_null());
    assert!(receipts[40]["state"].is_null());
    report.set(
        "recovered",
        serde_json::json!({
            "phase": recovered.phase,
            "applied": ranges(&recovered.applied),
            "pending": ranges(&recovered.pending),
            "uncertain": ranges(&recovered.uncertain),
            "receipts": receipts,
        }),
    );
    let protected = protected_rows(&initial, &after_tree);
    let unselected = unselected_rows(&initial, &after_tree, &stayed);
    let guards = protected_ids(&initial);
    assert!(protected.iter().any(|row| {
        row["folderType"].as_str() == Some("bookmarks-bar")
            && row["moved"].as_bool() == Some(false)
            && row["deleted"].as_bool() == Some(false)
    }));
    assert!(protected.iter().all(|row| {
        row["moved"].as_bool() == Some(false) && row["deleted"].as_bool() == Some(false)
    }));
    assert!(
        unselected
            .iter()
            .all(|row| row["stayed"].as_bool() == Some(true))
    );
    assert!(
        steps
            .iter()
            .all(|step| !matches!(step.payload, Mutation::Delete {}))
    );
    assert!(steps.iter().all(|step| {
        let Some(target) = step.target.as_ref() else {
            return true;
        };
        !guards.iter().any(|id| id == target.as_str())
            && !stayed.iter().any(|id| id == target.as_str())
            && !rejected.iter().any(|id| id == target.as_str())
    }));
    for id in &rejected {
        let node = after_tree
            .iter()
            .find(|node| node.chrome_id.as_str() == id)
            .unwrap();
        assert_eq!(node.parent_id.as_ref().map(Id::as_str), Some(bar.as_str()));
    }
    assert_eq!(tree_shape(&after_tree)["bookmarkCount"].as_u64(), Some(100));
    shape["protected"] = serde_json::json!(protected);
    shape["unselectedStayed"] = serde_json::json!(
        unselected
            .iter()
            .all(|row| row["stayed"].as_bool() == Some(true))
    );
    shape["deletes"] = serde_json::json!(
        steps
            .iter()
            .filter(|step| matches!(step.payload, Mutation::Delete {}))
            .count()
    );
    assert_no_url(&shape);
    report.set("shape", shape);
    report.set("unselected", serde_json::json!(unselected));
    bridge.shutdown().await.unwrap();
    model.abort();

    let after = daily_bookmarks();
    report.set(
        "dailyAfter",
        serde_json::json!({"length": after.0, "sha256": after.1}),
    );
    assert_eq!(after, before);
    report.finish();
}

const BOOKMARKS_JS: &str = r#"(async () => {
  if (!chrome.bookmarks) throw new Error('bookmarks api missing');
  const root = (await chrome.bookmarks.getTree())[0];
  const bar = root.children.find((node) => node.folderType === 'bookmarks-bar');
  if (!bar) throw new Error('no bookmarks bar');
  const nested = await chrome.bookmarks.create({parentId: bar.id, title: '分类'});
  const rollA = await chrome.bookmarks.create({parentId: nested.id, title: 'RollA', url: 'https://example.test/roll/a'});
  const rollB = await chrome.bookmarks.create({parentId: nested.id, title: 'RollB', url: 'https://example.test/roll/b'});
  const stay = await chrome.bookmarks.create({parentId: nested.id, title: '留在原位', url: 'https://example.test/stay'});
  const separator = await chrome.bookmarks.create({parentId: nested.id, title: '中文 | 分隔', url: 'https://example.test/sep'});
  const batch = [];
  for (let index = 0; index < 96; index += 1) {
    const title = index % 2 === 0
      ? `Item ${String(index).padStart(3, '0')}`
      : `条目 ${String(index).padStart(3, '0')}`;
    const path = index < 2 ? 'dup' : `b/${String(index).padStart(3, '0')}`;
    const node = await chrome.bookmarks.create({
      parentId: bar.id,
      title,
      url: `https://example.test/${path}`,
    });
    batch.push(node.id);
  }
  return {
    rollA: rollA.id,
    rollB: rollB.id,
    nested: nested.id,
    stayed: [rollA.id, rollB.id, stay.id, separator.id],
    batch,
  };
})()"#;

async fn organize(bridge: &Bridge, profile: &Id, chrome_ids: &[Id], reject: usize) -> Id {
    let current = ready_plan(bridge, profile, chrome_ids, reject).await;
    let applied = bridge
        .apply_organization(current.job_id.clone(), current.plan_hash)
        .await
        .unwrap();
    assert_eq!(
        applied.phase,
        OrganizationPhase::Applying,
        "{:?}",
        applied.failure_message
    );
    current.job_id
}

async fn ready_plan(
    bridge: &Bridge,
    profile: &Id,
    chrome_ids: &[Id],
    reject: usize,
) -> markbridge_protocol::OrganizationPlan {
    let proposed = bridge
        .propose_organization(profile.clone(), chrome_ids.to_vec())
        .await
        .unwrap();
    assert_eq!(
        proposed.phase,
        OrganizationPhase::Folders,
        "{:?}",
        proposed.failure_message
    );
    let mut folders = proposed.folders;
    for folder in &mut folders {
        folder.reviewed = true;
    }
    let reviewed = bridge
        .review_organization(proposed.job_id.clone(), folders)
        .await
        .unwrap();
    assert_eq!(
        reviewed.phase,
        OrganizationPhase::Reviewed,
        "{:?}",
        reviewed.failure_message
    );
    let assigned = bridge
        .assign_organization(reviewed.job_id.clone())
        .await
        .unwrap();
    assert_eq!(
        assigned.phase,
        OrganizationPhase::Ready,
        "{:?}",
        assigned.failure_message
    );
    let mut current = assigned;
    for item in current.assignments.clone().into_iter().take(reject) {
        current = bridge
            .edit_organization(
                current.job_id.clone(),
                item.chrome_id,
                item.target_folder_id,
                true,
            )
            .await
            .unwrap();
    }
    if reject > 0 {
        assert_eq!(
            current
                .assignments
                .iter()
                .filter(|item| item.rejected)
                .count(),
            reject
        );
    }
    current
}

async fn confirm_when_seen(bridge: &Bridge, profile: &Id) -> Result<Id, ()> {
    loop {
        let state = bridge.state().await;
        if let Some(pending) = state
            .pending
            .iter()
            .find(|item| &item.profile_id == profile)
            && let Some(instance) = pending.instance_id.0.clone()
        {
            bridge
                .confirm_pairing(profile.clone(), instance)
                .await
                .map_err(|_| ())?;
            return Ok(profile.clone());
        }
        sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_live(bridge: &Bridge, profile: &Id) {
    loop {
        let state = bridge.state().await;
        if state
            .profiles
            .iter()
            .any(|item| &item.profile_id == profile && item.connection == BridgeConnection::Live)
        {
            return;
        }
        sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_phase(bridge: &Bridge, job: &Id, phase: OrganizationPhase) {
    loop {
        let plan = bridge.organization_plan(job.clone()).await.unwrap();
        if plan.phase == phase {
            return;
        }
        if matches!(
            plan.phase,
            OrganizationPhase::Failed
                | OrganizationPhase::Invalid
                | OrganizationPhase::Cancelled
                | OrganizationPhase::Partial
                | OrganizationPhase::Paused
        ) {
            panic!(
                "phase {:?} {}",
                plan.phase,
                plan.failure_message.0.unwrap_or_default()
            );
        }
        sleep(Duration::from_millis(20)).await;
    }
}

async fn wait_operation(bridge: &Bridge, profile: &Id, operation: &Id, state: OperationState) {
    loop {
        let list = bridge.list_operations(profile.clone()).await.unwrap();
        if list
            .operations
            .iter()
            .any(|item| &item.operation_id == operation && item.state == state)
        {
            return;
        }
        sleep(Duration::from_millis(30)).await;
    }
}

async fn revision_of(bridge: &Bridge, profile: &Id) -> u64 {
    bridge
        .state()
        .await
        .profiles
        .iter()
        .find(|item| &item.profile_id == profile)
        .unwrap()
        .revision
        .get()
}

async fn title_of(bridge: &Bridge, profile: &Id, chrome: &str) -> Option<String> {
    bridge
        .cache(profile.clone())
        .await
        .ok()?
        .0
        .into_iter()
        .find(|node| node.chrome_id.as_str() == chrome)
        .map(|node| node.title.as_str().to_owned())
}

fn bar_id(nodes: &[BookmarkNode]) -> String {
    nodes
        .iter()
        .find(|node| node.folder_type == Some(FolderType::BookmarksBar))
        .unwrap()
        .chrome_id
        .as_str()
        .to_owned()
}

fn is_protected(node: &BookmarkNode) -> bool {
    node.parent_id.is_none() || node.folder_type.is_some() || node.unmodifiable.is_some()
}

fn folder_label(kind: &FolderType) -> &'static str {
    match kind {
        FolderType::BookmarksBar => "bookmarks-bar",
        FolderType::Other => "other",
        FolderType::Mobile => "mobile",
        FolderType::Managed => "managed",
    }
}

fn protected_ids(nodes: &[BookmarkNode]) -> Vec<String> {
    nodes
        .iter()
        .filter(|node| is_protected(node))
        .map(|node| node.chrome_id.as_str().to_owned())
        .collect()
}

fn protected_rows(before: &[BookmarkNode], after: &[BookmarkNode]) -> Vec<serde_json::Value> {
    before
        .iter()
        .filter(|node| is_protected(node))
        .map(|node| {
            let found = after.iter().find(|item| item.chrome_id == node.chrome_id);
            let moved = found.is_some_and(|item| {
                item.parent_id != node.parent_id || item.position != node.position
            });
            serde_json::json!({
                "root": node.parent_id.is_none(),
                "folderType": node.folder_type.as_ref().map(folder_label),
                "unmodifiable": node.unmodifiable.is_some(),
                "moved": moved,
                "deleted": found.is_none(),
            })
        })
        .collect()
}

fn unselected_rows(
    before: &[BookmarkNode],
    after: &[BookmarkNode],
    ids: &[String],
) -> Vec<serde_json::Value> {
    ids.iter()
        .map(|id| {
            let left = before
                .iter()
                .find(|node| node.chrome_id.as_str() == id)
                .unwrap();
            let right = after.iter().find(|node| node.chrome_id.as_str() == id);
            let stayed = right.is_some_and(|node| {
                node.parent_id == left.parent_id && node.position == left.position
            });
            serde_json::json!({
                "title": left.title.as_str(),
                "position": left.position.get(),
                "stayed": stayed,
            })
        })
        .collect()
}

fn outline(nodes: &[BookmarkNode], parent: &str) -> Vec<serde_json::Value> {
    let mut children: Vec<&BookmarkNode> = nodes
        .iter()
        .filter(|node| {
            node.parent_id
                .as_ref()
                .is_some_and(|id| id.as_str() == parent)
        })
        .collect();
    children.sort_by_key(|node| (node.position.get(), node.chrome_id.as_str().to_owned()));
    children
        .into_iter()
        .map(|node| {
            let (host, url_key) = node
                .url
                .as_ref()
                .map(|url| url_parts(url.as_str()))
                .unwrap_or_default();
            serde_json::json!({
                "kind": match node.kind {
                    NodeKind::Folder => "folder",
                    NodeKind::Bookmark => "bookmark",
                },
                "position": node.position.get(),
                "title": node.title.as_str(),
                "host": host,
                "urlKey": url_key,
                "children": outline(nodes, node.chrome_id.as_str()),
            })
        })
        .collect()
}

fn url_parts(raw: &str) -> (String, String) {
    let Ok(url) = url::Url::parse(raw) else {
        return (String::new(), String::new());
    };
    let host = url.host_str().unwrap_or("").to_owned();
    let digest = Sha256::digest(format!("{host}\n{}", url.path()).as_bytes());
    let key: String = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    (host, key)
}

fn tree_shape(nodes: &[BookmarkNode]) -> serde_json::Value {
    let bookmarks: Vec<&BookmarkNode> = nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Bookmark)
        .collect();
    let nested = nodes
        .iter()
        .filter(|node| {
            node.kind == NodeKind::Folder
                && node.folder_type.is_none()
                && node.parent_id.as_ref().is_some_and(|parent_id| {
                    nodes.iter().any(|parent| {
                        &parent.chrome_id == parent_id && parent.kind == NodeKind::Folder
                    })
                })
        })
        .count();
    let mut keys: Vec<String> = bookmarks
        .iter()
        .filter_map(|node| node.url.as_ref().map(|url| url_parts(url.as_str()).1))
        .filter(|key| !key.is_empty())
        .collect();
    keys.sort();
    let mut duplicate_keys = Vec::new();
    let mut index = 0;
    while index < keys.len() {
        let mut end = index + 1;
        while end < keys.len() && keys[end] == keys[index] {
            end += 1;
        }
        if end - index >= 2 {
            duplicate_keys.push(keys[index].clone());
        }
        index = end;
    }
    let chinese = nodes.iter().any(|node| {
        node.title
            .as_str()
            .chars()
            .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
    });
    let english = nodes.iter().any(|node| {
        node.title
            .as_str()
            .chars()
            .any(|ch| ch.is_ascii_alphabetic())
    });
    let separator = if nodes.iter().any(|node| node.title.as_str().contains('|')) {
        serde_json::Value::String("|".to_owned())
    } else {
        serde_json::Value::Null
    };
    serde_json::json!({
        "bookmarkCount": bookmarks.len(),
        "nestedFolders": nested,
        "duplicateUrl": !duplicate_keys.is_empty(),
        "duplicateKeys": duplicate_keys,
        "chineseTitle": chinese,
        "englishTitle": english,
        "separator": separator,
    })
}

fn assert_no_url(value: &serde_json::Value) {
    match value {
        serde_json::Value::String(text) => {
            assert!(!text.contains("://"), "full url in evidence");
            assert!(!text.contains('@'), "credential in evidence");
        }
        serde_json::Value::Array(items) => {
            for item in items {
                assert_no_url(item);
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values() {
                assert_no_url(item);
            }
        }
        _ => {}
    }
}

fn ranges(items: &[markbridge_protocol::OrganizationRange]) -> Vec<serde_json::Value> {
    items
        .iter()
        .map(|range| serde_json::json!([range.start.get(), range.end.get()]))
        .collect()
}

fn kind_name(payload: &Mutation) -> &'static str {
    match payload {
        Mutation::Create { .. } => "create",
        Mutation::Update { .. } => "update",
        Mutation::Move { .. } => "move",
        Mutation::Reorder { .. } => "reorder",
        Mutation::Delete {} => "delete",
    }
}

fn state_name(state: &OperationState) -> &'static str {
    match state {
        OperationState::Applied => "applied",
        OperationState::Failed => "failed",
        OperationState::Uncertain => "uncertain",
        OperationState::Partial => "partial",
        _ => "other",
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn daily_bookmarks() -> (u64, String) {
    let path = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap())
        .join("Google")
        .join("Chrome")
        .join("User Data")
        .join("Default")
        .join("Bookmarks");
    let bytes = std::fs::read(&path).unwrap();
    let hash = Sha256::digest(&bytes);
    let text: String = hash.iter().map(|byte| format!("{byte:02X}")).collect();
    (bytes.len() as u64, text)
}

async fn serve_model(listener: TcpListener) {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else {
            break;
        };
        tokio::spawn(async move {
            let Some(body) = read_http(&mut socket).await else {
                return;
            };
            let response = model_response(&body);
            let _ = socket.write_all(&response).await;
        });
    }
}

async fn read_http(socket: &mut tokio::net::TcpStream) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let mut tmp = [0_u8; 8192];
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if tokio::time::Instant::now() > deadline || buf.len() > 2_000_000 {
            return None;
        }
        let size = socket.read(&mut tmp).await.ok()?;
        if size == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..size]);
        let header_end = buf.windows(4).position(|mark| mark == b"\r\n\r\n")?;
        let headers = String::from_utf8_lossy(&buf[..header_end]);
        let length = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })?;
        let start = header_end + 4;
        if buf.len() >= start + length {
            return Some(buf[start..start + length].to_vec());
        }
    }
}

fn model_response(body: &[u8]) -> Vec<u8> {
    let value: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
    let user = value["messages"]
        .as_array()
        .map(|messages| {
            messages
                .iter()
                .filter_map(|message| message["content"].as_str())
                .find(|text| text.contains("Propose between") || text.contains("Data start"))
                .unwrap_or("")
                .to_owned()
        })
        .unwrap_or_default();
    let content = if user.contains("Propose between 8 and") {
        let names = [
            "阅读", "工具", "资料", "新闻", "购物", "开发", "视频", "旅行",
        ];
        let folders: Vec<_> = names
            .iter()
            .map(|name| serde_json::json!({"name": name, "parent": null}))
            .collect();
        serde_json::json!({"folders": folders}).to_string()
    } else if user.contains("Propose between") {
        serde_json::json!({"folders":[{"name":"阅读","parent":null}]}).to_string()
    } else {
        let mut items = false;
        let mut assignments = Vec::new();
        for line in user.lines() {
            if line == "Data start" {
                items = true;
                continue;
            }
            if line == "Data end" {
                break;
            }
            if items && let Some(id) = line.strip_prefix("id: ") {
                assignments.push(serde_json::json!({
                    "chromeId": id,
                    "folderId": "fld1",
                    "citedInputId": id,
                    "citedFolderId": "fld1"
                }));
            }
        }
        serde_json::json!({"assignments": assignments}).to_string()
    };
    let payload = serde_json::json!({"message": {"content": content}}).to_string();
    let header = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        payload.len()
    );
    let mut bytes = header.into_bytes();
    bytes.extend(payload.into_bytes());
    bytes
}

async fn browser_socket(port: u16) -> Option<(String, String)> {
    loop {
        if let Ok(response) = reqwest::get(format!("http://127.0.0.1:{port}/json/version")).await
            && let Ok(value) = response.json::<serde_json::Value>().await
            && let (Some(browser), Some(url)) = (
                value["Browser"].as_str(),
                value["webSocketDebuggerUrl"].as_str(),
            )
        {
            return Some((browser.to_owned(), url.to_owned()));
        }
        sleep(Duration::from_millis(200)).await;
    }
}

async fn find_page(port: u16, extension_id: &str) -> Option<String> {
    let needle = format!("chrome-extension://{extension_id}/");
    loop {
        if let Ok(response) = reqwest::get(format!("http://127.0.0.1:{port}/json/list")).await
            && let Ok(value) = response.json::<serde_json::Value>().await
            && let Some(rows) = value.as_array()
        {
            for row in rows {
                let url = row["url"].as_str().unwrap_or("");
                if url.starts_with(&needle)
                    && url.contains("options.html")
                    && let Some(socket) = row["webSocketDebuggerUrl"].as_str()
                {
                    return Some(socket.to_owned());
                }
            }
        }
        sleep(Duration::from_millis(200)).await;
    }
}

struct Cdp {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    id: u64,
}

impl Cdp {
    async fn connect(url: &str) -> Self {
        let (socket, _) = connect_async(url).await.unwrap();
        Self { socket, id: 0 }
    }

    async fn call(&mut self, method: &str, params: serde_json::Value) -> serde_json::Value {
        self.id += 1;
        let id = self.id;
        let text = serde_json::json!({"id": id, "method": method, "params": params}).to_string();
        use futures_util::{SinkExt, StreamExt};
        self.socket.send(Message::Text(text.into())).await.unwrap();
        loop {
            let message = self.socket.next().await.unwrap().unwrap();
            let Message::Text(text) = message else {
                continue;
            };
            let value: serde_json::Value = serde_json::from_str(&text).unwrap();
            if value["id"] == id {
                if let Some(error) = value.get("error") {
                    panic!("{method} {error}");
                }
                return value["result"].clone();
            }
        }
    }

    async fn eval(&mut self, expression: &str) -> Result<serde_json::Value, String> {
        let result = self
            .call(
                "Runtime.evaluate",
                serde_json::json!({
                    "expression": expression,
                    "awaitPromise": true,
                    "returnByValue": true,
                }),
            )
            .await;
        if let Some(details) = result.get("exceptionDetails") {
            return Err(details.to_string());
        }
        Ok(result["result"]["value"].clone())
    }
}

struct Chrome {
    child: Child,
    dir: tempfile::TempDir,
    pids: Vec<u32>,
}

impl Chrome {
    fn launch(port: u16) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let child = Command::new(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            .arg(format!("--user-data-dir={}", dir.path().display()))
            .arg(format!("--remote-debugging-port={port}"))
            .arg("--remote-allow-origins=*")
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-sync")
            .arg("--new-window")
            .arg("about:blank")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pids = vec![child.id()];
        Self { child, dir, pids }
    }

    fn capture(&mut self) {
        let mut pids = family(self.child.id());
        if pids.len() < 2 {
            let marker = self
                .dir
                .path()
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            for pid in chrome_pids_with_marker(&marker) {
                if !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }
        if pids.is_empty() {
            pids.push(self.child.id());
        }
        self.pids = pids;
    }
}

impl Drop for Chrome {
    fn drop(&mut self) {
        let mut pids = self.pids.clone();
        for pid in family(self.child.id()) {
            if !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        suspend_pids(&pids);
        let _ = self.child.kill();
        terminate_pids(&pids);
        let _ = self.child.wait();
    }
}

struct StepWatch {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl StepWatch {
    fn spawn(database: PathBuf, job_id: String, pids: Vec<u32>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::spawn(move || watch_step_forty(database, job_id, pids, flag));
        Self {
            stop,
            handle: Some(handle),
        }
    }
}

impl Drop for StepWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn watch_step_forty(database: PathBuf, job_id: String, pids: Vec<u32>, stop: Arc<AtomicBool>) {
    let Ok(connection) = rusqlite::Connection::open(&database) else {
        return;
    };
    let _ = connection.busy_timeout(Duration::from_millis(20));
    let started = std::time::Instant::now();
    while !stop.load(Ordering::Relaxed) && started.elapsed() < Duration::from_secs(90) {
        if dispatched_without_receipt(&connection, &job_id) {
            suspend_pids(&pids);
            return;
        }
        std::thread::sleep(Duration::from_micros(200));
    }
}

fn dispatched_without_receipt(connection: &rusqlite::Connection, job_id: &str) -> bool {
    let proposal: Result<Option<String>, rusqlite::Error> = connection.query_row(
        "SELECT proposal FROM ai_jobs WHERE id=?1",
        [job_id],
        |row| row.get(0),
    );
    let Ok(Some(proposal)) = proposal else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&proposal) else {
        return false;
    };
    let Some(dispatched) = value["dispatched"].as_array() else {
        return false;
    };
    if dispatched.len() < 40 {
        return false;
    }
    let Some(request) = dispatched[39].as_str() else {
        return false;
    };
    let receipt: Result<Option<String>, rusqlite::Error> = connection.query_row(
        "SELECT receipt FROM operation_steps WHERE request_id=?1",
        [request],
        |row| row.get(0),
    );
    matches!(receipt, Ok(None))
}

struct Report {
    path: PathBuf,
    value: serde_json::Value,
    done: bool,
}

impl Report {
    fn new() -> Self {
        Self {
            path: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../.trellis/tasks/10-10-mb-11-batch-organization/evidence/b100-run.json"),
            value: serde_json::json!({
                "status": "FAIL",
                "command": "cargo test -p markbridge-core --lib --locked disposable_chrome_b100 -- --ignored --nocapture --test-threads=1"
            }),
            done: false,
        }
    }

    fn set(&mut self, key: &str, item: serde_json::Value) {
        self.value[key] = item;
    }

    fn finish(&mut self) {
        self.value["status"] = serde_json::json!("PASS");
        self.done = true;
    }
}

impl Drop for Report {
    fn drop(&mut self) {
        if !self.done {
            self.value["status"] = serde_json::json!("FAIL");
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.value) {
            let _ = std::fs::write(&self.path, text);
        }
    }
}

fn suspend_pids(pids: &[u32]) {
    for pid in pids {
        signal_pid(*pid, true);
    }
}

fn terminate_pids(pids: &[u32]) {
    for pid in pids {
        signal_pid(*pid, false);
    }
}

fn chrome_pids_with_marker(marker: &str) -> Vec<u32> {
    if marker.is_empty() {
        return Vec::new();
    }
    let snap = unsafe { CreateToolhelp32Snapshot(0x0000_0002, 0) };
    if snap == -1 {
        return Vec::new();
    }
    let mut matched = Vec::new();
    let mut entry: ProcessEntry = unsafe { std::mem::zeroed() };
    entry.size = std::mem::size_of::<ProcessEntry>() as u32;
    if unsafe { Process32FirstW(snap, &mut entry) } != 0 {
        loop {
            if exe_name(&entry).eq_ignore_ascii_case("chrome.exe")
                && command_line(entry.pid).is_some_and(|line| line.contains(marker))
            {
                matched.push(entry.pid);
            }
            entry.size = std::mem::size_of::<ProcessEntry>() as u32;
            if unsafe { Process32NextW(snap, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe { CloseHandle(snap) };
    matched
}

fn exe_name(entry: &ProcessEntry) -> String {
    let end = entry
        .exe
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(entry.exe.len());
    String::from_utf16_lossy(&entry.exe[..end])
}

fn command_line(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(0x0410, 0, pid) };
    if handle == 0 {
        return None;
    }
    let mut basic = [0_u8; 48];
    let mut length = 0_u32;
    let status = unsafe {
        NtQueryInformationProcess(
            handle,
            0,
            basic.as_mut_ptr(),
            basic.len() as u32,
            &mut length,
        )
    };
    if status != 0 {
        unsafe { CloseHandle(handle) };
        return None;
    }
    let peb = u64::from_le_bytes(basic[8..16].try_into().ok()?);
    let mut params = [0_u8; 8];
    if !read_memory(handle, peb + 0x20, &mut params) {
        unsafe { CloseHandle(handle) };
        return None;
    }
    let params = u64::from_le_bytes(params);
    let mut text = [0_u8; 16];
    if !read_memory(handle, params + 0x70, &mut text) {
        unsafe { CloseHandle(handle) };
        return None;
    }
    let bytes = u16::from_le_bytes(text[0..2].try_into().ok()?) as usize;
    let buffer = u64::from_le_bytes(text[8..16].try_into().ok()?);
    if bytes == 0 || bytes > 32_768 || buffer == 0 {
        unsafe { CloseHandle(handle) };
        return None;
    }
    let mut raw = vec![0_u8; bytes];
    let ok = read_memory(handle, buffer, &mut raw);
    unsafe { CloseHandle(handle) };
    if !ok {
        return None;
    }
    let units: Vec<u16> = raw
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    Some(String::from_utf16_lossy(&units))
}

fn read_memory(handle: isize, address: u64, buffer: &mut [u8]) -> bool {
    let mut read = 0_usize;
    unsafe {
        ReadProcessMemory(
            handle,
            address as *const u8,
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut read,
        ) != 0
            && read == buffer.len()
    }
}

fn signal_pid(pid: u32, suspend: bool) {
    let handle = unsafe { OpenProcess(if suspend { 0x0800 } else { 0x0001 }, 0, pid) };
    if handle == 0 {
        return;
    }
    if suspend {
        unsafe { NtSuspendProcess(handle) };
    } else {
        unsafe { TerminateProcess(handle, 1) };
    }
    unsafe { CloseHandle(handle) };
}

fn family(root: u32) -> Vec<u32> {
    let snap = unsafe { CreateToolhelp32Snapshot(0x0000_0002, 0) };
    if snap == -1 {
        return vec![root];
    }
    let mut rows = Vec::new();
    let mut entry: ProcessEntry = unsafe { std::mem::zeroed() };
    entry.size = std::mem::size_of::<ProcessEntry>() as u32;
    if unsafe { Process32FirstW(snap, &mut entry) } != 0 {
        loop {
            rows.push((entry.pid, entry.parent));
            entry.size = std::mem::size_of::<ProcessEntry>() as u32;
            if unsafe { Process32NextW(snap, &mut entry) } == 0 {
                break;
            }
        }
    }
    unsafe { CloseHandle(snap) };
    let mut out = vec![root];
    let mut index = 0;
    while index < out.len() {
        let parent = out[index];
        for (pid, ppid) in &rows {
            if *ppid == parent && !out.contains(pid) {
                out.push(*pid);
            }
        }
        index += 1;
    }
    out
}

#[repr(C)]
#[allow(dead_code)]
struct ProcessEntry {
    size: u32,
    usage: u32,
    pid: u32,
    _pad: u32,
    heap: u64,
    module: u32,
    threads: u32,
    parent: u32,
    pri: i32,
    flags: u32,
    exe: [u16; 260],
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> isize;
    fn Process32FirstW(snap: isize, entry: *mut ProcessEntry) -> i32;
    fn Process32NextW(snap: isize, entry: *mut ProcessEntry) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    fn TerminateProcess(handle: isize, code: u32) -> i32;
    fn CloseHandle(handle: isize) -> i32;
    fn ReadProcessMemory(
        handle: isize,
        address: *const u8,
        buffer: *mut u8,
        size: usize,
        read: *mut usize,
    ) -> i32;
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtSuspendProcess(handle: isize) -> i32;
    fn NtQueryInformationProcess(
        handle: isize,
        class: u32,
        info: *mut u8,
        length: u32,
        returned: *mut u32,
    ) -> i32;
}
