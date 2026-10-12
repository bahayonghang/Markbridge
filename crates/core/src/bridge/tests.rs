use super::*;
use futures_util::{SinkExt, StreamExt};
use std::{collections::HashMap, sync::Mutex as StdMutex, time::Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

#[derive(Default)]
struct MemoryCredentials(StdMutex<HashMap<String, String>>);
impl CredentialStore for MemoryCredentials {
    fn get(&self, reference: &str) -> Result<String> {
        self.0
            .lock()
            .unwrap()
            .get(reference)
            .cloned()
            .ok_or(ErrorCode::Unpaired)
    }
    fn set(&self, reference: &str, value: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert(reference.into(), value.into());
        Ok(())
    }
    fn delete(&self, reference: &str) -> Result<()> {
        self.0.lock().unwrap().remove(reference);
        Ok(())
    }
}
fn origin() -> PairedOrigin {
    PairedOrigin::new(format!("chrome-extension://{}", "a".repeat(32))).unwrap()
}
async fn fixture() -> (Bridge, tempfile::TempDir, Arc<MemoryCredentials>) {
    let directory = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryCredentials::default());
    let bridge = Bridge::open(directory.path().join("cache.sqlite"), store.clone())
        .await
        .unwrap();
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = socket.local_addr().unwrap().port();
    drop(socket);
    bridge.start(port).await.unwrap();
    (bridge, directory, store)
}
fn pair_message(offer: &PairingOffer, instance: &str) -> WireMessage {
    let code: serde_json::Value = serde_json::from_str(&offer.pairing_code).unwrap();
    envelope("pair", &offer.profile_id, &Id::new("session-pair").unwrap(), Some(Id::new("pair-request").unwrap()), serde_json::json!({"instanceId":instance, "credential":code["credential"], "displayName":"untrusted display"})).unwrap()
}
async fn paired(bridge: &Bridge, instance: &str) -> (Id, String) {
    let before = bridge.state().await.profiles.len();
    let offer = bridge
        .begin_pairing("trusted display".into())
        .await
        .unwrap();
    let message = pair_message(&offer, instance);
    assert!(bridge.pair(&origin(), &message).await.unwrap().is_none());
    assert_eq!(bridge.state().await.profiles.len(), before);
    bridge
        .confirm_pairing(offer.profile_id.clone(), Id::new(instance).unwrap())
        .await
        .unwrap();
    let secret = bridge.pair(&origin(), &message).await.unwrap().unwrap();
    assert_eq!(
        bridge.pair(&origin(), &message).await.unwrap_err(),
        ErrorCode::Unpaired
    );
    (offer.profile_id, secret)
}
fn hello(profile: &Id, instance: &str, session: &str, secret: &str) -> WireMessage {
    envelope(
        "hello",
        profile,
        &Id::new(session).unwrap(),
        Some(Id::new("hello-request").unwrap()),
        serde_json::json!({"instanceId":instance,"credential":secret}),
    )
    .unwrap()
}
fn nodes() -> Vec<BookmarkNode> {
    serde_json::from_value(serde_json::json!([
        {"chromeId":"0","parentId":null,"position":0,"kind":"folder","title":"root","url":null,"folderType":null,"unmodifiable":null,"dateAdded":null,"dateLastUsed":null},
        {"chromeId":"42","parentId":"0","position":0,"kind":"bookmark","title":"synthetic","url":"https://example.com/","folderType":null,"unmodifiable":null,"dateAdded":null,"dateLastUsed":null}
    ])).unwrap()
}
async fn full(bridge: &Bridge, profile: &Id, session: &str, seq: u64) {
    let session = Id::new(session).unwrap();
    let request = bridge
        .request_tree(profile, &session)
        .await
        .unwrap()
        .unwrap();
    let WireMessage::GetTree { request_id, .. } = request else {
        unreachable!()
    };
    let full = envelope(
        "tree_full",
        profile,
        &session,
        request_id.0,
        serde_json::to_value(TreeSnapshot {
            source_epoch: SourceEpoch::new(1).unwrap(),
            revision: Counter::new(0).unwrap(),
            barrier_seq: Counter::new(seq).unwrap(),
            nodes: nodes(),
        })
        .unwrap(),
    )
    .unwrap();
    assert!(!bridge.receive(full).await.unwrap());
}

