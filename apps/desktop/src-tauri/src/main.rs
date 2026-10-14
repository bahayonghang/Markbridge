#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use markbridge_core::bridge::{Bridge, CacheTreeNode, credentials::OsCredentialStore};
use markbridge_protocol::{
    AiApplyResult, AiConnection, AiDraft, AiSettings, AiSuggestion, ApplyResult, BookmarkNode,
    BridgeState, ChromeProfileList, ContentPreview, Counter, EditAction, EditDocument, EditPreview,
    ErrorCode, Id, LibraryCount, LibraryDetail, LibraryNodes, LibraryPage, LibrarySearch,
    MaintenanceReport, MirrorTree, OperationList, OrganizationFolder, OrganizationPlan,
    PairingOffer, SourceEpoch, TagCatalog, TagCommand, TextSearchPage, TitleEncodingPreview,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

mod export;
mod preview;
use preview::{clear_web_preview_session, open_web_preview, web_preview_action, web_preview_state};

fn trusted(window: &tauri::WebviewWindow) -> Result<(), ErrorCode> {
    if preview::caller_may_control(window.label()) {
        Ok(())
    } else {
        Err(ErrorCode::ReadOnly)
    }
}

use markbridge_protocol::{
    SemanticConfig, SemanticModelCheck, SemanticQuery, SemanticQueryResult, SemanticScope,
    SemanticScopeReview, SemanticSettings, SemanticStatus,
};

#[tauri::command]
async fn semantic_settings(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<SemanticSettings, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_settings().await
}
#[tauri::command]
async fn save_semantic_config(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    config: SemanticConfig,
) -> Result<SemanticSettings, ErrorCode> {
    trusted(&window)?;
    bridge.save_semantic_config(config).await
}
#[tauri::command]
async fn semantic_model_check(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    endpoint: String,
    model: String,
) -> Result<SemanticModelCheck, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_model_check(endpoint, model).await
}
#[tauri::command]
async fn semantic_review_scope(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    scope: SemanticScope,
) -> Result<SemanticScopeReview, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_review_scope(scope).await
}
#[tauri::command]
async fn semantic_start_index(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    review_id: Id,
) -> Result<SemanticStatus, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_start_index(review_id).await
}
#[tauri::command]
async fn semantic_status(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    source_epoch: SourceEpoch,
) -> Result<SemanticStatus, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_status(profile_id, source_epoch).await
}
#[tauri::command]
async fn semantic_pause(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    source_epoch: SourceEpoch,
) -> Result<SemanticStatus, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_pause(profile_id, source_epoch).await
}
#[tauri::command]
async fn semantic_resume(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    source_epoch: SourceEpoch,
) -> Result<SemanticStatus, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_resume(profile_id, source_epoch).await
}
#[tauri::command]
async fn semantic_delete_index(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    source_epoch: SourceEpoch,
) -> Result<SemanticStatus, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_delete_index(profile_id, source_epoch).await
}
#[tauri::command]
async fn semantic_query(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    query: SemanticQuery,
) -> Result<SemanticQueryResult, ErrorCode> {
    trusted(&window)?;
    bridge.semantic_query(query).await
}
#[tauri::command]
async fn semantic_cancel_query(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    request_id: Id,
) -> Result<(), ErrorCode> {
    trusted(&window)?;
    bridge.semantic_cancel_query(profile_id, request_id).await
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

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_SUSPENDED: u32 = 0x0000_0004;

#[cfg(windows)]
fn suspend_requested(value: Option<&str>) -> bool {
    value == Some("1")
}

#[cfg(windows)]
fn open_http_creation_flags(suspend: bool) -> u32 {
    if suspend {
        CREATE_NO_WINDOW | CREATE_SUSPENDED
    } else {
        CREATE_NO_WINDOW
    }
}

#[cfg(windows)]
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
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let mut child = posix_open_command(std::env::consts::OS, url)?
            .spawn()
            .map_err(|_| ErrorCode::InvalidMessage)?;
        tauri::async_runtime::spawn_blocking(move || {
            let _ = child.wait();
        });
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = url;
        Err(ErrorCode::ReadOnly)
    }
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn posix_open_command(platform: &str, url: &str) -> Result<std::process::Command, ErrorCode> {
    validate_http_url(url)?;
    let mut command = match platform {
        "macos" => {
            let mut command = std::process::Command::new("/usr/bin/open");
            command.arg("--");
            command
        }
        "linux" => std::process::Command::new("xdg-open"),
        _ => return Err(ErrorCode::ReadOnly),
    };
    command.arg(url);
    Ok(command)
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
async fn cache_query(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    request: markbridge_protocol::LibraryQuery,
) -> Result<markbridge_protocol::LibraryQueryPage, ErrorCode> {
    trusted(&window)?;
    bridge.query_library(profile_id, request).await
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
async fn preview_batch_edit(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    expected_revision: u64,
    chrome_ids: Vec<Id>,
    action: markbridge_protocol::BatchEditAction,
) -> Result<markbridge_protocol::BatchEditPreview, ErrorCode> {
    trusted(&window)?;
    bridge
        .preview_batch_edit(profile_id, expected_revision, chrome_ids, action)
        .await
}
#[tauri::command]
async fn apply_batch_edit(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    plan_id: Id,
    plan_hash: Id,
    second_confirm: bool,
) -> Result<markbridge_protocol::BatchEditStatus, ErrorCode> {
    trusted(&window)?;
    bridge
        .apply_batch_edit(profile_id, plan_id, plan_hash, second_confirm)
        .await
}
#[tauri::command]
async fn get_batch_edit(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    operation_id: Id,
) -> Result<markbridge_protocol::BatchEditStatus, ErrorCode> {
    trusted(&window)?;
    bridge.get_batch_edit(profile_id, operation_id).await
}
#[tauri::command]
async fn cancel_batch_edit(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    operation_id: Id,
) -> Result<markbridge_protocol::BatchEditStatus, ErrorCode> {
    trusted(&window)?;
    bridge.cancel_batch_edit(profile_id, operation_id).await
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
async fn operation_detail(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    operation_id: Id,
) -> Result<markbridge_protocol::OperationDetail, ErrorCode> {
    trusted(&window)?;
    bridge.operation_detail(profile_id, operation_id).await
}

#[tauri::command]
async fn preview_undo(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    operation_id: Id,
    expected_revision: u64,
) -> Result<markbridge_protocol::UndoPreview, ErrorCode> {
    trusted(&window)?;
    bridge
        .preview_undo(profile_id, operation_id, expected_revision)
        .await
}

#[tauri::command]
async fn save_export(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    source: markbridge_protocol::ExportSource,
    format: markbridge_protocol::EditDocumentKind,
) -> Result<markbridge_protocol::ExportSaveResult, ErrorCode> {
    trusted(&window)?;
    let _guard = export::SaveGuard::acquire()?;
    match bridge.export_snapshot(source, format).await {
        Ok(snapshot) => Ok(export::save(&window, snapshot).await),
        Err(error) => Ok(markbridge_protocol::ExportSaveResult {
            status: markbridge_protocol::ExportSaveStatus::Failed,
            metadata: markbridge_protocol::RequiredNullable(None),
            error_code: markbridge_protocol::RequiredNullable(Some(error)),
        }),
    }
}

#[tauri::command]
async fn save_diagnostics(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<markbridge_protocol::DiagnosticSaveResult, ErrorCode> {
    trusted(&window)?;
    let _guard = export::SaveGuard::acquire()?;
    let state = bridge.subscribe().borrow().clone();
    Ok(export::save_diagnostic(&window, markbridge_core::diagnostics::report(&state)).await)
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
    expected_source_epoch: Option<SourceEpoch>,
) -> Result<TagCatalog, ErrorCode> {
    trusted(&window)?;
    bridge
        .tag_catalog_at_epoch(profile_id, chrome_ids, filter_tag_id, expected_source_epoch)
        .await
}

#[tauri::command]
async fn tag_command(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    command: TagCommand,
    expected_source_epoch: Option<SourceEpoch>,
) -> Result<TagCatalog, ErrorCode> {
    trusted(&window)?;
    bridge
        .mutate_tags_at_epoch(profile_id, command, expected_source_epoch)
        .await
}

#[tauri::command]
async fn preview_title_encoding(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    expected_revision: u64,
    chrome_ids: Vec<Id>,
    restore: bool,
    expected_source_epoch: Option<SourceEpoch>,
) -> Result<TitleEncodingPreview, ErrorCode> {
    trusted(&window)?;
    bridge
        .preview_title_encoding_at_epoch(
            profile_id,
            expected_revision,
            chrome_ids,
            restore,
            expected_source_epoch,
        )
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
    expected_source_epoch: Option<SourceEpoch>,
) -> Result<ApplyResult, ErrorCode> {
    trusted(&window)?;
    bridge
        .apply_title_encoding_at_epoch(
            profile_id,
            expected_revision,
            chrome_ids,
            restore,
            expected_source_epoch,
        )
        .await
}

#[tauri::command]
async fn ai_settings(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<AiSettings, ErrorCode> {
    trusted(&window)?;
    bridge.ai_settings().await
}

#[tauri::command]
async fn save_ai_config(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    enabled: bool,
    provider: String,
    base_url: String,
    model: String,
) -> Result<AiSettings, ErrorCode> {
    trusted(&window)?;
    bridge
        .save_ai_config(enabled, provider, base_url, model)
        .await
}

#[tauri::command]
async fn set_ai_credential(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    secret: String,
) -> Result<AiSettings, ErrorCode> {
    trusted(&window)?;
    bridge.set_ai_credential(secret).await
}

#[tauri::command]
async fn clear_ai_credential(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<AiSettings, ErrorCode> {
    trusted(&window)?;
    bridge.clear_ai_credential().await
}

#[tauri::command]
async fn test_ai_connection(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
) -> Result<AiConnection, ErrorCode> {
    trusted(&window)?;
    bridge.test_ai_connection().await
}

#[tauri::command]
async fn suggest_ai(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    chrome_id: Id,
    request_id: Id,
) -> Result<AiSuggestion, ErrorCode> {
    trusted(&window)?;
    bridge.suggest_ai(profile_id, chrome_id, request_id).await
}

#[tauri::command]
async fn cancel_ai(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    request_id: Id,
) -> Result<(), ErrorCode> {
    trusted(&window)?;
    bridge.cancel_ai(request_id).await
}

#[tauri::command]
async fn propose_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    chrome_ids: Vec<Id>,
    request_id: Option<Id>,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge
        .propose_organization_with_request(profile_id, chrome_ids, request_id)
        .await
}

#[tauri::command]
async fn review_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
    folders: Vec<OrganizationFolder>,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge.review_organization(job_id, folders).await
}

#[tauri::command]
async fn assign_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge.assign_organization(job_id).await
}

#[tauri::command]
async fn edit_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
    chrome_id: Id,
    target_folder_id: Id,
    rejected: bool,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge
        .edit_organization(job_id, chrome_id, target_folder_id, rejected)
        .await
}

#[tauri::command]
async fn apply_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
    plan_hash: Id,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge.apply_organization(job_id, plan_hash).await
}

#[tauri::command]
async fn pause_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge.pause_organization(job_id).await
}

