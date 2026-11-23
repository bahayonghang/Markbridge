//! Disposable real Chrome E2E verification for Ticket #9 AC1. Not part of the default suite.
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use markbridge_protocol::{
    BRIDGE_PORT_END, BRIDGE_PORT_START, BridgeConnection, EditAction, ErrorCode, Id,
    OFFICIAL_EXTENSION_ID, OperationState, Title,
};
use sha2::{Digest, Sha256};
use tokio::{
    net::TcpListener,
    time::{sleep, timeout},
};

use super::super::Bridge;
use super::super::credentials::CredentialStore;
use super::MemoryCredentials;
use super::b100::{
    Cdp, Chrome, bar_id, browser_socket, find_page, free_port, revision_of, title_of,
    wait_first_live, wait_operation,
};

#[tokio::test]
#[ignore = "disposable Chrome profile; not the default suite"]
async fn disposable_chrome_zero_click_e2e_loop() {
    let daily_before = daily_bookmarks_digest();

    let extension_raw = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/extension/dist")
        .canonicalize()
        .unwrap();
    let extension_str = extension_raw.to_string_lossy();
    let extension_path = extension_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&extension_str)
        .to_owned();

    let app_data = tempfile::tempdir().unwrap();
    let db_path = app_data.path().join("markbridge.sqlite");
    let credentials: Arc<dyn CredentialStore> = Arc::new(MemoryCredentials::default());
    let bridge = Bridge::open(&db_path, credentials.clone()).await.unwrap();
    let started_state = bridge.start_auto().await.unwrap();
    let port1 = started_state.port.0.expect("bound port on 49153..=49160");
    assert!((BRIDGE_PORT_START..=BRIDGE_PORT_END).contains(&port1));
    println!("AC1_BRIDGE_PORT_1={port1}");

    // Chrome Profile 1: load via CDP Extensions.loadUnpacked and verify 0-click auto-connect.
    let debug_port_1 = free_port();
    let mut chrome1 =
        Chrome::launch_with_flags(debug_port_1, &["--enable-unsafe-extension-debugging"]);
    let (browser1, ws_url_1) = timeout(Duration::from_secs(15), browser_socket(debug_port_1))
        .await
        .expect("chrome1 debugging port")
        .expect("chrome1 json/version");
    println!("AC1_CHROME_VERSION={browser1}");
    let mut browser_cdp_1 = Cdp::connect(&ws_url_1).await;
    let load_started_1 = Instant::now();
    let loaded_1 = browser_cdp_1
        .call(
            "Extensions.loadUnpacked",
            serde_json::json!({ "path": extension_path }),
        )
        .await;
    let ext_id_1 = loaded_1["id"].as_str().expect("extension id 1");
    assert_eq!(ext_id_1.len(), 32);
    assert_eq!(ext_id_1, OFFICIAL_EXTENSION_ID);
    println!("AC1_EXTENSION_ID={ext_id_1}");

    // 0-click auto-connect MUST reach Live BEFORE opening options.html or sending reconnect.
    let profile1 = timeout(Duration::from_secs(15), wait_first_live(&bridge))
        .await
        .expect("profile1 zero-click live");
    let auto_connect_ms = load_started_1.elapsed().as_millis();
    let p1_view = bridge
        .state()
        .await
        .profiles
        .into_iter()
        .find(|p| p.profile_id == profile1)
        .unwrap();
    assert_eq!(p1_view.display_name.as_str(), "Chrome 资料 1");
    println!(
        "AC1_ZERO_CLICK_LIVE_MS={auto_connect_ms} profile={} display_name={}",
        profile1.as_str(),
        p1_view.display_name.as_str()
    );

    // Open options.html to drive chrome.bookmarks & query extension status.
    let options_url = format!("chrome-extension://{ext_id_1}/options.html");
    browser_cdp_1
        .call(
            "Target.createTarget",
            serde_json::json!({ "url": options_url }),
        )
        .await;
    let page_socket_1 = timeout(Duration::from_secs(10), find_page(debug_port_1, ext_id_1))
        .await
        .expect("chrome1 options page")
        .expect("chrome1 options socket");
    let mut page_cdp_1 = Cdp::connect(&page_socket_1).await;
    let initial_cache = bridge.cache(profile1.clone()).await.unwrap().0;
    let bar = bar_id(&initial_cache);

    // Sub-item 3: Chrome bookmark create & update syncs to desktop cache + SQLite within <= 3s.
    let created_id = timeout(Duration::from_secs(10), async {
        loop {
            let expr = format!(
                "(async () => chrome.bookmarks ? (await chrome.bookmarks.create({{ parentId: {}, title: 'AC1 Sync Created', url: 'https://example.test/ac1-created' }})).id : null)()",
                serde_json::to_string(&bar).unwrap()
            );
            if let Ok(value) = page_cdp_1.eval(&expr).await
                && let Some(id) = value.as_str()
            {
                return id.to_owned();
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("chrome1 bookmark create");
    let create_timer = Instant::now();
    timeout(Duration::from_secs(3), async {
        loop {
            if title_of(&bridge, &profile1, &created_id).await.as_deref()
                == Some("AC1 Sync Created")
                && sqlite_title(&db_path, profile1.as_str(), &created_id).as_deref()
                    == Some("AC1 Sync Created")
            {
                return;
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("create synced within 3s");
    let create_sync_ms = create_timer.elapsed().as_millis();

    let update_timer = Instant::now();
    page_cdp_1
        .eval(&format!(
            "chrome.bookmarks.update({}, {{ title: 'AC1 Sync Updated' }})",
            serde_json::to_string(&created_id).unwrap()
        ))
        .await
        .expect("chrome1 bookmark update");
    timeout(Duration::from_secs(3), async {
        loop {
            if title_of(&bridge, &profile1, &created_id).await.as_deref()
                == Some("AC1 Sync Updated")
                && sqlite_title(&db_path, profile1.as_str(), &created_id).as_deref()
                    == Some("AC1 Sync Updated")
            {
                return;
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("update synced within 3s");
    let update_sync_ms = update_timer.elapsed().as_millis();
    println!("AC1_SYNC_CREATE_MS={create_sync_ms} AC1_SYNC_UPDATE_MS={update_sync_ms}");

    // Sub-item 4: Second isolated Chrome profile auto-creates Chrome 资料 2 + rename persists across reopen + port rollover.
    let debug_port_2 = free_port();
    let mut chrome2 =
        Chrome::launch_with_flags(debug_port_2, &["--enable-unsafe-extension-debugging"]);
    let (_browser2, ws_url_2) = timeout(Duration::from_secs(15), browser_socket(debug_port_2))
        .await
        .expect("chrome2 debugging port")
        .expect("chrome2 json/version");
    let mut browser_cdp_2 = Cdp::connect(&ws_url_2).await;
    let loaded_2 = browser_cdp_2
        .call(
            "Extensions.loadUnpacked",
            serde_json::json!({ "path": extension_path }),
        )
        .await;
    assert_eq!(loaded_2["id"].as_str(), Some(OFFICIAL_EXTENSION_ID));

    let profile2 = timeout(Duration::from_secs(15), async {
        loop {
            let state = bridge.state().await;
            if let Some(found) = state
                .profiles
                .iter()
                .find(|p| p.profile_id != profile1 && p.connection == BridgeConnection::Live)
            {
                return found.profile_id.clone();
            }
            sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .expect("profile2 zero-click live");
    let p2_view = bridge
        .state()
        .await
        .profiles
        .into_iter()
        .find(|p| p.profile_id == profile2)
        .unwrap();
    assert_ne!(p2_view.instance_id, p1_view.instance_id);
    assert_eq!(p2_view.display_name.as_str(), "Chrome 资料 2");
    println!(
        "AC1_PROFILE_2={} display_name={} distinct_instance_id=true",
        profile2.as_str(),
        p2_view.display_name.as_str()
    );

    let renamed_state = bridge
        .rename_profile(profile2.clone(), "研究资料二".into())
        .await
        .unwrap();
    assert_eq!(
        renamed_state
            .profiles
            .iter()
            .find(|p| p.profile_id == profile2)
            .unwrap()
            .display_name
            .as_str(),
        "研究资料二"
    );

    bridge.shutdown().await.unwrap();
    drop(bridge);

    // Hold port1 (49153) busy to verify start_auto rollover to 49154 & extension rollover reconnect!
    let blocker = TcpListener::bind(("127.0.0.1", port1)).await.unwrap();
    let blocker_task = tokio::spawn(async move {
        while let Ok((stream, _)) = blocker.accept().await {
            drop(stream);
        }
    });

    let reopened = Bridge::open(&db_path, credentials).await.unwrap();
    let persisted_p2 = reopened
        .state()
        .await
        .profiles
        .into_iter()
        .find(|p| p.profile_id == profile2)
        .unwrap();
    assert_eq!(persisted_p2.display_name.as_str(), "研究资料二");
    let rollover_state = reopened.start_auto().await.unwrap();
    let rollover_port = rollover_state.port.0.expect("rollover port");
    assert_ne!(rollover_port, port1);
    assert!((BRIDGE_PORT_START..=BRIDGE_PORT_END).contains(&rollover_port));
    println!("AC1_ROLLOVER_PORT={rollover_port}");

    let rollover_timer = Instant::now();
    timeout(Duration::from_secs(20), async {
        loop {
            let state = reopened.state().await;
            let live1 = state
                .profiles
                .iter()
                .any(|p| p.profile_id == profile1 && p.connection == BridgeConnection::Live);
            let live2 = state.profiles.iter().any(|p| {
                p.profile_id == profile2
                    && p.connection == BridgeConnection::Live
                    && p.display_name.as_str() == "研究资料二"
            });
            if live1 && live2 {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("both profiles auto-reconnect on rollover port");
    println!(
        "AC1_RENAME_PERSISTED=true AC1_ROLLOVER_RECONNECT_MS={}",
        rollover_timer.elapsed().as_millis()
    );

    chrome2.capture();
    drop(chrome2);
    blocker_task.abort();

    // Sub-item 5: writePaused keeps live Chrome -> desktop sync working while blocking browser writes (WRITE_PAUSED).
    let wp_state = reopened
        .set_write_paused(profile1.clone(), true)
        .await
        .unwrap();
    let wp_view = wp_state
        .profiles
        .iter()
        .find(|p| p.profile_id == profile1)
        .unwrap();
    assert!(wp_view.write_paused);
    assert_eq!(wp_view.connection, BridgeConnection::Live);
    timeout(Duration::from_secs(5), async {
        loop {
            let status = page_cdp_1
                .eval("chrome.runtime.sendMessage({ type: 'status' })")
                .await
                .unwrap();
            if status["state"].as_str() == Some("connected")
                && status["writePaused"].as_bool() == Some(true)
            {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("extension updated writePaused=true live without reconnect");

    let rev_paused = revision_of(&reopened, &profile1).await;
    let paused_preview = reopened
        .preview_edit(
            profile1.clone(),
            rev_paused,
            EditAction::Update {
                chrome_id: Id::new(&created_id).unwrap(),
                title: Some(Title::new("Blocked While Paused").unwrap()),
                url: None,
            },
        )
        .await
        .unwrap();
    assert!(!paused_preview.writable);
    assert_eq!(paused_preview.error_code.0, Some(ErrorCode::WritePaused));
    assert_eq!(
        reopened
            .apply_edit(
                profile1.clone(),
                rev_paused,
                EditAction::Update {
                    chrome_id: Id::new(&created_id).unwrap(),
                    title: Some(Title::new("Blocked While Paused").unwrap()),
                    url: None,
                },
                false,
            )
            .await
            .unwrap_err(),
        ErrorCode::WritePaused
    );

    let paused_sync_timer = Instant::now();
    page_cdp_1
        .eval(&format!(
            "chrome.bookmarks.update({}, {{ title: 'AC1 Mutated While WritePaused' }})",
            serde_json::to_string(&created_id).unwrap()
        ))
        .await
        .expect("chrome1 update while writePaused");
    timeout(Duration::from_secs(3), async {
        loop {
            if title_of(&reopened, &profile1, &created_id).await.as_deref()
                == Some("AC1 Mutated While WritePaused")
                && sqlite_title(&db_path, profile1.as_str(), &created_id).as_deref()
                    == Some("AC1 Mutated While WritePaused")
            {
                return;
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("live sync while writePaused");
    let paused_sync_ms = paused_sync_timer.elapsed().as_millis();

    reopened
        .set_write_paused(profile1.clone(), false)
        .await
        .unwrap();
    timeout(Duration::from_secs(5), async {
        loop {
            let status = page_cdp_1
                .eval("chrome.runtime.sendMessage({ type: 'status' })")
                .await
                .unwrap();
            if status["state"].as_str() == Some("connected")
                && status["writePaused"].as_bool() == Some(false)
            {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("extension updated writePaused=false live without reconnect");
    let rev_restored = revision_of(&reopened, &profile1).await;
    let writable_preview = reopened
        .preview_edit(
            profile1.clone(),
            rev_restored,
            EditAction::Update {
                chrome_id: Id::new(&created_id).unwrap(),
                title: Some(Title::new("AC1 Restored Write").unwrap()),
                url: None,
            },
        )
        .await
        .unwrap();
    assert!(writable_preview.writable);
    assert_eq!(writable_preview.error_code.0, None);
    let applied = reopened
        .apply_edit(
            profile1.clone(),
            rev_restored,
            EditAction::Update {
                chrome_id: Id::new(&created_id).unwrap(),
                title: Some(Title::new("AC1 Restored Write").unwrap()),
                url: None,
            },
            false,
        )
        .await
        .unwrap();
    timeout(
        Duration::from_secs(10),
        wait_operation(
            &reopened,
            &profile1,
            &applied.operation_id,
            OperationState::Applied,
        ),
    )
    .await
    .expect("restored browser write applied");
    let chrome_title = page_cdp_1
        .eval(&format!(
            "(async () => (await chrome.bookmarks.get({}))[0].title)()",
            serde_json::to_string(&created_id).unwrap()
        ))
        .await
        .unwrap();
    assert_eq!(chrome_title.as_str(), Some("AC1 Restored Write"));
    assert_eq!(
        title_of(&reopened, &profile1, &created_id).await.as_deref(),
        Some("AC1 Restored Write")
    );
    println!("AC1_WRITE_PAUSED_SYNC_MS={paused_sync_ms} AC1_UNPAUSED_WRITE=applied");

    // Reconnect while write_paused is already true so HelloResult carries writePaused=true,
    // then unpause live via WritePolicy without reconnecting and verify apply_edit succeeds.
    reopened
        .set_write_paused(profile1.clone(), true)
        .await
        .unwrap();
    reopened.reconnect_profile(profile1.clone()).await.unwrap();
    timeout(Duration::from_secs(10), async {
        loop {
            let live_paused = reopened.state().await.profiles.iter().any(|p| {
                p.profile_id == profile1 && p.write_paused && p.connection == BridgeConnection::Live
            });
            let status = page_cdp_1
                .eval("chrome.runtime.sendMessage({ type: 'status' })")
                .await
                .unwrap();
            if live_paused
                && status["state"].as_str() == Some("connected")
                && status["writePaused"].as_bool() == Some(true)
            {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("reconnected with HelloResult writePaused=true");
    let rev_hello_paused = revision_of(&reopened, &profile1).await;
    assert_eq!(
        reopened
            .apply_edit(
                profile1.clone(),
                rev_hello_paused,
                EditAction::Update {
                    chrome_id: Id::new(&created_id).unwrap(),
                    title: Some(Title::new("Blocked After Hello").unwrap()),
                    url: None,
                },
                false,
            )
            .await
            .unwrap_err(),
        ErrorCode::WritePaused
    );
    reopened
        .set_write_paused(profile1.clone(), false)
        .await
        .unwrap();
    timeout(Duration::from_secs(5), async {
        loop {
            let status = page_cdp_1
                .eval("chrome.runtime.sendMessage({ type: 'status' })")
                .await
                .unwrap();
            if status["state"].as_str() == Some("connected")
                && status["writePaused"].as_bool() == Some(false)
            {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("live write_policy unpaused after HelloResult(writePaused=true) without reconnect");
    let rev_after_hello_unpause = revision_of(&reopened, &profile1).await;
    let applied_after_hello = reopened
        .apply_edit(
            profile1.clone(),
            rev_after_hello_unpause,
            EditAction::Update {
                chrome_id: Id::new(&created_id).unwrap(),
                title: Some(Title::new("AC1 Unpaused After Hello").unwrap()),
                url: None,
            },
            false,
        )
        .await
        .unwrap();
    timeout(
        Duration::from_secs(10),
        wait_operation(
            &reopened,
            &profile1,
            &applied_after_hello.operation_id,
            OperationState::Applied,
        ),
    )
    .await
    .expect("apply_edit succeeded after live write_policy unpause");
    let chrome_title_after_hello = page_cdp_1
        .eval(&format!(
            "(async () => (await chrome.bookmarks.get({}))[0].title)()",
            serde_json::to_string(&created_id).unwrap()
        ))
        .await
        .unwrap();
    assert_eq!(
        chrome_title_after_hello.as_str(),
        Some("AC1 Unpaused After Hello")
    );
    assert_eq!(
        title_of(&reopened, &profile1, &created_id).await.as_deref(),
        Some("AC1 Unpaused After Hello")
    );
    println!("AC1_LIVE_WRITE_POLICY_SYNC=true AC1_UNPAUSED_AFTER_HELLO_WRITE=applied");

    // Sub-item 6: ignore_profile -> PauseSync -> extension stays paused without bouncing back; user reconnect restores Live.
    let ignored_state = reopened.ignore_profile(profile1.clone()).await.unwrap();
    let ignored_view = ignored_state
        .profiles
        .iter()
        .find(|p| p.profile_id == profile1)
        .unwrap();
    assert!(ignored_view.ignored);
    assert_eq!(ignored_view.connection, BridgeConnection::Ignored);

    let paused_ext = timeout(Duration::from_secs(5), async {
        loop {
            let status = page_cdp_1
                .eval("chrome.runtime.sendMessage({ type: 'status' })")
                .await
                .unwrap();
            if status["state"].as_str() == Some("paused") {
                return status;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("extension entered paused");
    assert_eq!(paused_ext["errorCode"].as_str(), Some("PROFILE_IGNORED"));
    assert!(paused_ext["port"].is_null());

    // Wait across initial retry intervals (1s + 2s backoff) and verify zero bounce-back.
    sleep(Duration::from_millis(3500)).await;
    let still_ignored = reopened
        .state()
        .await
        .profiles
        .into_iter()
        .find(|p| p.profile_id == profile1)
        .unwrap();
    assert!(still_ignored.ignored);
    assert_eq!(still_ignored.connection, BridgeConnection::Ignored);
    let still_paused_ext = page_cdp_1
        .eval("chrome.runtime.sendMessage({ type: 'status' })")
        .await
        .unwrap();
    assert_eq!(still_paused_ext["state"].as_str(), Some("paused"));
    assert!(still_paused_ext["port"].is_null());

    // Explicit user reconnect (userInitiated: true) restores Live.
    let reconnect_timer = Instant::now();
    page_cdp_1
        .eval("chrome.runtime.sendMessage({ type: 'reconnect' })")
        .await
        .expect("explicit reconnect");
    timeout(Duration::from_secs(10), async {
        loop {
            let live = reopened.state().await.profiles.iter().any(|p| {
                p.profile_id == profile1 && !p.ignored && p.connection == BridgeConnection::Live
            });
            let status = page_cdp_1
                .eval("chrome.runtime.sendMessage({ type: 'status' })")
                .await
                .unwrap();
            if live && status["state"].as_str() == Some("connected") {
                return;
            }
            sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("explicit reconnect restored Live");
    println!(
        "AC1_IGNORE_NO_BOUNCE=true AC1_EXPLICIT_RECONNECT_LIVE_MS={}",
        reconnect_timer.elapsed().as_millis()
    );

    reopened.shutdown().await.unwrap();
    chrome1.capture();
    drop(chrome1);

    let daily_after = daily_bookmarks_digest();
    assert_eq!(daily_after, daily_before);
    println!("AC1_DAILY_PROFILE_UNTOUCHED=true");
}

fn sqlite_title(db_path: &Path, profile_id: &str, chrome_id: &str) -> Option<String> {
    let conn =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    conn.query_row(
        "SELECT title FROM bookmarks_cache WHERE profile_id=?1 AND chrome_id=?2 AND deleted_at IS NULL",
        [profile_id, chrome_id],
        |row| row.get(0),
    )
    .ok()
}

fn daily_bookmarks_digest() -> Option<(u64, String)> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    let path = PathBuf::from(local)
        .join("Google")
        .join("Chrome")
        .join("User Data")
        .join("Default")
        .join("Bookmarks");
    let bytes = std::fs::read(&path).ok()?;
    let hash = Sha256::digest(&bytes);
    let text: String = hash.iter().map(|byte| format!("{byte:02X}")).collect();
    Some((bytes.len() as u64, text))
}