#[tokio::test]
async fn pairing_requires_confirmation_and_binds_origin_instance_and_expiry() {
    let (bridge, _dir, credentials) = fixture().await;
    let offer = bridge.begin_pairing("Desktop name".into()).await.unwrap();
    let code: serde_json::Value = serde_json::from_str(&offer.pairing_code).unwrap();
    assert_eq!(code["credential"].as_str().unwrap().len(), 64);
    assert!(offer.expires_at.get() >= now().unwrap() + 119_000);
    assert!(
        bridge
            .confirm_pairing(offer.profile_id.clone(), Id::new("i").unwrap())
            .await
            .is_err()
    );
    let valid = pair_message(&offer, "i");
    let mut bad = serde_json::to_value(&valid).unwrap();
    bad["payload"]["credential"] = serde_json::json!("wrong".repeat(12));
    assert_eq!(
        bridge
            .pair(&origin(), &serde_json::from_value(bad).unwrap())
            .await
            .unwrap_err(),
        ErrorCode::Unpaired
    );
    assert!(bridge.state().await.pending[0].instance_id.0.is_none());
    assert!(bridge.pair(&origin(), &valid).await.unwrap().is_none());
    let other = PairedOrigin::new(format!("chrome-extension://{}", "b".repeat(32))).unwrap();
    assert_eq!(
        bridge.pair(&other, &valid).await.unwrap_err(),
        ErrorCode::WrongProfile
    );
    assert!(credentials.0.lock().unwrap().is_empty());
    {
        bridge
            .inner
            .lock()
            .await
            .pending
            .get_mut(offer.profile_id.as_str())
            .unwrap()
            .view
            .expires_at = Counter::new(0).unwrap();
    }
    assert_eq!(
        bridge.pair(&origin(), &valid).await.unwrap_err(),
        ErrorCode::Unpaired
    );
    assert!(
        bridge
            .inner
            .lock()
            .await
            .storage()
            .unwrap()
            .profiles()
            .await
            .unwrap()
            .is_empty()
    );
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
async fn reconnect_uses_persisted_revision_and_revocation_preserves_cache() {
    let (bridge, dir, credentials) = fixture().await;
    let (profile, secret) = paired(&bridge, "instance").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s1", &secret))
        .await
        .unwrap();
    full(&bridge, &profile, "s1", 12).await;
    assert_eq!(bridge.state().await.profiles[0].revision.get(), 1);
    bridge.shutdown().await.unwrap();
    let bridge = Bridge::open(dir.path().join("cache.sqlite"), credentials.clone())
        .await
        .unwrap();
    assert_eq!(
        bridge.state().await.profiles[0].connection,
        BridgeConnection::CachedReadOnly
    );
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s2", &secret))
        .await
        .unwrap();
    full(&bridge, &profile, "s2", 0).await;
    assert_eq!(bridge.state().await.profiles[0].revision.get(), 2);
    bridge.revoke_pairing(profile.clone()).await.unwrap();
    assert_eq!(
        bridge.state().await.profiles[0].connection,
        BridgeConnection::Unpaired
    );
    assert!(bridge.reconnect_profile(profile.clone()).await.is_err());
    assert!(credentials.0.lock().unwrap().is_empty());
    assert!(
        bridge
            .authenticate(&origin(), &hello(&profile, "instance", "s3", &secret))
            .await
            .is_err()
    );
    assert_eq!(bridge.cache(profile.clone()).await.unwrap().0.len(), 2);
    bridge.shutdown().await.unwrap();
    let bridge = Bridge::open(dir.path().join("cache.sqlite"), credentials)
        .await
        .unwrap();
    assert_eq!(
        bridge.state().await.profiles[0].connection,
        BridgeConnection::Unpaired
    );
    assert!(
        bridge
            .authenticate(&origin(), &hello(&profile, "instance", "s4", &secret))
            .await
            .is_err()
    );
    bridge.shutdown().await.unwrap();
}

fn sorted_tree(nodes: Vec<BookmarkNode>) -> Vec<BookmarkNode> {
    let mut nodes = nodes;
    nodes.sort_by(|left, right| left.chrome_id.as_str().cmp(right.chrome_id.as_str()));
    nodes
}
async fn cached_tree(bridge: &Bridge, profile: &Id) -> Vec<BookmarkNode> {
    sorted_tree(bridge.cache(profile.clone()).await.unwrap().0)
}
async fn accept_tree(
    bridge: &Bridge,
    profile: &Id,
    session: &str,
    seq: u64,
    nodes: Vec<BookmarkNode>,
) {
    let session = Id::new(session).unwrap();
    let request = bridge
        .request_tree(profile, &session)
        .await
        .unwrap()
        .unwrap();
    let WireMessage::GetTree { request_id, .. } = request else {
        unreachable!()
    };
    let full = envelope(
        "tree_full",
        profile,
        &session,
        request_id.0,
        serde_json::to_value(TreeSnapshot {
            source_epoch: SourceEpoch::new(1).unwrap(),
            revision: Counter::new(0).unwrap(),
            barrier_seq: Counter::new(seq).unwrap(),
            nodes,
        })
        .unwrap(),
    )
    .unwrap();
    assert!(!bridge.receive(full).await.unwrap());
}
fn changed_event(profile: &Id, seq: u64, title: &str) -> WireMessage {
    serde_json::from_value(serde_json::json!({"type":"event","protocolVersion":1,"profileId":profile,"sessionId":"s","requestId":null,"seq":seq,"payload":{"sourceEpoch":1,"event":{"kind":"changed","chromeId":"42","title":title,"url":"https://example.com/"}}})).unwrap()
}

#[tokio::test]
async fn events_commit_once_and_gaps_require_full_reconciliation() {
    let (bridge, _dir, _) = fixture().await;
    let (profile, secret) = paired(&bridge, "instance").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s", &secret))
        .await
        .unwrap();
    full(&bridge, &profile, "s", 0).await;
    let event = changed_event(&profile, 1, "new");
    assert!(!bridge.receive(event.clone()).await.unwrap());
    let committed = cached_tree(&bridge, &profile).await;
    assert_eq!(
        committed
            .iter()
            .find(|node| node.chrome_id.as_str() == "42")
            .unwrap()
            .title
            .as_str(),
        "new"
    );
    assert!(!bridge.receive(event.clone()).await.unwrap());
    assert_eq!(cached_tree(&bridge, &profile).await, committed);
    assert!(
        bridge
            .receive(changed_event(&profile, 3, "gap"))
            .await
            .unwrap()
    );
    assert_eq!(cached_tree(&bridge, &profile).await, committed);
    assert!(
        bridge
            .receive(changed_event(&profile, 4, "late"))
            .await
            .unwrap()
    );
    assert_eq!(cached_tree(&bridge, &profile).await, committed);
    let mut reconciled = nodes();
    reconciled[1].title = Title::new("reconciled").unwrap();
    let mut added = reconciled[1].clone();
    added.chrome_id = Id::new("43").unwrap();
    added.position = Position::new(1).unwrap();
    added.title = Title::new("second").unwrap();
    added.url = Some(Url::new("https://example.com/second").unwrap());
    reconciled[1].position = Position::new(0).unwrap();
    reconciled.push(added);
    let expected = sorted_tree(reconciled.clone());
    accept_tree(&bridge, &profile, "s", 4, reconciled).await;
    assert_eq!(cached_tree(&bridge, &profile).await, expected);
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
async fn equal_chrome_ids_and_wrong_auth_never_cross_profiles() {
    let (bridge, _dir, _) = fixture().await;
    let (one, secret) = paired(&bridge, "i1").await;
    let (two, other_secret) = paired(&bridge, "i2").await;
    for message in [
        hello(&one, "i1", "bad", &other_secret),
        hello(&one, "i2", "bad", &secret),
        hello(&two, "i1", "bad", &secret),
    ] {
        assert!(bridge.authenticate(&origin(), &message).await.is_err());
    }
    assert!(bridge.cache(one.clone()).await.unwrap().0.is_empty());
    bridge
        .authenticate(&origin(), &hello(&one, "i1", "s1", &secret))
        .await
        .unwrap();
    full(&bridge, &one, "s1", 0).await;
    assert!(bridge.cache(two.clone()).await.unwrap().0.is_empty());
    bridge
        .authenticate(&origin(), &hello(&two, "i2", "s2", &other_secret))
        .await
        .unwrap();
    full(&bridge, &two, "s2", 0).await;
    let inner = bridge.inner.lock().await;
    let a = inner
        .storage()
        .unwrap()
        .bookmarks(one, SourceEpoch::new(1).unwrap())
        .await
        .unwrap();
    let b = inner
        .storage()
        .unwrap()
        .bookmarks(two, SourceEpoch::new(1).unwrap())
        .await
        .unwrap();
    assert_ne!(a[1].bookmark_id, b[1].bookmark_id);
    drop(inner);
    bridge.shutdown().await.unwrap();
}

fn persisted_rows(path: &std::path::Path) -> (i64, i64) {
    let connection =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let profiles = connection
        .query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))
        .unwrap();
    let cache = connection
        .query_row("SELECT COUNT(*) FROM bookmarks_cache", [], |row| row.get(0))
        .unwrap();
    (profiles, cache)
}

#[tokio::test]
async fn real_websocket_rejects_headers_identity_version_and_unauthenticated_idle() {
    let (bridge, dir, _) = fixture().await;
    let database = dir.path().join("cache.sqlite");
    let port = bridge.state().await.port.0.unwrap();
    let url = format!("ws://127.0.0.1:{port}/");
    assert!(connect_async(&url).await.is_err());
    assert_eq!(persisted_rows(&database), (0, 0));
    let mut request = url.as_str().into_client_request().unwrap();
    request
        .headers_mut()
        .insert("Origin", "https://example.com".parse().unwrap());
    let rejection = connect_async(request).await.unwrap_err();
    let tokio_tungstenite::tungstenite::Error::Http(response) = rejection else {
        panic!("origin rejection");
    };
    assert_eq!(
        response.status(),
        tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN
    );
    assert!(
        std::str::from_utf8(response.body().as_deref().unwrap_or_default())
            .unwrap_or_default()
            .contains("UNPAIRED")
    );
    assert_eq!(persisted_rows(&database), (0, 0));
    let mut request = url.as_str().into_client_request().unwrap();
    request
        .headers_mut()
        .insert("Origin", origin().as_str().parse().unwrap());
    let offer = bridge.begin_pairing("token check".into()).await.unwrap();
    let mut bad_token = serde_json::to_value(pair_message(&offer, "bad-instance")).unwrap();
    bad_token["payload"]["credential"] = serde_json::json!("x".repeat(64));
    let (mut ws, _) = connect_async(request.clone()).await.unwrap();
    ws.send(Message::Text(bad_token.to_string().into()))
        .await
        .unwrap();
    let token_result = ws.next().await.unwrap().unwrap().into_text().unwrap();
    assert!(matches!(
        parse_frame(token_result.as_bytes()).unwrap(),
        WireMessage::PairResult {
            payload: PairResultPayload {
                accepted: false,
                credential: None,
                error_code: Some(ErrorCode::Unpaired),
            },
            ..
        }
    ));
    assert_eq!(persisted_rows(&database), (0, 0));
    bridge.cancel_pairing(offer.profile_id).await.unwrap();
    let (mut ws, _) = connect_async(request.clone()).await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(6), ws.next())
            .await
            .is_ok()
    );
    assert_eq!(persisted_rows(&database), (0, 0));
    let (mut ws, _) = connect_async(request.clone()).await.unwrap();
    ws.send(Message::Text(serde_json::json!({"type":"hello","protocolVersion":2,"profileId":"p","sessionId":"s","requestId":"r","seq":null,"payload":{"instanceId":"i","credential":"x".repeat(64)}}).to_string().into())).await.unwrap();
    let version_result = tokio::time::timeout(Duration::from_secs(1), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap();
    assert!(matches!(
        parse_frame(version_result.as_bytes()).unwrap(),
        WireMessage::HelloResult {
            payload: HelloResultPayload {
                accepted: false,
                error_code: Some(ErrorCode::UnsupportedVersion),
                ..
            },
            ..
        }
    ));
    assert_eq!(persisted_rows(&database), (0, 0));
    let (profile, secret) = paired(&bridge, "i").await;
    let (mut ws, _) = connect_async(request).await.unwrap();
    ws.send(Message::Text(
        serde_json::to_string(&hello(&profile, "i", "s", &secret))
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();
    let result = ws.next().await.unwrap().unwrap().into_text().unwrap();
    assert!(matches!(
        parse_frame(result.as_bytes()).unwrap(),
        WireMessage::HelloResult {
            payload: HelloResultPayload { accepted: true, .. },
            ..
        }
    ));
    ws.next().await.unwrap().unwrap(); // get_tree
    let message = hello(&Id::new("wrong-profile").unwrap(), "i", "s", &secret);
    ws.send(Message::Text(
        serde_json::to_string(&message).unwrap().into(),
    ))
    .await
    .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(1), ws.next())
            .await
            .is_ok()
    );
    assert_eq!(bridge.state().await.profiles[0].node_count.get(), 0);
    bridge.shutdown().await.unwrap();
}