#[tauri::command]
async fn cancel_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge.cancel_organization(job_id).await
}

#[tauri::command]
async fn cleanup_organization(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
    confirm: bool,
    second_confirm: bool,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge
        .cleanup_organization(job_id, confirm, second_confirm)
        .await
}

#[tauri::command]
async fn organization_plan(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    job_id: Id,
) -> Result<OrganizationPlan, ErrorCode> {
    trusted(&window)?;
    bridge.organization_plan(job_id).await
}

#[tauri::command]
async fn apply_ai(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    draft: AiDraft,
) -> Result<AiApplyResult, ErrorCode> {
    trusted(&window)?;
    bridge.apply_ai(draft).await
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
async fn inspect_library(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    chrome_ids: Vec<Id>,
) -> Result<MaintenanceReport, ErrorCode> {
    trusted(&window)?;
    bridge.inspect_library(profile_id, chrome_ids).await
}

#[tauri::command]
async fn check_links(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    chrome_ids: Vec<Id>,
    request_id: Id,
) -> Result<MaintenanceReport, ErrorCode> {
    trusted(&window)?;
    bridge.check_links(profile_id, chrome_ids, request_id).await
}

#[tauri::command]
async fn cancel_link_check(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    request_id: Id,
) -> Result<(), ErrorCode> {
    trusted(&window)?;
    bridge.cancel_link_check(request_id).await
}

#[tauri::command]
async fn preview_cleanup(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    expected_revision: u64,
    chrome_ids: Vec<Id>,
    keeper_chrome_id: Id,
) -> Result<MaintenanceReport, ErrorCode> {
    trusted(&window)?;
    bridge
        .preview_cleanup(profile_id, expected_revision, chrome_ids, keeper_chrome_id)
        .await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfirmCleanupArgs {
    profile_id: Id,
    expected_revision: u64,
    chrome_ids: Vec<Id>,
    keeper_chrome_id: Id,
    confirm: bool,
    second_confirm: bool,
}

#[tauri::command]
async fn confirm_cleanup(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    args: ConfirmCleanupArgs,
) -> Result<MaintenanceReport, ErrorCode> {
    trusted(&window)?;
    let ConfirmCleanupArgs {
        profile_id,
        expected_revision,
        chrome_ids,
        keeper_chrome_id,
        confirm,
        second_confirm,
    } = args;
    bridge
        .confirm_cleanup(
            profile_id,
            expected_revision,
            chrome_ids,
            keeper_chrome_id,
            confirm,
            second_confirm,
        )
        .await
}

#[tauri::command]
async fn search_library_text(
    window: tauri::WebviewWindow,
    bridge: tauri::State<'_, Bridge>,
    profile_id: Id,
    query: String,
) -> Result<TextSearchPage, ErrorCode> {
    trusted(&window)?;
    bridge.search_text(profile_id, query).await
}

#[tauri::command]
fn open_http_url(window: tauri::WebviewWindow, url: String) -> Result<(), ErrorCode> {
    trusted(&window)?;
    open_http(&url)
}

/// Opened local storage. The flag has no error text.
struct StorageReady(bool);

fn startup_response(ready: bool) -> Result<markbridge_protocol::StartupState, &'static str> {
    if ready {
        Ok(markbridge_core::startup_state())
    } else {
        Err("STARTUP_UNAVAILABLE")
    }
}

#[tauri::command]
fn get_startup_state(
    window: tauri::WebviewWindow,
    storage: tauri::State<'_, StorageReady>,
) -> Result<markbridge_protocol::StartupState, &'static str> {
    if !preview::caller_may_control(window.label()) {
        return Err("UNTRUSTED_WINDOW");
    }
    startup_response(storage.0)
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

fn configure_data_directory(
    config: &mut tauri::Config,
    directory: Option<PathBuf>,
) -> Result<Option<PathBuf>, &'static str> {
    if directory
        .as_ref()
        .is_some_and(|directory| !directory.is_absolute())
    {
        return Err("invalid acceptance data directory");
    }
    if directory.is_some() || cfg!(any(target_os = "macos", target_os = "linux")) {
        // Config conversion drops data_directory in this SDK. Build main explicitly in setup.
        let main = config
            .app
            .windows
            .iter_mut()
            .find(|window| window.label == "main")
            .ok_or("missing main window configuration")?;
        main.create = false;
    }
    Ok(directory)
}

