use std::{
    collections::HashSet,
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use markbridge_protocol::{ErrorCode, Id};
use tokio::sync::Barrier;

use crate::{
    ai::{Audit, CancelFlag, ModelSecrets, save_config},
    storage::Storage,
};

use super::{
    check::{class_bounds, folder_prompt, parse_batch, parse_folders, sample_rows},
    record::{
        AssignRow, FolderRow, Record, ScopeRow, StepFact, apply_gate, edit_assignment, next_unsent,
        rehash, review_folders, to_plan_with_job,
    },
    schedule::{run_pair, windows},
    service::{ModelEnv, propose_folders},
};

fn row(chrome: &str) -> ScopeRow {
    ScopeRow {
        chrome_id: chrome.to_owned(),
        bookmark_id: format!("bm-{chrome}"),
        parent_id: "bar".to_owned(),
        position: 0,
        title: format!("标题 {chrome}"),
        url: Some(format!("https://example.test/{chrome}")),
    }
}

fn folder(id: &str, name: &str) -> FolderRow {
    FolderRow {
        folder_id: id.to_owned(),
        name: name.to_owned(),
        parent_folder_id: None,
        reviewed: true,
    }
}

fn record(scope: Vec<ScopeRow>) -> Record {
    let mut record = Record {
        profile_id: "profile-a".to_owned(),
        source_epoch: 1,
        source_revision: 4,
        fingerprint: "fingerprint-a".to_owned(),
        anchor_id: "bar".to_owned(),
        scope,
        sampled: 1,
        folders: vec![folder("fld1", "阅读")],
        assignments: vec![],
        phase: "ready".to_owned(),
        plan_hash: String::new(),
        operation_id: None,
        dispatched: vec![],
        backup_verified: false,
        failure: None,
        failure_message: None,
    };
    record.assignments.push(AssignRow {
        chrome_id: record.scope[0].chrome_id.clone(),
        bookmark_id: record.scope[0].bookmark_id.clone(),
        source_parent_id: "bar".to_owned(),
        source_label: record.scope[0].label(),
        target_folder_id: "fld1".to_owned(),
        cited_input_id: record.scope[0].chrome_id.clone(),
        cited_folder_id: "fld1".to_owned(),
        rejected: false,
    });
    rehash(&mut record);
    record
}

struct MemorySecrets;

impl ModelSecrets for MemorySecrets {
    fn read(&self, _: &str) -> Result<Option<String>, ErrorCode> {
        Ok(None)
    }
    fn write(&self, _: &str, _: &str) -> Result<(), ErrorCode> {
        Ok(())
    }
    fn remove(&self, _: &str) -> Result<(), ErrorCode> {
        Ok(())
    }
}

fn wrapped(content: serde_json::Value) -> String {
    serde_json::json!({"message": {"content": content.to_string()}}).to_string()
}

async fn enabled() -> (tempfile::TempDir, Storage) {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(dir.path().join("markbridge.sqlite"))
        .await
        .unwrap();
    save_config(
        &storage,
        &Audit::default(),
        true,
        "ollama",
        "http://127.0.0.1:11434",
        "qwen2.5:7b",
    )
    .await
    .unwrap();
    (dir, storage)
}

#[test]
fn sample_stops_at_200_and_the_prompt_omits_the_rest() {
    let rows: Vec<_> = (0..201).map(|index| row(&format!("c{index:03}"))).collect();
    let sample = sample_rows(&rows);
    assert_eq!(sample.len(), 200);
    let prompt = folder_prompt(&sample, 8, 12);
    assert!(prompt.contains("c000"));
    assert!(!prompt.contains("c200"));
    assert!(!prompt.contains("note:"));
    assert!(!prompt.contains("untrusted"));
    assert_eq!(class_bounds(3), (1, 3));
    assert_eq!(class_bounds(10), (8, 12));
}

#[test]
fn folders_allow_a_small_scope_and_reject_cycles_duplicates_and_a_short_large_scope() {
    let reserved = HashSet::new();
    let small = parse_folders(
        r#"{"folders":[{"name":"阅读","parent":null},{"name":"工具","parent":null}]}"#,
        3,
        &reserved,
    )
    .unwrap();
    assert_eq!(small.len(), 2);
    assert!(
        parse_folders(
            r#"{"folders":[{"name":"阅读","parent":null}]}"#,
            10,
            &reserved
        )
        .is_err()
    );
    assert_eq!(
        parse_folders(
            r#"{"folders":[{"name":"阅读","parent":null},{"name":"阅读","parent":null}]}"#,
            2,
            &reserved
        )
        .unwrap_err(),
        ErrorCode::InvalidAiOutput
    );
    assert_eq!(
        parse_folders(
            r#"{"folders":[{"name":"甲","parent":"乙"},{"name":"乙","parent":"甲"}]}"#,
            2,
            &reserved
        )
        .unwrap_err(),
        ErrorCode::InvalidTree
    );
    assert_eq!(
        parse_folders(
            r#"{"folders":[{"name":"甲","parent":"不存在"}]}"#,
            1,
            &reserved
        )
        .unwrap_err(),
        ErrorCode::InvalidAiOutput
    );
}

#[test]
fn assignments_require_exact_coverage_and_matching_citations() {
    let batch = vec![row("c001"), row("c002")];
    let folders = vec![folder("fld1", "阅读")];
    let ok = parse_batch(
        r#"{"assignments":[{"chromeId":"c001","folderId":"fld1","citedInputId":"c001","citedFolderId":"fld1"},{"chromeId":"c002","folderId":"fld1","citedInputId":"c002","citedFolderId":"fld1"}]}"#,
        &batch,
        &folders,
    ).unwrap();
    assert_eq!(ok.len(), 2);
    assert!(parse_batch(r#"{"assignments":[{"chromeId":"c001","folderId":"fld1","citedInputId":"c001","citedFolderId":"fld1"}]}"#, &batch, &folders).is_err());
    assert!(parse_batch(
        r#"{"assignments":[{"chromeId":"c001","folderId":"fld1","citedInputId":"other","citedFolderId":"fld1"},{"chromeId":"c002","folderId":"fld1","citedInputId":"c002","citedFolderId":"fld1"}]}"#,
        &batch,
        &folders,
    ).is_err());
    assert!(parse_batch(
        r#"{"assignments":[{"chromeId":"c001","folderId":"missing","citedInputId":"c001","citedFolderId":"missing"},{"chromeId":"c001","folderId":"fld1","citedInputId":"c001","citedFolderId":"fld1"}]}"#,
        &batch,
        &folders,
    ).is_err());
}

#[test]
fn reject_changes_the_plan_hash_and_the_gate_blocks_a_stale_plan() {
    let mut stored = record(vec![row("c001")]);
    let before = stored.plan_hash.clone();
    edit_assignment(&mut stored, "c001", "fld1", true).unwrap();
    assert_ne!(stored.plan_hash, before);
    assert_eq!(
        apply_gate("ready", false, true, true),
        Err(ErrorCode::StaleProposal)
    );
    assert_eq!(
        apply_gate("ready", true, false, true),
        Err(ErrorCode::StaleProposal)
    );
    assert_eq!(
        apply_gate("paused", true, true, true),
        Err(ErrorCode::Conflict)
    );
    assert_eq!(
        apply_gate("ready", true, true, false),
        Err(ErrorCode::ReadOnly)
    );
    assert!(apply_gate("ready", true, true, true).is_ok());
}

#[test]
fn recovery_lists_applied_pending_and_uncertain_without_a_replay() {
    let mut steps = Vec::new();
    for index in 0..45 {
        steps.push(StepFact {
            request_id: format!("req-{index}"),
            receipt: if index < 39 {
                Some("applied".to_owned())
            } else {
                None
            },
        });
    }
    let mut stored = record(vec![row("c001")]);
    stored.phase = "applying".to_owned();
    stored.dispatched = vec!["req-39".to_owned()];
    let plan = to_plan_with_job(&stored, "job-recovery", &steps, Some("uncertain")).unwrap();
    assert_eq!(plan.phase, markbridge_protocol::OrganizationPhase::Partial);
    assert_eq!(plan.applied[0].start.get(), 0);
    assert_eq!(plan.applied[0].end.get(), 39);
    assert_eq!(plan.uncertain[0].start.get(), 39);
    assert_eq!(plan.uncertain[0].end.get(), 40);
    assert_eq!(plan.pending[0].start.get(), 40);
    assert_eq!(plan.pending[0].end.get(), 45);
    let dispatched: HashSet<&str> = stored.dispatched.iter().map(String::as_str).collect();
    assert!(next_unsent(&steps, &dispatched).is_none());
}

#[test]
fn windows_cover_the_scope_in_batches_of_25() {
    assert!(windows(0, 25).is_empty());
    assert_eq!(windows(30, 25), vec![0..25, 25..30]);
}

#[tokio::test]
async fn two_assignment_batches_overlap() {
    let barrier = Arc::new(Barrier::new(2));
    let (values, error) = tokio::time::timeout(
        Duration::from_secs(2),
        run_pair(0..2, |_| {
            let barrier = barrier.clone();
            async move {
                barrier.wait().await;
                Ok::<_, ()>(1)
            }
        }),
    )
    .await
    .unwrap();
    assert!(error.is_none());
    assert_eq!(values, vec![1, 1]);
}

#[tokio::test]
async fn propose_reads_two_folders_and_a_timeout_is_not_repaired() {
    let (_dir, storage) = enabled().await;
    let sample = vec![row("c001"), row("c002"), row("c003")];
    let transport = crate::ai::ScriptedTransport::new(vec![crate::ai::ScriptedStep::Respond {
        status: 200,
        body: wrapped(
            serde_json::json!({"folders":[{"name":"阅读","parent":null},{"name":"工具","parent":null}]}),
        ),
        retry_after: None,
    }]);
    let flag = CancelFlag::new();
    let folders = propose_folders(
        ModelEnv {
            storage: &storage,
            secrets: &MemorySecrets,
            transport: &transport,
            flag: &flag,
        },
        &sample,
        &HashSet::new(),
        || true,
    )
    .await
    .unwrap();
    assert_eq!(folders.len(), 2);
    assert!(folders.iter().all(|folder| !folder.reviewed));
    let bodies = transport.bodies().await;
    assert_eq!(bodies.len(), 1);
    assert!(bodies[0].contains("c001"));
    assert!(!bodies[0].contains("c004"));
    assert!(bodies[0].contains("untrusted"));
    assert!(!bodies[0].contains("note:"));

    let timed = crate::ai::ScriptedTransport::new(vec![crate::ai::ScriptedStep::Fail(
        crate::ai::ModelError::TimedOut,
    )]);
    let error = propose_folders(
        ModelEnv {
            storage: &storage,
            secrets: &MemorySecrets,
            transport: &timed,
            flag: &flag,
        },
        &sample,
        &HashSet::new(),
        || true,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidMessage);
    assert_eq!(timed.calls(), 1);
}

#[tokio::test]
async fn a_changed_revision_does_not_return_folders() {
    let (_dir, storage) = enabled().await;
    let transport = crate::ai::ScriptedTransport::new(vec![crate::ai::ScriptedStep::Respond {
        status: 200,
        body: wrapped(serde_json::json!({"folders":[{"name":"阅读","parent":null}]})),
        retry_after: None,
    }]);
    let flag = CancelFlag::new();
    let error = propose_folders(
        ModelEnv {
            storage: &storage,
            secrets: &MemorySecrets,
            transport: &transport,
            flag: &flag,
        },
        &[row("c001")],
        &HashSet::new(),
        || false,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::StaleProposal);
    assert!(error.rows.is_empty());
}

#[tokio::test]
async fn organization_claim_does_not_take_a_single_item_job_slot() {
    let (_dir, storage) = enabled().await;
    storage
        .create_profile(crate::storage::Profile {
            id: Id::new("profile-a").unwrap(),
            instance_id: Id::new("instance-a").unwrap(),
            source_epoch: markbridge_protocol::SourceEpoch::new(1).unwrap(),
            display_name: markbridge_protocol::DisplayName::new("资料").unwrap(),
            paired_origin: crate::storage::PairedOrigin::new(format!(
                "chrome-extension://{}",
                "a".repeat(32)
            ))
            .unwrap(),
            credential_reference: None,
        })
        .await
        .unwrap();
    let id = Id::new("job-org").unwrap();
    let stored = record(vec![row("c001")]);
    storage
        .insert_organization_job(
            crate::storage::ai::OrganizationJob {
                id: id.clone(),
                profile_id: Id::new("profile-a").unwrap(),
                fingerprint: stored.fingerprint.clone(),
                state: "ready".to_owned(),
                proposal: serde_json::to_string(&stored).unwrap(),
                error_code: None,
                operation_id: None,
            },
            "qwen2.5:7b".to_owned(),
            "http://127.0.0.1:11434/api/chat".to_owned(),
        )
        .await
        .unwrap();
    assert!(!storage.claim_ai_job(id).await.unwrap());
}

#[test]
fn reviewed_folders_reject_an_unreviewed_directory() {
    let mut stored = record(vec![row("c001")]);
    let mut folders = stored.folders.clone();
    folders[0].reviewed = false;
    assert_eq!(
        review_folders(&mut stored, folders, &HashSet::new()).unwrap_err(),
        ErrorCode::InvalidMessage
    );
}

struct EchoAssign {
    calls: AtomicUsize,
    seen: Mutex<Vec<String>>,
}

impl crate::ai::ModelTransport for EchoAssign {
    fn post<'a>(
        &'a self,
        request: &'a crate::ai::ModelRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<crate::ai::ModelResponse, crate::ai::ModelError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let value: serde_json::Value = serde_json::from_str(&request.body).unwrap();
            let user = value["messages"][1]["content"].as_str().unwrap();
            self.seen.lock().unwrap().push(user.to_owned());
            let mut assignments = Vec::new();
            let mut items = false;
            for line in user.lines() {
                if line == "Data start" {
                    items = true;
                    continue;
                }
                if line == "Data end" {
                    break;
                }
                if items && let Some(id) = line.strip_prefix("id: ") {
                    assignments.push(serde_json::json!({"chromeId": id, "folderId": "fld1", "citedInputId": id, "citedFolderId": "fld1"}));
                }
            }
            Ok(crate::ai::ModelResponse {
                status: 200,
                body: wrapped(serde_json::json!({"assignments": assignments})),
                retry_after: None,
            })
        })
    }
}

#[tokio::test]
async fn assignment_stops_before_the_next_window_when_the_revision_changes() {
    let (_dir, storage) = enabled().await;
    let scope: Vec<_> = (0..51).map(|index| row(&format!("c{index:03}"))).collect();
    let transport = EchoAssign {
        calls: AtomicUsize::new(0),
        seen: Mutex::new(Vec::new()),
    };
    let checks = AtomicUsize::new(0);
    let flag = CancelFlag::new();
    let error = super::classify_scope(
        ModelEnv {
            storage: &storage,
            secrets: &MemorySecrets,
            transport: &transport,
            flag: &flag,
        },
        &scope,
        &[folder("fld1", "阅读")],
        || checks.fetch_add(1, Ordering::SeqCst) == 0,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::StaleProposal);
    assert_eq!(error.rows.len(), 50);
    assert_eq!(transport.calls.load(Ordering::SeqCst), 2);
    let seen = transport.seen.lock().unwrap().join("\n");
    assert!(!seen.contains("c050"));
    assert!(!seen.contains("note:"));
}
