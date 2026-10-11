#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use markbridge_core::bridge::{Bridge, CacheTreeNode, credentials::OsCredentialStore};
use markbridge_protocol::{
    ApplyResult, BookmarkNode, BridgeState, ChromeProfileList, ContentPreview, Counter, EditAction,
    EditDocument, EditPreview, ErrorCode, Id, LibraryCount, LibraryDetail, LibraryNodes,
    LibraryPage, LibrarySearch, MirrorTree, OperationList, PairingOffer, TagCatalog, TagCommand,
    TitleEncodingPreview,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

mod preview;
use preview::{clear_web_preview_session, open_web_preview, web_preview_action, web_preview_state};

fn trusted(window: &tauri::WebviewWindow) -> Result<(), ErrorCode> {
    if preview::caller_may_control(window.label()) {
        Ok(())
    } else {
        Err(ErrorCode::ReadOnly)
    }
}

#[tauri::command]
async fn get_bridge_state(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    Ok(bridge.state().await)
}
#[tauri::command]
async fn start_bridge(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    port: u16,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge.start(port).await
}
#[tauri::command]
async fn begin_pairing(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    display_name: String,
) -> Result<PairingOffer, ErrorCode> {
    trusted(&window)?;
    bridge.begin_pairing(display_name).await
}
#[tauri::command]
async fn confirm_pairing(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    instance_id: Id,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge.confirm_pairing(profile_id, instance_id).await
}
#[tauri::command]
async fn cancel_pairing(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge.cancel_pairing(profile_id).await
}
#[tauri::command]
async fn revoke_pairing(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge.revoke_pairing(profile_id).await
}
#[tauri::command]
async fn reconnect_profile(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge.reconnect_profile(profile_id).await
}
#[tauri::command]
async fn enumerate_chrome_user_data(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    user_data_path: String,
) -> Result<ChromeProfileList, ErrorCode> {
    trusted(&window)?;
    bridge.enumerate_chrome_user_data(user_data_path).await
}
#[tauri::command]
async fn attach_file_mirror(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    user_data_path: String,
    directory_key: String,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge
        .attach_file_mirror(user_data_path, directory_key)
        .await
}
#[tauri::command]
async fn rescan_file_mirrors(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge.rescan_file_mirrors().await
}
#[tauri::command]
async fn detach_file_mirror(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    mirror_source_id: Id,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge.detach_file_mirror(mirror_source_id).await
}
#[tauri::command]
async fn associate_file_mirror(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    mirror_source_id: Id,
    profile_id: Id,
) -> Result<BridgeState, ErrorCode> {
    trusted(&window)?;
    bridge
        .associate_file_mirror(mirror_source_id, profile_id)
        .await
}
#[tauri::command]
async fn get_mirror_tree(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    mirror_source_id: Id,
) -> Result<MirrorTree, ErrorCode> {
    trusted(&window)?;
    bridge.mirror_tree(mirror_source_id).await
}

fn flatten_cache(nodes: Vec<CacheTreeNode>) -> Vec<BookmarkNode> {
    let mut flat = Vec::new();
    fn walk(nodes: Vec<CacheTreeNode>, flat: &mut Vec<BookmarkNode>) {
        for node in nodes {
            let children = node.children;
            flat.push(node.node);
            walk(children, flat);
        }
    }
    walk(nodes, &mut flat);
    flat
}

fn library_count(count: markbridge_core::bridge::CacheCount) -> Result<LibraryCount, ErrorCode> {
    Ok(LibraryCount {
        folders: Counter::new(count.folders)?,
        bookmarks: Counter::new(count.bookmarks)?,
    })
}

/// http(s) only. Rejects userinfo so a bookmark cannot hand credentials to the shell.
fn validate_http_url(url: &str) -> Result<(), ErrorCode> {
    if url.len() > 16_384
        || url
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || matches!(c, '"' | '\'' | '`' | '\\'))
    {
        return Err(ErrorCode::InvalidMessage);
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or(ErrorCode::InvalidMessage)?;
    if rest.is_empty() || rest.starts_with('/') {
        return Err(ErrorCode::InvalidMessage);
    }
    let host = rest.split('/').next().unwrap_or("");
    if host.is_empty() || host.contains('@') {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(())
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_SUSPENDED: u32 = 0x0000_0004;

fn suspend_requested(value: Option<&str>) -> bool {
    value == Some("1")
}

fn open_http_creation_flags(suspend: bool) -> u32 {
    if suspend {
        CREATE_NO_WINDOW | CREATE_SUSPENDED
    } else {
        CREATE_NO_WINDOW
    }
}

fn absolute_pidfile(value: Option<&str>) -> Option<PathBuf> {
    let path = PathBuf::from(value?);
    path.is_absolute().then_some(path)
}

/// Hands an http(s) URL to `rundll32 url.dll,FileProtocolHandler`.
/// `MARKBRIDGE_OPEN_HTTP_SUSPEND=1` creates that process suspended and writes its pid
/// to an absolute `MARKBRIDGE_OPEN_HTTP_PIDFILE`, so acceptance can observe the handoff
/// and terminate it before `url.dll` runs.
fn open_http(url: &str) -> Result<(), ErrorCode> {
    validate_http_url(url)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let suspend = suspend_requested(
            std::env::var("MARKBRIDGE_OPEN_HTTP_SUSPEND")
                .ok()
                .as_deref(),
        );
        let mut child = std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(open_http_creation_flags(suspend))
            .spawn()
            .map_err(|_| ErrorCode::InvalidMessage)?;
        if suspend {
            let pid = child.id();
            let Some(path) = absolute_pidfile(
                std::env::var("MARKBRIDGE_OPEN_HTTP_PIDFILE")
                    .ok()
                    .as_deref(),
            ) else {
                let _ = child.kill();
                return Err(ErrorCode::InvalidMessage);
            };
            if std::fs::write(&path, pid.to_string()).is_err() {
                let _ = child.kill();
                return Err(ErrorCode::InvalidMessage);
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err(ErrorCode::ReadOnly)
    }
}

#[tauri::command]
async fn cache_tree(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    folder_id: Option<Id>,
    depth: Option<u64>,
) -> Result<LibraryNodes, ErrorCode> {
    trusted(&window)?;
    let nodes = bridge.tree(profile_id, folder_id, depth).await?;
    Ok(LibraryNodes {
        nodes: flatten_cache(nodes),
    })
}

#[tauri::command]
async fn cache_list(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    folder_id: Id,
    offset: u64,
    limit: u64,
) -> Result<LibraryPage, ErrorCode> {
    trusted(&window)?;
    let page = bridge.list(profile_id, folder_id, offset, limit).await?;
    Ok(LibraryPage {
        items: page.items,
        total: Counter::new(page.total)?,
    })
}

#[tauri::command]
async fn cache_search(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    query: String,
    folder_id: Option<Id>,
    limit: u64,
) -> Result<LibrarySearch, ErrorCode> {
    trusted(&window)?;
    if query.chars().count() > 4_096 {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(LibrarySearch {
        items: bridge.search(profile_id, &query, folder_id, limit).await?,
    })
}

#[tauri::command]
async fn cache_get(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    chrome_id: Id,
) -> Result<LibraryDetail, ErrorCode> {
    trusted(&window)?;
    let node = bridge.get(profile_id, chrome_id).await?;
    Ok(LibraryDetail {
        node: node.node,
        ancestors: node.ancestors,
    })
}

#[tauri::command]
async fn cache_count(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    folder_id: Option<Id>,
) -> Result<LibraryCount, ErrorCode> {
    trusted(&window)?;
    library_count(bridge.count(profile_id, folder_id).await?)
}

#[tauri::command]
async fn preview_edit(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    expected_revision: u64,
    action: EditAction,
) -> Result<EditPreview, ErrorCode> {
    trusted(&window)?;
    bridge
        .preview_edit(profile_id, expected_revision, action)
        .await
}

#[tauri::command]
async fn apply_edit(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    expected_revision: u64,
    action: EditAction,
    second_confirm: bool,
) -> Result<ApplyResult, ErrorCode> {
    trusted(&window)?;
    bridge
        .apply_edit(profile_id, expected_revision, action, second_confirm)
        .await
}

#[tauri::command]
async fn list_operations(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
) -> Result<OperationList, ErrorCode> {
    trusted(&window)?;
    bridge.list_operations(profile_id).await
}

#[tauri::command]
async fn review_operation(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    operation_id: Id,
) -> Result<OperationList, ErrorCode> {
    trusted(&window)?;
    bridge.review_operation(profile_id, operation_id).await
}

#[tauri::command]
async fn refresh_operations(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
) -> Result<OperationList, ErrorCode> {
    trusted(&window)?;
    bridge.refresh_operations(profile_id).await
}

#[tauri::command]
async fn export_html(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
) -> Result<EditDocument, ErrorCode> {
    trusted(&window)?;
    bridge.export_html(profile_id).await
}

#[tauri::command]
async fn export_sidecar(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
) -> Result<EditDocument, ErrorCode> {
    trusted(&window)?;
    bridge.export_sidecar(profile_id).await
}

#[tauri::command]
async fn tag_state(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    chrome_ids: Vec<Id>,
    filter_tag_id: Option<Id>,
) -> Result<TagCatalog, ErrorCode> {
    trusted(&window)?;
    bridge
        .tag_catalog(profile_id, chrome_ids, filter_tag_id)
        .await
}

#[tauri::command]
async fn tag_command(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    command: TagCommand,
) -> Result<TagCatalog, ErrorCode> {
    trusted(&window)?;
    bridge.mutate_tags(profile_id, command).await
}

#[tauri::command]
async fn preview_title_encoding(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    expected_revision: u64,
    chrome_ids: Vec<Id>,
    restore: bool,
) -> Result<TitleEncodingPreview, ErrorCode> {
    trusted(&window)?;
    bridge
        .preview_title_encoding(profile_id, expected_revision, chrome_ids, restore)
        .await
}

#[tauri::command]
async fn apply_title_encoding(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    expected_revision: u64,
    chrome_ids: Vec<Id>,
    restore: bool,
) -> Result<ApplyResult, ErrorCode> {
    trusted(&window)?;
    bridge
        .apply_title_encoding(profile_id, expected_revision, chrome_ids, restore)
        .await
}

#[tauri::command]
async fn content_preview(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    chrome_id: Id,
    request_id: Id,
) -> Result<ContentPreview, ErrorCode> {
    trusted(&window)?;
    bridge
        .content_preview(profile_id, chrome_id, request_id)
        .await
}

#[tauri::command]
async fn cancel_content_preview(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    request_id: Id,
) -> Result<(), ErrorCode> {
    trusted(&window)?;
    bridge.cancel_content_preview(request_id).await
}

#[tauri::command]
fn open_http_url(window: tauri::WebviewWindow, url: String) -> Result<(), ErrorCode> {
    trusted(&window)?;
    open_http(&url)
}

#[tauri::command]
fn get_startup_state(
    window: tauri::WebviewWindow,
) -> Result<markbridge_protocol::StartupState, &'static str> {
    if !preview::caller_may_control(window.label()) {
        return Err("UNTRUSTED_WINDOW");
    }
    Ok(markbridge_core::startup_state())
}

/// Daily pairing stays `Markbridge.Pairing`. An acceptance process may set
/// `MARKBRIDGE_CREDENTIAL_NAMESPACE` to `Markbridge.Task05.` or
/// `Markbridge.Task06.` plus a disposable id.
fn credential_namespace() -> Result<String, Box<dyn std::error::Error>> {
    match std::env::var("MARKBRIDGE_CREDENTIAL_NAMESPACE") {
        Err(std::env::VarError::NotPresent) => Ok("Markbridge.Pairing".to_owned()),
        Err(_) => Err("invalid acceptance credential namespace".into()),
        Ok(value) => {
            let suffix = value
                .strip_prefix("Markbridge.Task05.")
                .or_else(|| value.strip_prefix("Markbridge.Task06."))
                .filter(|suffix| !suffix.is_empty())
                .ok_or("invalid acceptance credential namespace")?;
            if suffix.len() > 80
                || !suffix
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            {
                return Err("invalid acceptance credential namespace".into());
            }
            Ok(value)
        }
    }
}

fn database_directory(app: &tauri::App) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let directory = match std::env::var_os("MARKBRIDGE_APP_DATA") {
        Some(value) => {
            let directory = std::path::PathBuf::from(value);
            if !directory.is_absolute() {
                return Err("invalid acceptance data directory".into());
            }
            directory
        }
        None => app.path().app_data_dir()?,
    };
    std::fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let directory = database_directory(app)?;
            app.manage(preview::PreviewHost::new(directory.clone())?);
            let namespace = credential_namespace()?;
            let bridge = tauri::async_runtime::block_on(Bridge::open(
                directory.join("markbridge.sqlite"),
                Arc::new(OsCredentialStore::new(namespace)),
            ))?;
            let mut states = bridge.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while states.changed().await.is_ok() {
                    let state = states.borrow_and_update().clone();
                    let _ = handle.emit_to("main", "bridge-state", state);
                }
            });
            app.manage(bridge);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_state,
            get_bridge_state,
            start_bridge,
            begin_pairing,
            confirm_pairing,
            cancel_pairing,
            revoke_pairing,
            reconnect_profile,
            enumerate_chrome_user_data,
            attach_file_mirror,
            rescan_file_mirrors,
            detach_file_mirror,
            associate_file_mirror,
            get_mirror_tree,
            cache_tree,
            cache_list,
            cache_search,
            cache_get,
            cache_count,
            preview_edit,
            apply_edit,
            list_operations,
            review_operation,
            refresh_operations,
            export_html,
            export_sidecar,
            tag_state,
            tag_command,
            preview_title_encoding,
            apply_title_encoding,
            content_preview,
            cancel_content_preview,
            open_http_url,
            open_web_preview,
            web_preview_action,
            clear_web_preview_session,
            web_preview_state
        ])
        .build(tauri::generate_context!());
    let Ok(app) = app else {
        eprintln!("STARTUP_FAILED: Unable to start Markbridge.");
        std::process::exit(1);
    };
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Resumed)
            && let Some(bridge) = app.try_state::<Bridge>()
        {
            let bridge = Bridge::clone(&bridge);
            tauri::async_runtime::spawn(async move {
                let _ = bridge.rescan_file_mirrors().await;
            });
        }
        if matches!(event, tauri::RunEvent::Exit) {
            let bridge = app.state::<Bridge>();
            if tauri::async_runtime::block_on(bridge.shutdown()).is_err() {
                eprintln!("SHUTDOWN_FAILED");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        CREATE_NO_WINDOW, CREATE_SUSPENDED, absolute_pidfile, credential_namespace, flatten_cache,
        open_http_creation_flags, suspend_requested, validate_http_url,
    };

    #[test]
    fn acceptance_namespace_never_selects_the_daily_store() {
        let previous = std::env::var("MARKBRIDGE_CREDENTIAL_NAMESPACE").ok();
        unsafe { std::env::remove_var("MARKBRIDGE_CREDENTIAL_NAMESPACE") };
        assert_eq!(credential_namespace().unwrap(), "Markbridge.Pairing");
        unsafe { std::env::set_var("MARKBRIDGE_CREDENTIAL_NAMESPACE", "Markbridge.Pairing") };
        assert!(credential_namespace().is_err());
        unsafe {
            std::env::set_var(
                "MARKBRIDGE_CREDENTIAL_NAMESPACE",
                "Markbridge.Task05.abc-123",
            )
        };
        assert_eq!(credential_namespace().unwrap(), "Markbridge.Task05.abc-123");
        unsafe {
            std::env::set_var(
                "MARKBRIDGE_CREDENTIAL_NAMESPACE",
                "Markbridge.Task06.abc-123",
            )
        };
        assert_eq!(credential_namespace().unwrap(), "Markbridge.Task06.abc-123");
        unsafe { std::env::set_var("MARKBRIDGE_CREDENTIAL_NAMESPACE", "Markbridge.Task03.abc") };
        assert!(credential_namespace().is_err());
        match previous {
            Some(value) => unsafe {
                std::env::set_var("MARKBRIDGE_CREDENTIAL_NAMESPACE", value);
            },
            None => unsafe { std::env::remove_var("MARKBRIDGE_CREDENTIAL_NAMESPACE") },
        }
    }

    use markbridge_core::bridge::CacheTreeNode;
    use markbridge_protocol::{BookmarkNode, ErrorCode, Id, NodeKind, Position, Title};

    fn folder(id: &str, parent: Option<&str>, title: &str) -> BookmarkNode {
        BookmarkNode {
            chrome_id: Id::new(id).unwrap(),
            parent_id: parent.map(|value| Id::new(value).unwrap()),
            position: Position::new(0).unwrap(),
            kind: NodeKind::Folder,
            title: Title::new(title).unwrap(),
            url: None,
            folder_type: None,
            unmodifiable: None,
            date_added: None,
            date_last_used: None,
        }
    }

    #[test]
    fn flatten_keeps_parent_before_children() {
        let child = CacheTreeNode {
            node: folder("bar", Some("root"), "栏"),
            children: vec![],
        };
        let root = CacheTreeNode {
            node: folder("root", None, "根"),
            children: vec![child],
        };
        let flat = flatten_cache(vec![root]);
        assert_eq!(flat[0].chrome_id.as_str(), "root");
        assert_eq!(flat[1].chrome_id.as_str(), "bar");
        assert_eq!(flat[1].parent_id.as_ref().unwrap().as_str(), "root");
    }

    #[test]
    fn suspended_handoff_is_opt_in_and_uses_an_absolute_pidfile() {
        assert!(!suspend_requested(None));
        assert!(!suspend_requested(Some("")));
        assert!(!suspend_requested(Some("true")));
        assert!(suspend_requested(Some("1")));
        assert_eq!(open_http_creation_flags(false), CREATE_NO_WINDOW);
        assert_eq!(
            open_http_creation_flags(true),
            CREATE_NO_WINDOW | CREATE_SUSPENDED
        );
        assert!(absolute_pidfile(None).is_none());
        assert!(absolute_pidfile(Some("open-http.pid")).is_none());
        let absolute = std::env::temp_dir().join("mb09-open-http.pid");
        assert_eq!(
            absolute_pidfile(Some(absolute.to_str().unwrap())),
            Some(absolute)
        );
    }

    #[cfg(windows)]
    #[test]
    fn suspended_command_line_stays_readable_until_killed() {
        use std::os::windows::process::CommandExt;
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/c", "exit"])
            .creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED)
            .spawn()
            .expect("spawn");
        let pid = child.id();
        let output = std::process::Command::new("pwsh")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\"; if ($p) {{ $p.CommandLine }} else {{ 'MISSING' }}"
                ),
            ])
            .output();
        let _ = child.kill();
        let _ = child.wait();
        let output = output.expect("query");
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(
            text.to_ascii_lowercase().contains("cmd.exe") && text.contains("/c"),
            "command line was not readable"
        );
    }

    #[test]
    fn http_open_rejects_non_http_and_userinfo() {
        assert!(validate_http_url("https://example.com/a").is_ok());
        assert!(validate_http_url("http://example.com/a?q=1").is_ok());
        assert_eq!(
            validate_http_url("javascript:alert(1)"),
            Err(ErrorCode::InvalidMessage)
        );
        assert_eq!(
            validate_http_url("file:///C:/Windows"),
            Err(ErrorCode::InvalidMessage)
        );
        assert_eq!(
            validate_http_url("https://user:secret@example.com"),
            Err(ErrorCode::InvalidMessage)
        );
        assert_eq!(
            validate_http_url("https://"),
            Err(ErrorCode::InvalidMessage)
        );
        assert_eq!(
            validate_http_url("https://example.com/a b"),
            Err(ErrorCode::InvalidMessage)
        );
    }

    #[test]
    fn b10k_file_uses_the_read_only_mirror_parser() {
        let dir = std::env::temp_dir().join(format!(
            "mb05-b10k-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let script = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src/features/library/write-b10k.mjs");
        let wrote = std::process::Command::new("node")
            .arg("--experimental-strip-types")
            .arg(&script)
            .arg(&dir)
            .status()
            .expect("node");
        assert!(wrote.success(), "b10k writer failed");
        let bytes = std::fs::read(dir.join("Default").join("Bookmarks")).expect("bookmarks file");
        let parsed = markbridge_core::mirror::parse_bookmarks(&bytes);
        let _ = std::fs::remove_dir_all(&dir);
        let nodes = parsed.expect("mirror parse");
        assert_eq!(nodes.len(), 11_004);
        let bookmarks = nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Bookmark)
            .count();
        let folders = nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Folder)
            .count();
        assert_eq!(bookmarks, 10_000);
        assert_eq!(folders, 1_004);
        let parents: std::collections::HashMap<&str, &str> = nodes
            .iter()
            .filter_map(|node| {
                node.parent_id
                    .as_ref()
                    .map(|parent| (node.chrome_id.as_str(), parent.as_str()))
            })
            .collect();
        let mut max_depth = 0;
        for node in &nodes {
            let mut depth = 0;
            let mut current = node.chrome_id.as_str();
            while current != "0" {
                depth += 1;
                current = parents.get(current).copied().unwrap_or("0");
                if depth > 64 {
                    break;
                }
            }
            max_depth = max_depth.max(depth);
        }
        assert_eq!(max_depth, 20);
        let marker = "https://example.com/mb05-mark";
        let duplicate = "https://example.com/dup";
        assert_eq!(
            nodes
                .iter()
                .filter(|node| node.url.as_ref().is_some_and(|url| url.as_str() == marker))
                .count(),
            2
        );
        let duplicate_ids: std::collections::HashSet<&str> = nodes
            .iter()
            .filter(|node| {
                node.url
                    .as_ref()
                    .is_some_and(|url| url.as_str() == duplicate)
            })
            .map(|node| node.chrome_id.as_str())
            .collect();
        assert_eq!(duplicate_ids.len(), 1_000);
        assert_eq!(
            nodes
                .iter()
                .filter(|node| node.title.as_str() == "MB05MARK")
                .count(),
            1
        );
        assert!(nodes.iter().any(|node| node.title.as_str().contains('|')));
        assert!(
            nodes
                .iter()
                .any(|node| node.title.as_str().contains("中文"))
        );
        assert!(
            nodes
                .iter()
                .any(|node| node.title.as_str().chars().count() > 200)
        );
    }
}