#[test]
fn reorder_move_and_subtree_remove_preserve_positions() {
    let mut tree = nodes();
    let mut added = tree[1].clone();
    added.chrome_id = Id::new("43").unwrap();
    sync::apply_event(&mut tree, &BookmarkEvent::Created { node: added }).unwrap();
    assert_eq!(
        tree.iter()
            .find(|n| n.chrome_id.as_str() == "42")
            .unwrap()
            .position
            .get(),
        1
    );
    sync::apply_event(
        &mut tree,
        &BookmarkEvent::Reordered {
            parent_id: Id::new("0").unwrap(),
            child_ids: vec![Id::new("42").unwrap(), Id::new("43").unwrap()],
        },
    )
    .unwrap();
    let node = tree
        .iter()
        .find(|n| n.chrome_id.as_str() == "43")
        .unwrap()
        .clone();
    sync::apply_event(
        &mut tree,
        &BookmarkEvent::Removed {
            chrome_id: node.chrome_id.clone(),
            parent_id: Id::new("0").unwrap(),
            position: node.position,
            subtree: vec![node],
        },
    )
    .unwrap();
    assert_eq!(tree.len(), 2);
    assert_eq!(tree[1].position.get(), 0);
}

#[cfg(windows)]
#[tokio::test]
async fn windows_task_namespace_pairing_reaches_authenticated_session() {
    let directory = tempfile::tempdir().unwrap();
    let store = Arc::new(super::credentials::OsCredentialStore::new(
        "Markbridge.Task03.bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ));
    let bridge = Bridge::open(directory.path().join("cache.sqlite"), store)
        .await
        .unwrap();
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = socket.local_addr().unwrap().port();
    drop(socket);
    bridge.start(port).await.unwrap();
    let (profile, secret) = paired(&bridge, "instance").await;
    let authenticated = bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s-os", &secret))
        .await;
    let revoked = bridge.revoke_pairing(profile).await;
    bridge.shutdown().await.unwrap();
    authenticated.unwrap();
    revoked.unwrap();
}

fn fixture_node(
    id: &str,
    parent: Option<&str>,
    position: u64,
    folder: bool,
    title: &str,
    url: Option<&str>,
) -> BookmarkNode {
    BookmarkNode {
        chrome_id: Id::new(id).unwrap(),
        parent_id: parent.map(|value| Id::new(value).unwrap()),
        position: Position::new(position).unwrap(),
        kind: if folder {
            NodeKind::Folder
        } else {
            NodeKind::Bookmark
        },
        title: Title::new(title).unwrap(),
        url: url.map(|value| Url::new(value).unwrap()),
        folder_type: None,
        unmodifiable: None,
        date_added: None,
        date_last_used: None,
    }
}
fn library() -> Vec<BookmarkNode> {
    vec![
        fixture_node("0", None, 0, true, "root", None),
        fixture_node("1", Some("0"), 0, true, "Bar", None),
        fixture_node("2", Some("0"), 1, true, "Other", None),
        fixture_node("11", Some("1"), 1, true, "Beta", None),
        fixture_node(
            "10",
            Some("1"),
            0,
            false,
            "Alpha",
            Some("https://example.com/Alpha"),
        ),
        fixture_node(
            "20",
            Some("11"),
            0,
            false,
            "Gamma",
            Some("https://example.com/Gamma"),
        ),
        fixture_node(
            "30",
            Some("2"),
            0,
            false,
            "Delta",
            Some("https://other.example/delta"),
        ),
    ]
}
fn created_event(profile: &Id, seq: u64, node: &BookmarkNode) -> WireMessage {
    serde_json::from_value(serde_json::json!({"type":"event","protocolVersion":1,"profileId":profile,"sessionId":"s","requestId":null,"seq":seq,"payload":{"sourceEpoch":1,"event":{"kind":"created","node":node}}})).unwrap()
}
fn tree_ids(nodes: &[CacheTreeNode]) -> Vec<&str> {
    let mut ids = Vec::new();
    for node in nodes {
        ids.push(node.node.chrome_id.as_str());
        ids.extend(tree_ids(&node.children));
    }
    ids
}

#[tokio::test]
async fn cache_reads_use_local_nodes_and_see_applied_creates() {
    let (bridge, _dir, _) = fixture().await;
    let missing = Id::new("missing-profile").unwrap();
    assert_eq!(
        bridge.tree(missing.clone(), None, None).await.unwrap_err(),
        ErrorCode::WrongProfile
    );
    assert_eq!(
        bridge
            .list(missing.clone(), Id::new("0").unwrap(), 0, 10)
            .await
            .unwrap_err(),
        ErrorCode::WrongProfile
    );
    assert_eq!(
        bridge
            .search(missing.clone(), "Alpha", None, 10)
            .await
            .unwrap_err(),
        ErrorCode::WrongProfile
    );
    assert_eq!(
        bridge
            .get(missing.clone(), Id::new("0").unwrap())
            .await
            .unwrap_err(),
        ErrorCode::WrongProfile
    );
    assert_eq!(
        bridge.count(missing, None).await.unwrap_err(),
        ErrorCode::WrongProfile
    );
    let (profile, secret) = paired(&bridge, "instance").await;
    let (other, _) = paired(&bridge, "other").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s", &secret))
        .await
        .unwrap();
    accept_tree(&bridge, &profile, "s", 0, library()).await;
    assert!(
        bridge
            .search(other, "Alpha", None, 10)
            .await
            .unwrap()
            .is_empty()
    );
    let full = bridge.tree(profile.clone(), None, Some(0)).await.unwrap();
    assert_eq!(
        bridge.tree(profile.clone(), None, None).await.unwrap(),
        full
    );
    assert_eq!(tree_ids(&full), vec!["0", "1", "10", "11", "20", "2", "30"]);
    let shallow = bridge
        .tree(profile.clone(), Some(Id::new("1").unwrap()), Some(1))
        .await
        .unwrap();
    assert_eq!(shallow[0].node.chrome_id.as_str(), "1");
    assert_eq!(shallow[0].children[0].node.chrome_id.as_str(), "10");
    assert_eq!(shallow[0].children[1].node.chrome_id.as_str(), "11");
    assert!(shallow[0].children[1].children.is_empty());
    let deep = bridge
        .tree(profile.clone(), Some(Id::new("1").unwrap()), Some(0))
        .await
        .unwrap();
    assert_eq!(
        deep[0].children[1].children[0].node.chrome_id.as_str(),
        "20"
    );
    assert_eq!(
        bridge
            .tree(profile.clone(), Some(Id::new("missing").unwrap()), None)
            .await
            .unwrap_err(),
        ErrorCode::InvalidTree
    );
    let page = bridge
        .list(profile.clone(), Id::new("1").unwrap(), 1, 1)
        .await
        .unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(page.items[0].chrome_id.as_str(), "11");
    let first = bridge
        .list(profile.clone(), Id::new("1").unwrap(), 0, 10)
        .await
        .unwrap();
    assert_eq!(first.items[0].chrome_id.as_str(), "10");
    assert!(
        !first
            .items
            .iter()
            .any(|node| node.chrome_id.as_str() == "20")
    );
    let past = bridge
        .list(profile.clone(), Id::new("1").unwrap(), 5, 1)
        .await
        .unwrap();
    assert!(past.items.is_empty());
    assert_eq!(past.total, 2);
    assert_eq!(
        bridge
            .list(profile.clone(), Id::new("10").unwrap(), 0, 10)
            .await
            .unwrap_err(),
        ErrorCode::InvalidTree
    );
    let urls = bridge
        .search(profile.clone(), "example.com", None, 10)
        .await
        .unwrap();
    assert_eq!(
        urls.iter()
            .map(|node| node.chrome_id.as_str())
            .collect::<Vec<_>>(),
        vec!["10", "20"]
    );
    assert!(
        bridge
            .search(profile.clone(), "EXAMPLE.COM", None, 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        bridge
            .search(profile.clone(), "alpha", None, 10)
            .await
            .unwrap()
            .is_empty()
    );
    let limited = bridge
        .search(profile.clone(), "example.com", None, 1)
        .await
        .unwrap();
    assert_eq!(limited.len(), 1);
    assert_eq!(limited[0].chrome_id.as_str(), "10");
    let scoped = bridge
        .search(profile.clone(), "Gamma", Some(Id::new("2").unwrap()), 10)
        .await
        .unwrap();
    assert!(scoped.is_empty());
    let inside = bridge
        .search(profile.clone(), "Gamma", Some(Id::new("1").unwrap()), 10)
        .await
        .unwrap();
    assert_eq!(inside[0].chrome_id.as_str(), "20");
    assert_eq!(
        bridge
            .search(profile.clone(), "", None, 10)
            .await
            .unwrap_err(),
        ErrorCode::InvalidMessage
    );
    let got = bridge
        .get(profile.clone(), Id::new("20").unwrap())
        .await
        .unwrap();
    assert_eq!(
        got.node.url.as_ref().unwrap().as_str(),
        "https://example.com/Gamma"
    );
    assert_eq!(
        got.ancestors.iter().map(Title::as_str).collect::<Vec<_>>(),
        vec!["root", "Bar", "Beta"]
    );
    assert!(
        bridge
            .get(profile.clone(), Id::new("0").unwrap())
            .await
            .unwrap()
            .ancestors
            .is_empty()
    );
    assert_eq!(
        bridge
            .get(profile.clone(), Id::new("missing").unwrap())
            .await
            .unwrap_err(),
        ErrorCode::InvalidTree
    );
    let counted = bridge.count(profile.clone(), None).await.unwrap();
    assert_eq!(counted.folders, 4);
    assert_eq!(counted.bookmarks, 3);
    let under = bridge
        .count(profile.clone(), Some(Id::new("1").unwrap()))
        .await
        .unwrap();
    assert_eq!(under.folders, 1);
    assert_eq!(under.bookmarks, 2);
    assert_eq!(
        bridge
            .count(profile.clone(), Some(Id::new("10").unwrap()))
            .await
            .unwrap_err(),
        ErrorCode::InvalidTree
    );
    assert!(
        bridge
            .search(profile.clone(), "Epsilon", None, 10)
            .await
            .unwrap()
            .is_empty()
    );
    let added = fixture_node(
        "40",
        Some("1"),
        2,
        false,
        "Epsilon",
        Some("https://example.com/Epsilon"),
    );
    assert!(
        !bridge
            .receive(created_event(&profile, 1, &added))
            .await
            .unwrap()
    );
    let found = bridge
        .search(profile.clone(), "Epsilon", None, 10)
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].chrome_id.as_str(), "40");
    assert_eq!(found[0].parent_id.as_ref().unwrap().as_str(), "1");
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
async fn live_profile_cache_wins_over_a_changed_file_mirror() {
    let personal = include_str!("../../../../tests/fixtures/bookmarks/bookmarks-personal.json");
    let updated = include_str!("../../../../tests/fixtures/bookmarks/bookmarks-updated.json");
    let local_state = include_str!("../../../../tests/fixtures/bookmarks/local-state-single.json");
    let (bridge, directory, _credentials) = fixture().await;
    let root = directory.path().join("User Data");
    let profile_dir = root.join("Default");
    std::fs::create_dir_all(&profile_dir).unwrap();
    std::fs::write(root.join("Local State"), local_state).unwrap();
    let bookmarks = profile_dir.join("Bookmarks");
    std::fs::write(&bookmarks, personal).unwrap();
    let nodes = crate::mirror::parse_bookmarks(personal.as_bytes()).unwrap();
    let (profile, secret) = paired(&bridge, "instance").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s", &secret))
        .await
        .unwrap();
    accept_tree(&bridge, &profile, "s", 0, nodes.clone()).await;
    assert_eq!(
        bridge
            .state()
            .await
            .profiles
            .iter()
            .find(|item| item.profile_id == profile)
            .unwrap()
            .connection,
        BridgeConnection::Live
    );
    let before = std::fs::read(&bookmarks).unwrap();
    let before_modified = std::fs::metadata(&bookmarks).unwrap().modified().unwrap();
    let local_state_file = snapshot_file(&root.join("Local State"));
    let attached = bridge
        .attach_file_mirror(root.to_str().unwrap().to_owned(), "Default".into())
        .await
        .unwrap();
    let mirror_id = attached.mirrors[0].mirror_source_id.clone();
    assert!(!attached.mirrors[0].can_write_browser);
    let associated = bridge
        .associate_file_mirror(mirror_id.clone(), profile.clone())
        .await
        .unwrap();
    assert_eq!(
        associated.mirrors[0].association,
        MirrorAssociation::Confirmed
    );
    assert!(!associated.mirrors[0].can_write_browser);
    assert_eq!(
        bridge
            .authorize_browser_write(mirror_id.clone())
            .await
            .unwrap_err(),
        ErrorCode::ReadOnly
    );
    assert!(
        bridge
            .authorize_browser_write(profile.clone())
            .await
            .is_ok()
    );
    assert_eq!(std::fs::read(&bookmarks).unwrap(), before);
    assert_eq!(
        std::fs::metadata(&bookmarks).unwrap().modified().unwrap(),
        before_modified
    );
    assert_eq!(snapshot_file(&root.join("Local State")), local_state_file);
    std::fs::write(&bookmarks, updated).unwrap();
    let written = std::fs::read(&bookmarks).unwrap();
    let written_modified = std::fs::metadata(&bookmarks).unwrap().modified().unwrap();
    bridge.rescan_file_mirrors().await.unwrap();
    assert_eq!(std::fs::read(&bookmarks).unwrap(), written);
    assert_eq!(
        std::fs::metadata(&bookmarks).unwrap().modified().unwrap(),
        written_modified
    );
    assert_eq!(snapshot_file(&root.join("Local State")), local_state_file);
    assert_eq!(cached_tree(&bridge, &profile).await, sorted_tree(nodes));
    let tree = bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert_eq!(tree.association, MirrorAssociation::Independent);
    assert!(!tree.can_write_browser);
    assert!(tree.nodes.iter().any(|node| {
        node.url
            .as_ref()
            .is_some_and(|url| url.as_str() == "https://example.com/b")
    }));
    assert_eq!(
        bridge
            .associate_file_mirror(mirror_id, profile.clone())
            .await
            .unwrap_err(),
        ErrorCode::WrongProfile
    );
    bridge
        .disconnected(&profile, &Id::new("s").unwrap(), None)
        .await;
    assert_eq!(
        bridge.authorize_browser_write(profile).await.unwrap_err(),
        ErrorCode::ReadOnly
    );
    assert_no_bookmarks_bak(&root);
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
async fn edit_requires_a_live_session_and_keeps_chrome_unchanged_when_backup_or_send_fails() {
    let (bridge, directory, _credentials) = fixture().await;
    let (profile, secret) = paired(&bridge, "instance").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s", &secret))
        .await
        .unwrap();
    let rename = EditAction::Update {
        chrome_id: Id::new("42").unwrap(),
        title: Some(Title::new("renamed").unwrap()),
        url: None,
    };
    assert_eq!(
        bridge
            .apply_edit(profile.clone(), 0, rename.clone(), false)
            .await
            .unwrap_err(),
        ErrorCode::ReadOnly
    );
    accept_tree(&bridge, &profile, "s", 0, nodes()).await;
    let revision = bridge
        .state()
        .await
        .profiles
        .iter()
        .find(|item| item.profile_id == profile)
        .unwrap()
        .revision
        .get();
    let (tx, mut rx) = mpsc::unbounded_channel();
    bridge
        .bind_outbound(&profile, &Id::new("s").unwrap(), tx)
        .await;
    let preview = bridge
        .preview_edit(profile.clone(), revision, rename.clone())
        .await
        .unwrap();
    assert!(preview.writable);
    assert!(rx.try_recv().is_err());
    let protected = bridge
        .preview_edit(
            profile.clone(),
            revision,
            EditAction::Delete {
                chrome_id: Id::new("0").unwrap(),
            },
        )
        .await
        .unwrap();
    assert!(!protected.writable);
    assert_eq!(protected.error_code.0, Some(ErrorCode::ProtectedNode));
    assert_eq!(
        bridge
            .apply_edit(
                profile.clone(),
                revision,
                EditAction::Delete {
                    chrome_id: Id::new("0").unwrap(),
                },
                false,
            )
            .await
            .unwrap_err(),
        ErrorCode::ProtectedNode
    );
    assert!(rx.try_recv().is_err());
    {
        let mut inner = bridge.inner.lock().await;
        let blocker = directory.path().join("not-a-directory");
        std::fs::write(&blocker, b"x").unwrap();
        inner.backup_dir = blocker.join("backups");
    }
    assert_eq!(
        bridge
            .apply_edit(profile.clone(), revision, rename.clone(), false)
            .await
            .unwrap_err(),
        ErrorCode::StorageError
    );
    assert!(rx.try_recv().is_err());
    assert!(
        bridge
            .list_operations(profile.clone())
            .await
            .unwrap()
            .operations
            .is_empty()
    );
    {
        let mut inner = bridge.inner.lock().await;
        inner.backup_dir = directory.path().join("backups");
    }
    drop(rx);
    assert_eq!(
        bridge
            .apply_edit(profile.clone(), revision, rename.clone(), false)
            .await
            .unwrap_err(),
        ErrorCode::ReadOnly
    );
    let failed = bridge.list_operations(profile.clone()).await.unwrap();
    assert_eq!(failed.operations.len(), 1);
    assert_eq!(failed.operations[0].state, OperationState::Failed);
    let (tx, mut rx) = mpsc::unbounded_channel();
    bridge
        .bind_outbound(&profile, &Id::new("s").unwrap(), tx)
        .await;
    let applied = bridge
        .apply_edit(profile.clone(), revision, rename, false)
        .await
        .unwrap();
    assert_eq!(applied.state, OperationState::Applying);
    let WireMessage::ApplyOperation { payload, .. } = rx.try_recv().unwrap() else {
        panic!("missing apply");
    };
    let html = std::fs::read_dir(directory.path().join("backups"))
        .unwrap()
        .count();
    assert!(html >= 2);
    let stem = payload.operation_id.as_str().replace(':', "-");
    let html_body = std::fs::read_to_string(
        directory
            .path()
            .join("backups")
            .join(format!("{stem}.html")),
    )
    .unwrap();
    let sidecar = std::fs::read_to_string(
        directory
            .path()
            .join("backups")
            .join(format!("{stem}.json")),
    )
    .unwrap();
    assert!(html_body.contains("<!DOCTYPE NETSCAPE-Bookmark-file-1>"));
    assert!(html_body.contains("<DL><p>"));
    assert!(sidecar.contains("\"schemaVersion\":1"));
    assert!(!sidecar.contains("<DL>"));
    assert_eq!(
        bridge
            .apply_edit(
                profile.clone(),
                revision,
                EditAction::Update {
                    chrome_id: Id::new("42").unwrap(),
                    title: Some(Title::new("again").unwrap()),
                    url: None,
                },
                false,
            )
            .await
            .unwrap_err(),
        ErrorCode::Conflict
    );
    assert!(rx.try_recv().is_err());
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
async fn undo_conflict_does_not_send_a_browser_write() {
    let (bridge, _directory, _credentials) = fixture().await;
    let (profile, secret) = paired(&bridge, "instance").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s", &secret))
        .await
        .unwrap();
    accept_tree(&bridge, &profile, "s", 0, nodes()).await;
    let revision = bridge
        .state()
        .await
        .profiles
        .iter()
        .find(|item| item.profile_id == profile)
        .unwrap()
        .revision
        .get();
    let (tx, mut rx) = mpsc::unbounded_channel();
    bridge
        .bind_outbound(&profile, &Id::new("s").unwrap(), tx)
        .await;
    let rename = EditAction::Update {
        chrome_id: Id::new("42").unwrap(),
        title: Some(Title::new("renamed").unwrap()),
        url: None,
    };
    bridge
        .apply_edit(profile.clone(), revision, rename, false)
        .await
        .unwrap();
    let WireMessage::ApplyOperation { payload, .. } = rx.try_recv().unwrap() else {
        panic!("missing apply");
    };
    let before = payload.steps[0].expected_before.clone().unwrap();
    let mut after = before.clone();
    after.title = Title::new("renamed").unwrap();
    let session = Id::new("s").unwrap();
    let receipt = envelope(
        "operation_receipt",
        &profile,
        &session,
        Some(payload.steps[0].request_id.clone()),
        serde_json::json!({
            "operationId": payload.operation_id,
            "requestId": payload.steps[0].request_id,
            "state": "applied",
            "before": before,
            "after": after,
            "beforeChildIds": null,
            "afterChildIds": null,
            "errorCode": null
        }),
    )
    .unwrap();
    assert!(!bridge.receive(receipt).await.unwrap());
    for (seq, title) in [(1_u64, "renamed"), (2, "external")] {
        let event: WireMessage = serde_json::from_value(serde_json::json!({
            "type": "event",
            "protocolVersion": 1,
            "profileId": profile,
            "sessionId": session,
            "requestId": null,
            "seq": seq,
            "payload": { "sourceEpoch": 1, "event": { "kind": "changed", "chromeId": "42", "title": title, "url": "https://example.com/" } }
        }))
        .unwrap();
        assert!(!bridge.receive(event).await.unwrap());
    }
    let revision = bridge
        .state()
        .await
        .profiles
        .iter()
        .find(|item| item.profile_id == profile)
        .unwrap()
        .revision
        .get();
    let undone = bridge
        .apply_edit(
            profile.clone(),
            revision,
            EditAction::Undo {
                operation_id: payload.operation_id.clone(),
            },
            false,
        )
        .await
        .unwrap();
    assert_eq!(undone.state, OperationState::RollbackConflict);
    assert_eq!(undone.error_code.0, Some(ErrorCode::Conflict));
    assert!(rx.try_recv().is_err());
    let current = cached_tree(&bridge, &profile).await;
    assert_eq!(
        current
            .iter()
            .find(|node| node.chrome_id.as_str() == "42")
            .unwrap()
            .title
            .as_str(),
        "external"
    );
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
async fn websocket_operation_receipt_stays_applied_and_connected() {
    let (bridge, _dir, _) = fixture().await;
    let (profile, secret) = paired(&bridge, "instance").await;
    let port = bridge.state().await.port.0.unwrap();
    let url = format!("ws://127.0.0.1:{port}/");
    let mut request = url.as_str().into_client_request().unwrap();
    request
        .headers_mut()
        .insert("Origin", origin().as_str().parse().unwrap());
    let (mut ws, _) = connect_async(request).await.unwrap();
    let hello_message = hello(&profile, "instance", "socket-1", &secret);
    ws.send(Message::Text(
        String::from_utf8(encode_frame(&hello_message).unwrap())
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();
    let session = Id::new("socket-1").unwrap();
    let mut tree_request = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    while tree_request.is_none() && tokio::time::Instant::now() < deadline {
        if let WireMessage::GetTree { request_id, .. } = next_frame(&mut ws).await {
            tree_request = request_id.0;
        }
    }
    let full = envelope(
        "tree_full",
        &profile,
        &session,
        Some(tree_request.expect("get_tree")),
        serde_json::to_value(TreeSnapshot {
            source_epoch: SourceEpoch::new(1).unwrap(),
            revision: Counter::new(0).unwrap(),
            barrier_seq: Counter::new(0).unwrap(),
            nodes: nodes(),
        })
        .unwrap(),
    )
    .unwrap();
    ws.send(Message::Text(
        String::from_utf8(encode_frame(&full).unwrap())
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();
    let revision = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Some(item) = bridge.state().await.profiles.into_iter().find(|item| {
                item.profile_id == profile && item.connection == BridgeConnection::Live
            }) {
                return item.revision.get();
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("live");
    let operation = bridge
        .apply_edit(
            profile.clone(),
            revision,
            EditAction::Update {
                chrome_id: Id::new("42").unwrap(),
                title: Some(Title::new("renamed").unwrap()),
                url: None,
            },
            false,
        )
        .await
        .unwrap();
    let mut steps = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    while steps.is_none() && tokio::time::Instant::now() < deadline {
        if let WireMessage::ApplyOperation { payload, .. } = next_frame(&mut ws).await {
            steps = Some(payload.steps);
        }
    }
    let steps = steps.expect("apply");
    let before = steps[0].expected_before.clone().unwrap();
    let mut after = before.clone();
    after.title = Title::new("renamed").unwrap();
    let receipt = envelope(
        "operation_receipt",
        &profile,
        &session,
        Some(steps[0].request_id.clone()),
        serde_json::json!({
            "operationId": operation.operation_id,
            "requestId": steps[0].request_id,
            "state": "applied",
            "before": before,
            "after": after,
            "beforeChildIds": null,
            "afterChildIds": null,
            "errorCode": null
        }),
    )
    .unwrap();
    ws.send(Message::Text(
        String::from_utf8(encode_frame(&receipt).unwrap())
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();
    let state = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let list = bridge.list_operations(profile.clone()).await.unwrap();
            if let Some(item) = list
                .operations
                .into_iter()
                .find(|item| item.operation_id == operation.operation_id)
                && item.state != OperationState::Applying
            {
                return item.state;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("receipt");
    assert_eq!(state, OperationState::Applied);
    let ping = envelope(
        "ping",
        &profile,
        &session,
        Some(Id::new("ping-1").unwrap()),
        serde_json::json!({}),
    )
    .unwrap();
    ws.send(Message::Text(
        String::from_utf8(encode_frame(&ping).unwrap())
            .unwrap()
            .into(),
    ))
    .await
    .unwrap();
    let pong = tokio::time::timeout(Duration::from_secs(2), next_frame(&mut ws))
        .await
        .expect("session closed");
    assert!(matches!(pong, WireMessage::Pong { .. }));
    bridge.shutdown().await.unwrap();
}

async fn next_frame(
    ws: &mut (
             impl StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
             + Unpin
         ),
) -> WireMessage {
    let message = ws.next().await.expect("socket closed").unwrap();
    parse_frame(message.into_text().unwrap().as_bytes()).unwrap()
}

fn snapshot_file(path: &std::path::Path) -> (Vec<u8>, std::time::SystemTime) {
    let meta = std::fs::metadata(path).unwrap();
    (std::fs::read(path).unwrap(), meta.modified().unwrap())
}

#[tokio::test]
async fn confirmed_ai_title_uses_the_edit_path_and_undo_sends_the_previous_title() {
    let directory = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryCredentials::default());
    let transport = Arc::new(crate::ai::ScriptedTransport::new(vec![crate::ai::ScriptedStep::Respond {
        status: 200,
        body: serde_json::json!({"message":{"content":"{\"title\":\"短标题\",\"tags\":[\"资料\"],\"summary\":\"一句摘要\",\"suggestedFolder\":\"阅读\",\"evidence\":\"摘录\"}"}}).to_string(),
        retry_after: None,
    }]));
    let bridge = Bridge::open_with_ai(
        directory.path().join("cache.sqlite"),
        store.clone(),
        Arc::new(MemoryCredentials::default()),
        transport.clone(),
    )
    .await
    .unwrap();
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = socket.local_addr().unwrap().port();
    drop(socket);
    bridge.start(port).await.unwrap();
    let (profile, secret) = paired(&bridge, "instance").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s", &secret))
        .await
        .unwrap();
    accept_tree(&bridge, &profile, "s", 0, nodes()).await;
    bridge
        .save_ai_config(
            true,
            "ollama".into(),
            "http://127.0.0.1:11434".into(),
            "qwen2.5:7b".into(),
        )
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::unbounded_channel();
    bridge
        .bind_outbound(&profile, &Id::new("s").unwrap(), tx)
        .await;
    assert_eq!(transport.calls(), 0);
    let suggestion = bridge
        .suggest_ai(
            profile.clone(),
            Id::new("42").unwrap(),
            Id::new("ai-live").unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(suggestion.state, AiJobState::Ready);
    assert_eq!(suggestion.title.0.as_deref(), Some("短标题"));
    assert_eq!(transport.calls(), 1);
    assert!(
        transport
            .urls()
            .await
            .iter()
            .all(|url| url == "http://127.0.0.1:11434/api/chat")
    );
    assert!(rx.try_recv().is_err());
    assert!(
        bridge
            .list_operations(profile.clone())
            .await
            .unwrap()
            .operations
            .is_empty()
    );
    assert_eq!(
        cached_tree(&bridge, &profile)
            .await
            .iter()
            .find(|node| node.chrome_id.as_str() == "42")
            .unwrap()
            .title
            .as_str(),
        "synthetic"
    );
    let audit = bridge.ai_audit_lines().join("\n");
    assert!(!audit.contains("synthetic"));
    assert!(!audit.contains("example.com"));

    {
        let mut inner = bridge.inner.lock().await;
        inner
            .profiles
            .get_mut(profile.as_str())
            .unwrap()
            .view
            .connection = BridgeConnection::CachedReadOnly;
    }
    let draft = AiDraft {
        job_id: suggestion.job_id.clone(),
        profile_id: profile.clone(),
        chrome_id: Id::new("42").unwrap(),
        input_fingerprint: suggestion.input_fingerprint.clone(),
        title: "改过的标题".into(),
        tags: vec!["资料".into()],
        summary: RequiredNullable(Some("一句摘要".into())),
        apply_title: true,
        apply_tags: true,
        apply_summary: true,
    };
    assert_eq!(
        bridge.apply_ai(draft.clone()).await.unwrap_err(),
        ErrorCode::ReadOnly
    );
    assert!(
        bridge
            .list_operations(profile.clone())
            .await
            .unwrap()
            .operations
            .is_empty()
    );
    {
        let mut inner = bridge.inner.lock().await;
        inner
            .profiles
            .get_mut(profile.as_str())
            .unwrap()
            .view
            .connection = BridgeConnection::Live;
    }
    let applied = bridge.apply_ai(draft).await.unwrap();
    assert!(applied.failure.0.is_none());
    assert!(applied.tags_applied && applied.summary_applied);
    let browser = applied.browser.0.expect("browser operation");
    assert_eq!(browser.state, OperationState::Applying);
    let WireMessage::ApplyOperation { payload, .. } = rx.try_recv().unwrap() else {
        panic!("missing apply");
    };
    assert!(
        matches!(payload.steps[0].payload, Mutation::Update { title: Some(ref title), url: None } if title.as_str() == "改过的标题")
    );
    assert_eq!(transport.calls(), 1);
    let before = payload.steps[0].expected_before.clone().unwrap();
    let mut after = before.clone();
    after.title = Title::new("改过的标题").unwrap();
    let session = Id::new("s").unwrap();
    let receipt = envelope(
        "operation_receipt",
        &profile,
        &session,
        Some(payload.steps[0].request_id.clone()),
        serde_json::json!({
            "operationId": browser.operation_id,
            "requestId": payload.steps[0].request_id,
            "state": "applied",
            "before": before,
            "after": after,
            "beforeChildIds": null,
            "afterChildIds": null,
            "errorCode": null
        }),
    )
    .unwrap();
    assert!(!bridge.receive(receipt).await.unwrap());
    let event = changed_event(&profile, 1, "改过的标题");
    assert!(!bridge.receive(event).await.unwrap());
    let revision = bridge
        .state()
        .await
        .profiles
        .iter()
        .find(|item| item.profile_id == profile)
        .unwrap()
        .revision
        .get();
    let undone = bridge
        .apply_edit(
            profile.clone(),
            revision,
            EditAction::Undo {
                operation_id: browser.operation_id.clone(),
            },
            false,
        )
        .await
        .unwrap();
    assert_eq!(undone.state, OperationState::RollingBack);
    let WireMessage::ApplyOperation { payload, .. } = rx.try_recv().unwrap() else {
        panic!("missing undo");
    };
    assert!(matches!(
        payload.steps[0].payload,
        Mutation::Update { title: Some(ref title), url: Some(ref url) }
            if title.as_str() == "synthetic" && url.as_str() == "https://example.com/"
    ));
    let metadata = bridge
        .inner
        .lock()
        .await
        .storage()
        .unwrap()
        .metadata(suggestion.bookmark_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(metadata.summary.as_deref(), Some("一句摘要"));
    assert_eq!(metadata.note, "");
    let catalog = bridge
        .tag_catalog(profile.clone(), vec![Id::new("42").unwrap()], None)
        .await
        .unwrap();
    assert!(catalog.tags.iter().any(|tag| tag.name == "资料"));
    bridge.shutdown().await.unwrap();
}

#[tokio::test]
#[ignore = "ReqwestTransport against a loopback chat process; not the default suite"]
async fn reqwest_ten_public_pages_apply_undo_and_cached_suggest() {
    let base = std::env::var("MARKBRIDGE_AI_BASE").expect("MARKBRIDGE_AI_BASE");
    let model = std::env::var("MARKBRIDGE_AI_MODEL").expect("MARKBRIDGE_AI_MODEL");
    let evidence = std::env::var("MARKBRIDGE_AI_EVIDENCE").expect("MARKBRIDGE_AI_EVIDENCE");
    let log_path = std::env::var("MARKBRIDGE_AI_LOG").expect("MARKBRIDGE_AI_LOG");
    assert!(base.starts_with("http://127.0.0.1:"), "{base}");
    assert!(!base.contains("0.0.0.0"));
    let directory = tempfile::tempdir().unwrap();
    let app_data = directory.path().display().to_string();
    assert!(
        !app_data
            .to_ascii_lowercase()
            .contains("com.markbridge.desktop")
    );
    let pairing = Arc::new(MemoryCredentials::default());
    let models = Arc::new(MemoryCredentials::default());
    let bridge = Bridge::open_with_model_store(
        directory.path().join("cache.sqlite"),
        pairing.clone(),
        models.clone(),
    )
    .await
    .unwrap();
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = socket.local_addr().unwrap().port();
    drop(socket);
    bridge.start(port).await.unwrap();
    let (profile, secret) = paired(&bridge, "instance").await;
    bridge
        .authenticate(&origin(), &hello(&profile, "instance", "s", &secret))
        .await
        .unwrap();
    let pages = live_pages();
    let mut nodes = vec![fixture_node("root", None, 0, true, "root", None)];
    for (index, (chrome_id, title, url)) in pages.iter().enumerate() {
        nodes.push(fixture_node(
            chrome_id,
            Some("root"),
            index as u64,
            false,
            title,
            Some(url),
        ));
    }
    accept_tree(&bridge, &profile, "s", 0, nodes).await;
    let (tx, mut rx) = mpsc::unbounded_channel();
    bridge
        .bind_outbound(&profile, &Id::new("s").unwrap(), tx)
        .await;
    let settings = bridge
        .save_ai_config(true, "ollama".into(), base.clone(), model.clone())
        .await
        .unwrap();
    assert!(!settings.credential_configured);
    assert!(models.0.lock().unwrap().is_empty());
    let mut report = serde_json::json!({
        "entry": "Bridge::open_with_model_store",
        "transport": "ReqwestTransport",
        "provider": "ollama",
        "model": model,
        "base": base,
        "appData": app_data,
        "credentialConfigured": settings.credential_configured,
        "pages": [],
    });
    let mut ready: Option<LiveReady> = None;
    let mut cached: Option<LiveReady> = None;
    for (chrome_id, title, url) in &pages {
        let before_log = log_rows(&log_path).len();
        let preview = bridge
            .content_preview(
                profile.clone(),
                Id::new(*chrome_id).unwrap(),
                Id::new(format!("pv-{chrome_id}")).unwrap(),
            )
            .await;
        let (preview_status, preview_failure) = match &preview {
            Ok(value) => (
                Some(json_name(&value.status)),
                value.failure.0.map(|failure| json_name(&failure)),
            ),
            Err(error) => (None, Some(error.to_string())),
        };
        let suggestion = bridge
            .suggest_ai(
                profile.clone(),
                Id::new(*chrome_id).unwrap(),
                Id::new(format!("ai-{chrome_id}")).unwrap(),
            )
            .await;
        let calls = log_rows(&log_path);
        let new_calls = calls.get(before_log..).unwrap_or(&[]);
        let row = page_row(
            url,
            title,
            preview_status,
            preview_failure,
            suggestion.as_ref(),
            new_calls,
            &bridge,
        )
        .await;
        if ready.is_none()
            && row["state"] == "ready"
            && row["evidenceInRequest"] == true
            && let Ok(suggestion) = &suggestion
        {
            ready = Some(LiveReady {
                chrome_id: (*chrome_id).to_owned(),
                title: (*title).to_owned(),
                url: (*url).to_owned(),
                suggestion: suggestion.clone(),
            });
        }
        if cached.is_none()
            && row["scopeCachedText"] == true
            && row["state"] == "ready"
            && let Ok(suggestion) = &suggestion
        {
            cached = Some(LiveReady {
                chrome_id: (*chrome_id).to_owned(),
                title: (*title).to_owned(),
                url: (*url).to_owned(),
                suggestion: suggestion.clone(),
            });
        }
        report["pages"].as_array_mut().unwrap().push(row);
        write_report(&evidence, &report);
    }
    let cached = cached.expect("no cached suggestion");
    let before = cache_stamp(&bridge, cached.suggestion.bookmark_id.clone(), &cached.url)
        .await
        .expect("cache missing before prepared suggest");
    let before_log = log_rows(&log_path).len();
    let pid = std::process::id();
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let foreign = std::sync::Arc::new(StdMutex::new(Vec::<String>::new()));
    let samples = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sampler = {
        let stop = stop.clone();
        let foreign = foreign.clone();
        let samples = samples.clone();
        std::thread::spawn(move || {
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                samples.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                for remote in established_foreign(pid) {
                    let mut found = foreign.lock().unwrap();
                    if !found.contains(&remote) {
                        found.push(remote);
                    }
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        })
    };
    let started = std::time::Instant::now();
    let prepared = bridge
        .suggest_ai(
            profile.clone(),
            Id::new(&cached.chrome_id).unwrap(),
            Id::new("ai-cache").unwrap(),
        )
        .await;
    let elapsed_ms = started.elapsed().as_millis();
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    sampler.join().unwrap();
    let after = cache_stamp(&bridge, cached.suggestion.bookmark_id.clone(), &cached.url)
        .await
        .expect("cache missing after prepared suggest");
    let calls = log_rows(&log_path);
    let new_calls = calls.get(before_log..).unwrap_or(&[]);
    let prepared_row = page_row(
        &cached.url,
        &cached.title,
        Some("cache".to_owned()),
        None,
        prepared.as_ref(),
        new_calls,
        &bridge,
    )
    .await;
    report["prepared"] = serde_json::json!({
        "page": prepared_row,
        "fetchedAtBefore": before.0,
        "fetchedAtAfter": after.0,
        "fetchedAtUnchanged": before.0 == after.0,
        "excerptCharsBefore": before.1.chars().count(),
        "excerptUnchanged": before.1 == after.1,
        "publicFetchObserved": !foreign.lock().unwrap().is_empty(),
        "foreignEstablished": foreign.lock().unwrap().clone(),
        "tcpSamples": samples.load(std::sync::atomic::Ordering::Relaxed),
        "elapsedMs": elapsed_ms,
        "contentPreviewCalled": false,
    });
    let ready = ready.expect("no ready suggestion");
    {
        let mut inner = bridge.inner.lock().await;
        inner
            .profiles
            .get_mut(profile.as_str())
            .unwrap()
            .view
            .connection = BridgeConnection::CachedReadOnly;
    }
    let draft = AiDraft {
        job_id: ready.suggestion.job_id.clone(),
        profile_id: profile.clone(),
        chrome_id: Id::new(&ready.chrome_id).unwrap(),
        input_fingerprint: ready.suggestion.input_fingerprint.clone(),
        title: "已确认标题".into(),
        tags: Vec::new(),
        summary: RequiredNullable(None),
        apply_title: true,
        apply_tags: false,
        apply_summary: false,
    };
    let readonly = bridge.apply_ai(draft.clone()).await.unwrap_err();
    let operations_after_readonly = bridge
        .list_operations(profile.clone())
        .await
        .unwrap()
        .operations
        .len();
    {
        let mut inner = bridge.inner.lock().await;
        inner
            .profiles
            .get_mut(profile.as_str())
            .unwrap()
            .view
            .connection = BridgeConnection::Live;
    }
    let applied = bridge.apply_ai(draft).await.unwrap();
    let WireMessage::ApplyOperation { payload, .. } = rx.try_recv().unwrap() else {
        panic!("missing apply");
    };
    let apply_title = match &payload.steps[0].payload {
        Mutation::Update {
            title: Some(title),
            url: None,
        } => title.as_str().to_owned(),
        other => panic!("apply payload {other:?}"),
    };
    let before_node = payload.steps[0].expected_before.clone().unwrap();
    let mut after_node = before_node.clone();
    after_node.title = Title::new("已确认标题").unwrap();
    let session = Id::new("s").unwrap();
    let browser = applied.browser.0.clone().unwrap();
    let receipt = envelope(
        "operation_receipt",
        &profile,
        &session,
        Some(payload.steps[0].request_id.clone()),
        serde_json::json!({
            "operationId": browser.operation_id,
            "requestId": payload.steps[0].request_id,
            "state": "applied",
            "before": before_node,
            "after": after_node,
            "beforeChildIds": null,
            "afterChildIds": null,
            "errorCode": null
        }),
    )
    .unwrap();
    assert!(!bridge.receive(receipt).await.unwrap());
    let event = title_event(&profile, &ready.chrome_id, 1, "已确认标题", &ready.url);
    assert!(!bridge.receive(event).await.unwrap());
    let revision = bridge
        .state()
        .await
        .profiles
        .iter()
        .find(|item| item.profile_id == profile)
        .unwrap()
        .revision
        .get();
    let undone = bridge
        .apply_edit(
            profile.clone(),
            revision,
            EditAction::Undo {
                operation_id: browser.operation_id.clone(),
            },
            false,
        )
        .await
        .unwrap();
    let WireMessage::ApplyOperation { payload, .. } = rx.try_recv().unwrap() else {
        panic!("missing undo");
    };
    let (undo_title, undo_url) = match &payload.steps[0].payload {
        Mutation::Update {
            title: Some(title),
            url: Some(url),
        } => (title.as_str().to_owned(), url.as_str().to_owned()),
        other => panic!("undo payload {other:?}"),
    };
    report["apply"] = serde_json::json!({
        "url": ready.url,
        "chromeId": ready.chrome_id,
        "readonly": readonly.to_string(),
        "operationsAfterReadonly": operations_after_readonly,
        "applyState": json_name(&browser.state),
        "applyTitle": apply_title,
        "applyFailure": applied.failure.0.map(|failure| json_name(&failure)),
        "undoState": json_name(&undone.state),
        "undoTitle": undo_title,
        "undoUrl": undo_url,
    });
    let audit = bridge.ai_audit_lines();
    assert!(
        !audit
            .iter()
            .any(|line| line.contains(&secret) || line.contains("http"))
    );
    report["auditHasUrl"] = serde_json::Value::Bool(false);
    report["auditLines"] =
        serde_json::Value::Array(audit.into_iter().map(serde_json::Value::String).collect());
    write_report(&evidence, &report);
    assert!(models.0.lock().unwrap().is_empty());
    assert_eq!(report["pages"].as_array().unwrap().len(), 10);
    assert!(
        report["pages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["called"] == true)
    );
    assert_eq!(report["prepared"]["fetchedAtUnchanged"], true);
    assert_eq!(report["prepared"]["excerptUnchanged"], true);
    assert_eq!(report["prepared"]["publicFetchObserved"], false);
    assert!(report["prepared"]["tcpSamples"].as_u64().unwrap() >= 1);
    assert_eq!(report["prepared"]["page"]["state"], "ready");
    assert_eq!(report["prepared"]["page"]["evidenceInRequest"], true);
    assert_eq!(report["prepared"]["page"]["evidenceInCache"], true);
    assert_eq!(report["prepared"]["page"]["scopeCachedText"], true);
    assert_eq!(report["prepared"]["page"]["cacheHashMatchesRequest"], true);
    assert_eq!(report["apply"]["readonly"], "READ_ONLY");
    assert_eq!(report["apply"]["operationsAfterReadonly"], 0);
    assert_eq!(report["apply"]["applyState"], "applying");
    assert_eq!(report["apply"]["applyTitle"], "已确认标题");
    assert_eq!(report["apply"]["undoState"], "rolling_back");
    assert_eq!(report["apply"]["undoTitle"], ready.title);
    assert_eq!(report["apply"]["undoUrl"], ready.url);
    for row in report["pages"].as_array().unwrap() {
        if row["state"] == "ready" {
            assert_eq!(row["evidenceInRequest"], true);
            assert_eq!(row["endpointLogged"], true);
        }
    }
    bridge.shutdown().await.unwrap();
}

struct LiveReady {
    chrome_id: String,
    title: String,
    url: String,
    suggestion: AiSuggestion,
}

fn live_pages() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("b01", "t01", "https://example.com/"),
        ("b02", "t02", "https://example.org/"),
        ("b03", "t03", "https://example.net/"),
        ("b04", "t04", "https://httpbin.org/html"),
        ("b05", "t05", "https://www.iana.org/domains/reserved"),
        ("b06", "t06", "https://www.w3.org/"),
        ("b07", "t07", "https://www.gnu.org/philosophy/free-sw.html"),
        ("b08", "t08", "https://www.wikipedia.org/"),
        ("b09", "t09", "https://www.rust-lang.org/"),
        ("b10", "t10", "https://docs.python.org/3/library/index.html"),
    ]
}

fn title_event(profile: &Id, chrome_id: &str, seq: u64, title: &str, url: &str) -> WireMessage {
    serde_json::from_value(serde_json::json!({
        "type": "event",
        "protocolVersion": 1,
        "profileId": profile,
        "sessionId": "s",
        "requestId": null,
        "seq": seq,
        "payload": {
            "sourceEpoch": 1,
            "event": {"kind": "changed", "chromeId": chrome_id, "title": title, "url": url}
        }
    }))
    .unwrap()
}

fn log_rows(path: &str) -> Vec<serde_json::Value> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    text.lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

fn write_report(path: &str, report: &serde_json::Value) {
    std::fs::write(path, serde_json::to_string_pretty(report).unwrap()).unwrap();
}

fn json_name<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

fn sha256_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn cache_stamp(bridge: &Bridge, bookmark_id: Id, url: &str) -> Option<(u64, String)> {
    let parsed = url::Url::parse(url).ok()?;
    let fingerprint = crate::preview::url_fingerprint(&parsed);
    let storage = {
        let inner = bridge.inner.lock().await;
        inner.storage().ok()?.share()
    };
    storage
        .cached_text(bookmark_id, fingerprint)
        .await
        .ok()
        .flatten()
        .map(|(text, fetched)| (fetched, text))
}

async fn page_row(
    url: &str,
    title: &str,
    preview_status: Option<String>,
    preview_failure: Option<String>,
    suggestion: std::result::Result<&AiSuggestion, &ErrorCode>,
    calls: &[serde_json::Value],
    bridge: &Bridge,
) -> serde_json::Value {
    let endpoint_logged = !calls.is_empty();
    let forbidden_clear = calls.iter().all(|call| {
        call["forbidden"]
            .as_array()
            .is_some_and(|items| items.is_empty())
            && call["auth"] == false
    });
    match suggestion {
        Err(error) => serde_json::json!({
            "url": url,
            "bookmarkTitle": title,
            "called": true,
            "previewStatus": preview_status,
            "previewFailure": preview_failure,
            "error": error.to_string(),
            "state": null,
            "failure": null,
            "endpoint": null,
            "model": null,
            "endpointLogged": endpoint_logged,
            "forbiddenClear": forbidden_clear,
            "evidenceInRequest": false,
            "evidenceInCache": false,
            "scopeCachedText": false,
        }),
        Ok(suggestion) => {
            let evidence = suggestion.evidence.0.clone();
            let matched = evidence.as_ref().is_some_and(|evidence| {
                calls.iter().any(|call| {
                    call["quoted"] == true && call["evidence"].as_str() == Some(evidence)
                })
            });
            let cache = cache_stamp(bridge, suggestion.bookmark_id.clone(), url).await;
            let sent = cache
                .as_ref()
                .map(|(_, text)| text.chars().take(2_000).collect::<String>());
            let evidence_in_cache = evidence.as_ref().is_some_and(|evidence| {
                sent.as_ref()
                    .is_some_and(|text| text.contains(evidence.as_str()))
            });
            let hash_matches = sent.as_ref().is_some_and(|text| {
                let hash = sha256_hex(text);
                calls
                    .iter()
                    .any(|call| call["pageSha256"].as_str() == Some(hash.as_str()))
            });
            serde_json::json!({
                "url": url,
                "bookmarkTitle": title,
                "called": true,
                "previewStatus": preview_status,
                "previewFailure": preview_failure,
                "error": null,
                "state": json_name(&suggestion.state),
                "failure": suggestion.failure.0.map(|failure| json_name(&failure)),
                "failureMessage": suggestion.failure_message.0,
                "endpoint": suggestion.endpoint_label.0,
                "model": suggestion.model.0,
                "title": suggestion.title.0,
                "tags": suggestion.tags,
                "summary": suggestion.summary.0,
                "suggestedFolder": suggestion.suggested_folder.0,
                "evidence": evidence,
                "scopeCachedText": suggestion.scope.includes_cached_text,
                "excerptChars": suggestion.scope.excerpt_chars,
                "endpointLogged": endpoint_logged,
                "forbiddenClear": forbidden_clear,
                "evidenceInRequest": matched,
                "evidenceInCache": evidence_in_cache,
                "cacheHashMatchesRequest": hash_matches,
            })
        }
    }
}

fn established_foreign(pid: u32) -> Vec<String> {
    let output = match std::process::Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let pid = pid.to_string();
    let mut found = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 || parts[0] != "TCP" || parts[3] != "ESTABLISHED" || parts[4] != pid {
            continue;
        }
        let remote = parts[2];
        if remote.starts_with("127.") || remote.starts_with("[::1]") || remote.starts_with("::1") {
            continue;
        }
        if !found.contains(&remote.to_owned()) {
            found.push(remote.to_owned());
        }
    }
    found
}

fn assert_no_bookmarks_bak(root: &std::path::Path) {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory).unwrap() {
            let entry = entry.unwrap();
            assert_ne!(
                entry.file_name(),
                std::ffi::OsString::from("Bookmarks.bak"),
                "{}",
                entry.path().display()
            );
            if entry.file_type().unwrap().is_dir() {
                pending.push(entry.path());
            }
        }
    }
}