fn database_directory(
    app: &tauri::App,
    override_directory: Option<PathBuf>,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let directory = match override_directory {
        Some(directory) => directory,
        None => app.path().app_data_dir()?,
    };
    std::fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn on_run_event(event: &tauri::RunEvent, bridge: Option<&Bridge>) {
    if matches!(event, tauri::RunEvent::Resumed)
        && let Some(bridge) = bridge
    {
        let bridge = Bridge::clone(bridge);
        tauri::async_runtime::spawn(async move {
            let _ = bridge.rescan_file_mirrors().await;
        });
    }
    if matches!(event, tauri::RunEvent::Exit)
        && let Some(bridge) = bridge
        && tauri::async_runtime::block_on(bridge.shutdown()).is_err()
    {
        eprintln!("SHUTDOWN_FAILED");
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    if preview::ensure_native_store_supported().is_err() {
        eprintln!("STARTUP_FAILED: Unable to start Markbridge.");
        std::process::exit(1);
    }
    let mut context = tauri::generate_context!();
    let Ok(override_directory) = configure_data_directory(
        context.config_mut(),
        std::env::var_os("MARKBRIDGE_APP_DATA").map(PathBuf::from),
    ) else {
        eprintln!("STARTUP_FAILED: Unable to start Markbridge.");
        std::process::exit(1);
    };
    let app = tauri::Builder::default()
        .setup(move |app| {
            let directory = database_directory(app, override_directory.clone())?;
            app.manage(preview::PreviewHost::new(directory.clone())?);
            let namespace = credential_namespace()?;
            // A failed open must leave the window up. Do not forward the cause.
            let storage_ready = match tauri::async_runtime::block_on(Bridge::open_with_model_store(
                directory.join("markbridge.sqlite"),
                Arc::new(OsCredentialStore::new(namespace)),
                Arc::new(OsCredentialStore::new(
                    markbridge_core::ai::MODEL_CREDENTIAL_SERVICE.to_owned(),
                )),
            )) {
                Ok(bridge) => {
                    let mut states = bridge.subscribe();
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        while states.changed().await.is_ok() {
                            let state = states.borrow_and_update().clone();
                            let _ = handle.emit_to("main", "bridge-state", state);
                        }
                    });
                    app.manage(bridge);
                    true
                }
                Err(_) => false,
            };
            app.manage(StorageReady(storage_ready));
            if override_directory.is_some() || cfg!(any(target_os = "macos", target_os = "linux")) {
                let main = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "main")
                    .ok_or("missing main window configuration")?;
                // An explicit per-webview directory keeps preview Profile sessions separate.
                let builder = tauri::WebviewWindowBuilder::from_config(app, main)?
                    .data_directory(directory.join("main-webview"));
                #[cfg(target_os = "macos")]
                let builder = builder.data_store_identifier(preview::native_store_identifier(
                    &directory, "main", None,
                )?);
                builder.build()?;
            }
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
            cache_query,
            cache_get,
            cache_count,
            preview_batch_edit,
            apply_batch_edit,
            get_batch_edit,
            cancel_batch_edit,
            preview_edit,
            apply_edit,
            list_operations,
            operation_detail,
            preview_undo,
            save_export,
            save_diagnostics,
            review_operation,
            refresh_operations,
            export_html,
            export_sidecar,
            tag_state,
            tag_command,
            preview_title_encoding,
            apply_title_encoding,
            ai_settings,
            save_ai_config,
            semantic_settings,
            save_semantic_config,
            semantic_model_check,
            semantic_review_scope,
            semantic_start_index,
            semantic_status,
            semantic_pause,
            semantic_resume,
            semantic_delete_index,
            semantic_query,
            semantic_cancel_query,
            set_ai_credential,
            clear_ai_credential,
            test_ai_connection,
            suggest_ai,
            cancel_ai,
            apply_ai,
            propose_organization,
            review_organization,
            assign_organization,
            edit_organization,
            apply_organization,
            pause_organization,
            cancel_organization,
            cleanup_organization,
            organization_plan,
            content_preview,
            cancel_content_preview,
            inspect_library,
            check_links,
            cancel_link_check,
            preview_cleanup,
            confirm_cleanup,
            search_library_text,
            open_http_url,
            open_web_preview,
            web_preview_action,
            clear_web_preview_session,
            web_preview_state
        ])
        .build(context);
    let Ok(app) = app else {
        eprintln!("STARTUP_FAILED: Unable to start Markbridge.");
        std::process::exit(1);
    };
    app.run(|app, event| {
        let bridge = app.try_state::<Bridge>();
        on_run_event(&event, bridge.as_deref());
    });
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::{
        CREATE_NO_WINDOW, CREATE_SUSPENDED, absolute_pidfile, open_http_creation_flags,
        suspend_requested,
    };
    use super::{credential_namespace, flatten_cache, startup_response, validate_http_url};

    #[test]
    fn acceptance_override_disables_automatic_main_creation_before_sdk_conversion() {
        let mut config = tauri::Config::default();
        config.app.windows = vec![tauri::utils::config::WindowConfig {
            label: "main".into(),
            ..Default::default()
        }];
        let isolated = std::env::temp_dir().join("mb-main-config-regression");
        super::configure_data_directory(&mut config, Some(isolated)).unwrap();
        assert!(
            !config.app.windows[0].create,
            "automatic from_config creation drops the isolation override"
        );
    }

    #[test]
    fn sdk_config_conversion_drops_data_directory_but_explicit_attributes_retain_it() {
        use tauri_runtime::webview::WebviewAttributes;
        let isolated = std::env::temp_dir().join("mb-main-sdk-regression");
        let config = tauri::utils::config::WindowConfig {
            label: "main".into(),
            data_directory: Some(isolated.clone()),
            ..Default::default()
        };
        // The actual installed SDK conversion explains why config-only tests passed.
        assert!(WebviewAttributes::from(&config).data_directory.is_none());
        assert_eq!(
            WebviewAttributes::from(&config)
                .data_directory(isolated.clone())
                .data_directory,
            Some(isolated)
        );
    }

    #[test]
    fn acceptance_data_directory_isolates_only_the_main_webview() {
        let mut config = tauri::Config::default();
        let preview_dir = std::env::temp_dir().join("mb-preview-config-test");
        config.app.windows = vec![
            tauri::utils::config::WindowConfig {
                label: "preview-active".into(),
                data_directory: Some(preview_dir.clone()),
                ..Default::default()
            },
            tauri::utils::config::WindowConfig {
                label: "main".into(),
                ..Default::default()
            },
        ];
        let original_main = serde_json::to_value(&config.app.windows[1]).unwrap();
        assert_eq!(super::configure_data_directory(&mut config, None), Ok(None));
        assert!(config.app.windows[1].data_directory.is_none());
        let expected_automatic = !cfg!(any(target_os = "macos", target_os = "linux"));
        assert_eq!(config.app.windows[1].create, expected_automatic);
        assert!(super::configure_data_directory(&mut config, Some("relative".into())).is_err());
        assert!(config.app.windows[1].data_directory.is_none());
        assert_eq!(config.app.windows[1].create, expected_automatic);
        let isolated = std::env::temp_dir().join("mb-main-config-test");
        assert_eq!(
            super::configure_data_directory(&mut config, Some(isolated.clone())),
            Ok(Some(isolated.clone()))
        );
        assert_eq!(config.app.windows[0].data_directory, Some(preview_dir));
        assert!(config.app.windows[0].create);
        assert!(!config.app.windows[1].create);
        assert!(config.app.windows[1].data_directory.is_none());
        let mut isolated_main = config.app.windows[1].clone();
        isolated_main.create = true;
        assert_eq!(serde_json::to_value(isolated_main).unwrap(), original_main);
    }

    #[test]
    fn acceptance_override_requires_the_main_configuration_before_runtime_build() {
        let mut config = tauri::Config::default();
        config.app.windows.clear();
        assert!(
            super::configure_data_directory(
                &mut config,
                Some(std::env::temp_dir().join("mb-missing-main-config"))
            )
            .is_err()
        );
    }

    #[test]
    fn storage_open_failure_does_not_return_the_open_error() {
        let failed = startup_response(false).unwrap_err();
        assert_eq!(failed, "STARTUP_UNAVAILABLE");
        for token in ["STORAGE_NEWER_SCHEMA", "STORAGE_ERROR", "sqlite", "\\", "/"] {
            assert!(!failed.contains(token), "{token}");
        }
        let ready = startup_response(true).unwrap();
        assert_eq!(ready.protocol_version, 1);
        assert_eq!(
            ready.state,
            markbridge_protocol::StartupConnection::Unpaired
        );
    }

    #[test]
    fn acceptance_namespace_never_selects_the_daily_store() {
        let previous = std::env::var("MARKBRIDGE_CREDENTIAL_NAMESPACE").ok();
        unsafe { std::env::remove_var("MARKBRIDGE_CREDENTIAL_NAMESPACE") };
        assert_ne!(
            markbridge_core::ai::MODEL_CREDENTIAL_SERVICE,
            "Markbridge.Pairing"
        );
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

    #[cfg(windows)]
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

    #[test]
    fn posix_handoff_uses_fixed_executables_and_one_validated_url_argument() {
        let url = "https://example.com/a?value=one&next=two";
        let mac = super::posix_open_command("macos", url).unwrap();
        assert_eq!(mac.get_program(), "/usr/bin/open");
        assert_eq!(mac.get_args().collect::<Vec<_>>(), vec!["--", url]);
        let linux = super::posix_open_command("linux", url).unwrap();
        assert_eq!(linux.get_program(), "xdg-open");
        assert_eq!(linux.get_args().collect::<Vec<_>>(), vec![url]);
        assert!(super::posix_open_command("linux", "file:///etc/passwd").is_err());
        assert!(super::posix_open_command("linux", "https://user:secret@example.com").is_err());
        assert!(super::posix_open_command("other", url).is_err());
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

    #[derive(Default)]
    struct MemoryCredentials(std::sync::Mutex<std::collections::HashMap<String, String>>);
    impl markbridge_core::bridge::credentials::CredentialStore for MemoryCredentials {
        fn get(
            &self,
            reference: &str,
        ) -> std::result::Result<String, markbridge_protocol::ErrorCode> {
            self.0
                .lock()
                .unwrap()
                .get(reference)
                .cloned()
                .ok_or(markbridge_protocol::ErrorCode::Unpaired)
        }
        fn set(
            &self,
            reference: &str,
            value: &str,
        ) -> std::result::Result<(), markbridge_protocol::ErrorCode> {
            self.0
                .lock()
                .unwrap()
                .insert(reference.to_owned(), value.to_owned());
            Ok(())
        }
        fn delete(
            &self,
            reference: &str,
        ) -> std::result::Result<(), markbridge_protocol::ErrorCode> {
            self.0.lock().unwrap().remove(reference);
            Ok(())
        }
    }

    // A live blocking task inhibits paused-time auto-advance onto the debounce timer.
    struct ClockHold {
        release: Option<std::sync::mpsc::Sender<()>>,
        task: Option<tokio::task::JoinHandle<()>>,
    }
    impl ClockHold {
        fn new() -> Self {
            let (tx, rx) = std::sync::mpsc::channel();
            let task = tokio::task::spawn_blocking(move || {
                let _ = rx.recv();
            });
            Self {
                release: Some(tx),
                task: Some(task),
            }
        }
        async fn release(mut self) {
            self.release.take();
            if let Some(task) = self.task.take() {
                task.await.unwrap();
            }
        }
    }
    impl Drop for ClockHold {
        fn drop(&mut self) {
            self.release.take();
        }
    }

    async fn real_wait(duration: std::time::Duration) {
        tokio::task::spawn_blocking(move || std::thread::sleep(duration))
            .await
            .unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn resumed_run_event_rescans_a_mirror_the_watcher_has_not_applied() {
        const LOCAL_SINGLE: &str =
            include_str!("../../../../tests/fixtures/bookmarks/local-state-single.json");
        const PERSONAL: &str =
            include_str!("../../../../tests/fixtures/bookmarks/bookmarks-personal.json");
        const UPDATED: &str =
            include_str!("../../../../tests/fixtures/bookmarks/bookmarks-updated.json");
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("User Data");
        std::fs::create_dir_all(root.join("Default")).unwrap();
        std::fs::write(root.join("Local State"), LOCAL_SINGLE).unwrap();
        std::fs::write(root.join("Default").join("Bookmarks"), PERSONAL).unwrap();
        let bridge = markbridge_core::bridge::Bridge::open(
            dir.path().join("cache.sqlite"),
            std::sync::Arc::new(MemoryCredentials::default()),
        )
        .await
        .unwrap();
        let attached = bridge
            .attach_file_mirror(root.to_str().unwrap().to_owned(), "Default".into())
            .await
            .unwrap();
        let mirror_id = attached.mirrors[0].mirror_source_id.clone();
        let original = markbridge_core::mirror::parse_bookmarks(PERSONAL.as_bytes()).unwrap();
        let updated = markbridge_core::mirror::parse_bookmarks(UPDATED.as_bytes()).unwrap();
        assert_eq!(
            bridge.mirror_tree(mirror_id.clone()).await.unwrap().nodes,
            original
        );
        real_wait(std::time::Duration::from_millis(100)).await;
        std::fs::write(root.join("Default").join("Bookmarks"), UPDATED).unwrap();
        real_wait(std::time::Duration::from_millis(150)).await;

        let started = tokio::time::Instant::now();
        let hold = ClockHold::new();
        let before = bridge.mirror_tree(mirror_id.clone()).await.unwrap();
        assert_eq!(before.nodes, original);
        super::on_run_event(&tauri::RunEvent::Resumed, Some(&bridge));
        let start = std::time::Instant::now();
        let mut settled = None;
        while start.elapsed() < std::time::Duration::from_secs(5) {
            let tree = bridge.mirror_tree(mirror_id.clone()).await.unwrap();
            if tree.nodes == updated {
                settled = Some(tree);
                break;
            }
            real_wait(std::time::Duration::from_millis(20)).await;
        }
        let settled = settled.expect("resumed handler did not rescan the temp mirror");
        assert_eq!(settled.nodes, updated);
        assert_ne!(settled.nodes, original);
        assert!(
            started.elapsed() < std::time::Duration::from_millis(300),
            "watcher debounce elapsed, so this was not the resume rescan"
        );
        hold.release().await;
        bridge.shutdown().await.unwrap();
    }
}
