#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use markbridge_core::bridge::{Bridge, credentials::OsCredentialStore};
use markbridge_protocol::{BridgeState, ErrorCode, Id, PairingOffer};
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
            reconnect_profile
        ])
        .build(tauri::generate_context!());
    let Ok(app) = app else {
        eprintln!("STARTUP_FAILED: Unable to start Markbridge.");
        std::process::exit(1);
    };
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let bridge = app.state::<Bridge>();
            if tauri::async_runtime::block_on(bridge.shutdown()).is_err() {
                eprintln!("SHUTDOWN_FAILED");
            }
        }
    });
}
