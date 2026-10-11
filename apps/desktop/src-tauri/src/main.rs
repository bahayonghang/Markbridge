#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use markbridge_core::bridge::{Bridge, CacheTreeNode, credentials::OsCredentialStore};
use markbridge_protocol::{
    BookmarkNode, BridgeState, ChromeProfileList, Counter, ErrorCode, Id, LibraryCount,
    LibraryDetail, LibraryNodes, LibraryPage, LibrarySearch, MirrorTree, PairingOffer,
};
use std::sync::Arc;
use tauri::{Emitter, Manager};

fn trusted(window: &tauri::WebviewWindow) -> Result<(), ErrorCode> {
    if window.label() == "main" {
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

fn open_http(url: &str) -> Result<(), ErrorCode> {
    validate_http_url(url)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|_| ErrorCode::InvalidMessage)?;
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
fn open_http_url(window: tauri::WebviewWindow, url: String) -> Result<(), ErrorCode> {
    trusted(&window)?;
    open_http(&url)
}

#[tauri::command]
fn get_startup_state(
    window: tauri::WebviewWindow,
) -> Result<markbridge_protocol::StartupState, &'static str> {
    if window.label() != "main" {
        return Err("UNTRUSTED_WINDOW");
    }
    Ok(markbridge_core::startup_state())
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
            let bridge = tauri::async_runtime::block_on(Bridge::open(
                directory.join("markbridge.sqlite"),
                Arc::new(OsCredentialStore::new("Markbridge.Pairing")),
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
            open_http_url
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
    use super::{flatten_cache, validate_http_url};
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
