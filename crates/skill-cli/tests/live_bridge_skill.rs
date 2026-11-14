use markbridge_core::bridge::{Bridge, credentials::CredentialStore};
use markbridge_protocol::{
    BridgeConnection, Counter, ErrorCode, FolderScope, Id, LibraryQuery, RequiredNullable, Title,
};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};

struct NoopCredentials;

impl CredentialStore for NoopCredentials {
    fn get(&self, _reference: &str) -> Result<String, ErrorCode> {
        Err(ErrorCode::StorageError)
    }
    fn set(&self, _reference: &str, _secret: &str) -> Result<(), ErrorCode> {
        Err(ErrorCode::StorageError)
    }
    fn delete(&self, _reference: &str) -> Result<(), ErrorCode> {
        Err(ErrorCode::StorageError)
    }
}

fn python_executable() -> &'static str {
    if Command::new("python").arg("--version").output().is_ok() {
        "python"
    } else {
        "python3"
    }
}

fn run_skill_wrapper(
    wrapper_script: &Path,
    bin_path: &Path,
    app_data: &Path,
    args: &[&str],
) -> Value {
    let output = Command::new(python_executable())
        .arg(wrapper_script)
        .arg("--app-data")
        .arg(app_data)
        .args(args)
        .env("MARKBRIDGE_SKILL_BIN", bin_path)
        // Piped output must remain UTF-8 even with a legacy Windows code page.
        .env("PYTHONIOENCODING", "cp1252")
        .output()
        .expect("spawn mb_bookmarks.py");
    assert!(
        output.status.success(),
        "mb_bookmarks.py failed (status={:?}): stdout={} stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("valid JSON output from mb_bookmarks.py")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn skill_wrapper_drives_live_bridge_reload_fts_query_and_clean_shutdown() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("workspace root");
    let wrapper_script = workspace_root
        .join(".agents")
        .join("skills")
        .join("qiaomu-markbridge-bookmarks")
        .join("scripts")
        .join("mb_bookmarks.py");
    assert!(
        wrapper_script.is_file(),
        "expected skill wrapper at {}",
        wrapper_script.display()
    );
    let bin_path = PathBuf::from(env!("CARGO_BIN_EXE_markbridge-skill"));

    let temp = tempfile::tempdir().unwrap();
    let app_data = temp.keep();
    let db_path = app_data.join("markbridge.sqlite");

    // 1. Open live desktop Bridge on an uninitialized database (stays in onboarding)
    let bridge = Bridge::open(&db_path, Arc::new(NoopCredentials))
        .await
        .unwrap();
    let mut rx = bridge.subscribe();
    assert!(rx.borrow().profiles.is_empty());

    // 2. External Python skill wrapper creates a folder + bookmark with tags & FTS5 note
    let mkdir_json = run_skill_wrapper(
        &wrapper_script,
        &bin_path,
        &app_data,
        &["mkdir", "--title", "架构精选"],
    );
    let folder_id = mkdir_json["result"]["node"]["chromeId"]
        .as_str()
        .expect("folder chromeId")
        .to_owned();

    let add_json = run_skill_wrapper(
        &wrapper_script,
        &bin_path,
        &app_data,
        &[
            "add",
            "--parent",
            &folder_id,
            "--title",
            "SQLite WAL Mode",
            "--url",
            "https://www.sqlite.org/wal.html",
            "--tags",
            "sqlite,architecture",
            "--note",
            "外部技能进程通过 WAL 实时写入测试",
            "--summary",
            "SQLite 预写式日志并发机制官方文档",
        ],
    );
    let bm_id = add_json["result"]["node"]["chromeId"]
        .as_str()
        .expect("bookmark chromeId")
        .to_owned();

    // 3. Bridge automatically detects external SQLite WAL commits and publishes Local profile
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        {
            let state = rx.borrow_and_update().clone();
            if let Some(local) = state
                .profiles
                .iter()
                .find(|p| p.profile_id.as_str() == "local-skills")
                && local.revision.get() >= 3
                && local.node_count.get() == 3
            {
                assert_eq!(local.connection, BridgeConnection::Local);
                break;
            }
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Bridge did not observe mb_bookmarks.py SQLite updates within 5s"
        );
        tokio::time::timeout_at(deadline, rx.changed())
            .await
            .expect("timed out waiting for live BridgeState update")
            .expect("BridgeState sender dropped");
    }

    // 4. Desktop Bridge immediately sees folder tree, bookmark detail, and FTS5 trigram note query
    let local_profile = Id::new("local-skills").unwrap();
    let tree = bridge
        .tree(local_profile.clone(), None, None)
        .await
        .unwrap();
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].children.len(), 1);
    assert_eq!(tree[0].children[0].node.title.as_str(), "架构精选");

    let page = bridge
        .query_library(
            local_profile,
            LibraryQuery {
                folder_id: RequiredNullable(None),
                folder_scope: FolderScope::All,
                query: Title::new("预写式日志").unwrap(),
                tag_ids: Vec::new(),
                include_summary: true,
                include_note: true,
                offset: Counter::new(0).unwrap(),
                limit: Counter::new(50).unwrap(),
                expected_revision: RequiredNullable(None),
                expected_source_epoch: RequiredNullable(None),
            },
        )
        .await
        .unwrap();
    assert_eq!(page.total.get(), 1);
    assert_eq!(page.items[0].chrome_id.as_str(), bm_id);

    // 5. Clean shutdown drops notify watcher and SQLite worker so directory deletes immediately
    drop(rx);
    bridge.shutdown().await.unwrap();
    drop(bridge);
    std::fs::remove_dir_all(&app_data).expect("isolated app-data deletes cleanly on Windows");
    assert!(!app_data.exists());
}
