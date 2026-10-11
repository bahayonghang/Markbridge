use super::*;
use crate::bridge::Bridge;
use crate::bridge::credentials::CredentialStore;
use markbridge_protocol::{ChromeProfileList, ErrorCode, MirrorFileStatus};
use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

const LOCAL_SINGLE: &str =
    include_str!("../../../../tests/fixtures/bookmarks/local-state-single.json");
const LOCAL_MULTI: &str =
    include_str!("../../../../tests/fixtures/bookmarks/local-state-multi.json");
const PERSONAL: &str = include_str!("../../../../tests/fixtures/bookmarks/bookmarks-personal.json");
const WORK: &str = include_str!("../../../../tests/fixtures/bookmarks/bookmarks-work.json");
const UPDATED: &str = include_str!("../../../../tests/fixtures/bookmarks/bookmarks-updated.json");

struct MemoryCredentials(Mutex<HashMap<String, String>>);
impl CredentialStore for MemoryCredentials {
    fn get(&self, reference: &str) -> std::result::Result<String, ErrorCode> {
        self.0
            .lock()
            .unwrap()
            .get(reference)
            .cloned()
            .ok_or(ErrorCode::Unpaired)
    }
    fn set(&self, reference: &str, value: &str) -> std::result::Result<(), ErrorCode> {
        self.0
            .lock()
            .unwrap()
            .insert(reference.into(), value.into());
        Ok(())
    }
    fn delete(&self, reference: &str) -> std::result::Result<(), ErrorCode> {
        self.0.lock().unwrap().remove(reference);
        Ok(())
    }
}

struct Session {
    bridge: Bridge,
    dir: tempfile::TempDir,
}
impl Session {
    async fn open() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::open(
            dir.path().join("cache.sqlite"),
            Arc::new(MemoryCredentials(Mutex::new(HashMap::new()))),
        )
        .await
        .unwrap();
        Self { bridge, dir }
    }
    async fn close(self) {
        self.bridge.shutdown().await.unwrap();
    }
}

fn write_user_data(root: &Path, local_state: &str, profiles: &[(&str, &str)]) {
    fs::create_dir_all(root).unwrap();
    fs::write(root.join("Local State"), local_state).unwrap();
    for (name, bookmarks) in profiles {
        let directory = root.join(name);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("Bookmarks"), bookmarks).unwrap();
    }
}

fn snapshot(path: &Path) -> (Vec<u8>, std::time::SystemTime) {
    let meta = fs::metadata(path).unwrap();
    (fs::read(path).unwrap(), meta.modified().unwrap())
}

fn assert_no_bookmarks_bak(root: &Path) {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).unwrap() {
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

#[test]
fn directory_key_rejects_traversal() {
    assert!(DirectoryKey::new("..").is_err());
    assert!(DirectoryKey::new(r"..\outside").is_err());
    assert_eq!(
        DirectoryKey::new("Profile 1").unwrap().as_str(),
        "Profile 1"
    );
}

#[tokio::test]
async fn enumeration_lists_only_the_selected_user_data_profiles() {
    let session = Session::open().await;
    let root = session.dir.path().join("User Data");
    write_user_data(
        &root,
        LOCAL_MULTI,
        &[
            ("Default", PERSONAL),
            ("Profile 1", WORK),
            ("Profile 2", PERSONAL),
        ],
    );
    fs::write(root.join("History"), b"HISTORY-SENTINEL").unwrap();
    fs::write(root.join("Cookies"), b"COOKIE-SENTINEL").unwrap();
    fs::write(root.join("Default").join("Login Data"), b"LOGIN-SENTINEL").unwrap();
    fs::write(root.join("Default").join("History"), b"PROFILE-HISTORY").unwrap();
    fs::write(root.join("Default").join("Cookies"), b"PROFILE-COOKIES").unwrap();
    fs::write(root.join("Profile 1").join("Login Data"), b"WORK-LOGIN").unwrap();
    fs::write(root.join("Default").join("Bookmarks"), PERSONAL).unwrap();
    let outside = session.dir.path().join("outside");
    write_user_data(&outside, LOCAL_SINGLE, &[("Default", WORK)]);
    let edge = session.dir.path().join("Edge User Data");
    write_user_data(&edge, LOCAL_SINGLE, &[("Default", WORK)]);
    let history = snapshot(&root.join("History"));
    let cookies = snapshot(&root.join("Cookies"));
    let login = snapshot(&root.join("Default").join("Login Data"));
    let profile_history = snapshot(&root.join("Default").join("History"));
    let profile_cookies = snapshot(&root.join("Default").join("Cookies"));
    let work_login = snapshot(&root.join("Profile 1").join("Login Data"));
    let personal_bookmarks = snapshot(&root.join("Default").join("Bookmarks"));
    let work_bookmarks = snapshot(&root.join("Profile 1").join("Bookmarks"));
    let unseen_bookmarks = snapshot(&root.join("Profile 2").join("Bookmarks"));
    let local_state = snapshot(&root.join("Local State"));
    let outside_bookmarks = snapshot(&outside.join("Default").join("Bookmarks"));
    let edge_bookmarks = snapshot(&edge.join("Default").join("Bookmarks"));

    let listed: ChromeProfileList = session
        .bridge
        .enumerate_chrome_user_data(root.to_str().unwrap().to_owned())
        .await
        .unwrap();
    let names: Vec<_> = listed
        .profiles
        .iter()
        .map(|profile| profile.display_name.as_str().to_owned())
        .collect();
    assert_eq!(names, vec!["Personal".to_owned(), "Work".to_owned()]);
    assert_eq!(
        listed
            .profiles
            .iter()
            .map(|profile| profile.directory_key.as_str())
            .collect::<Vec<_>>(),
        ["Default", "Profile 1"]
    );
    assert!(
        listed
            .profiles
            .iter()
            .all(|profile| profile.bookmarks_present)
    );
    assert!(!format!("{names:?}").contains("example.com"));
    assert!(!format!("{names:?}").contains("Outside"));
    assert!(!format!("{names:?}").contains("Only"));
    assert_eq!(snapshot(&root.join("History")), history);
    assert_eq!(snapshot(&root.join("Cookies")), cookies);
    assert_eq!(snapshot(&root.join("Default").join("Login Data")), login);
    assert_eq!(
        snapshot(&root.join("Default").join("History")),
        profile_history
    );
    assert_eq!(
        snapshot(&root.join("Default").join("Cookies")),
        profile_cookies
    );
    assert_eq!(
        snapshot(&root.join("Profile 1").join("Login Data")),
        work_login
    );
    assert_eq!(
        snapshot(&root.join("Default").join("Bookmarks")),
        personal_bookmarks
    );
    assert_eq!(
        snapshot(&root.join("Profile 1").join("Bookmarks")),
        work_bookmarks
    );
    assert_eq!(
        snapshot(&root.join("Profile 2").join("Bookmarks")),
        unseen_bookmarks
    );
    assert_eq!(snapshot(&root.join("Local State")), local_state);
    assert_eq!(
        snapshot(&outside.join("Default").join("Bookmarks")),
        outside_bookmarks
    );
    assert_eq!(
        snapshot(&edge.join("Default").join("Bookmarks")),
        edge_bookmarks
    );
    assert_no_bookmarks_bak(&root);
    assert_no_bookmarks_bak(&edge);

    let single = session.dir.path().join("single");
    write_user_data(&single, LOCAL_SINGLE, &[("Default", PERSONAL)]);
    let one = session
        .bridge
        .enumerate_chrome_user_data(single.to_str().unwrap().to_owned())
        .await
        .unwrap();
    assert_eq!(one.profiles.len(), 1);
    assert_eq!(one.profiles[0].display_name.as_str(), "Only");
    assert_eq!(one.profiles[0].directory_key, "Default");

    let missing = root.join("missing");
    assert_eq!(
        session
            .bridge
            .enumerate_chrome_user_data(missing.to_str().unwrap().to_owned())
            .await
            .unwrap_err(),
        ErrorCode::PathUnavailable
    );
    assert_eq!(
        enumerate_user_data(Path::new("relative-user-data")).unwrap_err(),
        ErrorCode::PathUnavailable
    );
    let file = session.dir.path().join("not-a-directory");
    fs::write(&file, b"nope").unwrap();
    assert_eq!(
        enumerate_user_data(&file).unwrap_err(),
        ErrorCode::PathUnavailable
    );
    let unreadable = session.dir.path().join("unreadable");
    fs::create_dir_all(unreadable.join("Local State")).unwrap();
    assert_eq!(
        enumerate_user_data(&unreadable).unwrap_err(),
        ErrorCode::PathUnavailable
    );
    let message = ErrorCode::PathUnavailable.to_string();
    assert_eq!(message, "PATH_UNAVAILABLE");
    assert!(!message.contains(root.to_str().unwrap()));
    session.close().await;
}

#[cfg(windows)]
#[tokio::test]
async fn a_locked_local_state_is_a_recoverable_path_error() {
    let session = Session::open().await;
    let root = session.dir.path().join("User Data");
    write_user_data(&root, LOCAL_SINGLE, &[("Default", PERSONAL)]);
    let locked = {
        use std::os::windows::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(root.join("Local State"))
            .unwrap()
    };
    assert_eq!(
        session
            .bridge
            .enumerate_chrome_user_data(root.to_str().unwrap().to_owned())
            .await
            .unwrap_err(),
        ErrorCode::PathUnavailable
    );
    drop(locked);
    assert_eq!(
        session
            .bridge
            .enumerate_chrome_user_data(root.to_str().unwrap().to_owned())
            .await
            .unwrap()
            .profiles
            .len(),
        1
    );
    session.close().await;
}

#[tokio::test]
async fn invalid_reads_keep_the_last_valid_mirror() {
    let session = Session::open().await;
    let root = session.dir.path().join("User Data");
    write_user_data(&root, LOCAL_SINGLE, &[("Default", PERSONAL)]);
    let profile = root.join("Default");
    let attached = session
        .bridge
        .attach_file_mirror(root.to_str().unwrap().to_owned(), "Default".into())
        .await
        .unwrap();
    let mirror_id = attached.mirrors[0].mirror_source_id.clone();
    assert!(attached.mirrors[0].node_count.get() > 0);
    assert!(!attached.mirrors[0].can_write_browser);
    let original = session.bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert!(
        original
            .nodes
            .iter()
            .any(|node| node.title.as_str() == "示例")
    );
    assert_eq!(original.file_status, MirrorFileStatus::Current);

    let updated_tmp = profile.join("Bookmarks.new");
    fs::write(&updated_tmp, UPDATED).unwrap();
    fs::rename(&updated_tmp, profile.join("Bookmarks")).unwrap();
    wait_title(&session.bridge, &mirror_id, "Updated").await;
    let updated = session.bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert!(updated.nodes.iter().any(|node| {
        node.url
            .as_ref()
            .is_some_and(|url| url.as_str() == "https://example.com/b")
    }));
    assert!(
        !updated
            .nodes
            .iter()
            .any(|node| node.title.as_str() == "示例")
    );

    fs::write(profile.join("Bookmarks"), b"{\"roots\":").unwrap();
    session.bridge.rescan_file_mirrors().await.unwrap();
    let stale = session.bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert_eq!(stale.file_status, MirrorFileStatus::Stale);
    assert_eq!(stale.nodes, updated.nodes);
    assert_eq!(stale.revision, updated.revision);

    fs::remove_file(profile.join("Bookmarks")).unwrap();
    session.bridge.rescan_file_mirrors().await.unwrap();
    let missing = session.bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert_eq!(missing.file_status, MirrorFileStatus::Unavailable);
    assert_eq!(missing.nodes, updated.nodes);

    fs::rename(&profile, root.join("renamed")).unwrap();
    session.bridge.rescan_file_mirrors().await.unwrap();
    let renamed = session.bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert_eq!(renamed.file_status, MirrorFileStatus::Unavailable);
    assert_eq!(renamed.nodes, updated.nodes);

    fs::rename(root.join("renamed"), &profile).unwrap();
    fs::write(profile.join("Bookmarks"), PERSONAL).unwrap();
    session.bridge.rescan_file_mirrors().await.unwrap();
    let restored = session.bridge.mirror_tree(mirror_id).await.unwrap();
    assert_eq!(restored.file_status, MirrorFileStatus::Current);
    assert!(
        restored
            .nodes
            .iter()
            .any(|node| node.title.as_str() == "示例")
    );
    assert_ne!(restored.nodes, updated.nodes);
    assert_no_bookmarks_bak(&root);
    session.close().await;
}

#[tokio::test]
async fn offline_browse_does_not_rewrite_chrome_files_or_grant_writes() {
    let session = Session::open().await;
    let root = session.dir.path().join("User Data");
    write_user_data(
        &root,
        LOCAL_MULTI,
        &[("Default", PERSONAL), ("Profile 1", WORK)],
    );
    let bookmarks = snapshot(&root.join("Default").join("Bookmarks"));
    let local_state = snapshot(&root.join("Local State"));
    let work = snapshot(&root.join("Profile 1").join("Bookmarks"));
    let state = session
        .bridge
        .attach_file_mirror(root.to_str().unwrap().to_owned(), "Default".into())
        .await
        .unwrap();
    let mirror_id = state.mirrors[0].mirror_source_id.clone();
    assert!(!state.mirrors[0].can_write_browser);
    assert!(session.bridge.state().await.profiles.is_empty());
    let tree = session.bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert!(!tree.can_write_browser);
    assert!(
        tree.nodes
            .iter()
            .any(|node| node.title.as_str() == "Nested")
    );
    session.bridge.rescan_file_mirrors().await.unwrap();
    let detached = session
        .bridge
        .detach_file_mirror(mirror_id.clone())
        .await
        .unwrap();
    assert!(!detached.mirrors[0].watching);
    let cached = session.bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert_eq!(cached.nodes, tree.nodes);
    assert_eq!(
        session
            .bridge
            .authorize_browser_write(mirror_id)
            .await
            .unwrap_err(),
        ErrorCode::ReadOnly
    );
    assert_eq!(snapshot(&root.join("Default").join("Bookmarks")), bookmarks);
    assert_eq!(snapshot(&root.join("Local State")), local_state);
    assert_eq!(snapshot(&root.join("Profile 1").join("Bookmarks")), work);
    assert_no_bookmarks_bak(&root);
    session.close().await;
}

#[tokio::test]
async fn mismatched_file_source_stays_read_only() {
    let session = Session::open().await;
    let root = session.dir.path().join("User Data");
    write_user_data(
        &root,
        LOCAL_MULTI,
        &[("Default", PERSONAL), ("Profile 1", WORK)],
    );
    let personal = session
        .bridge
        .attach_file_mirror(root.to_str().unwrap().to_owned(), "Default".into())
        .await
        .unwrap();
    let work = session
        .bridge
        .attach_file_mirror(root.to_str().unwrap().to_owned(), "Profile 1".into())
        .await
        .unwrap();
    assert_eq!(work.mirrors.len(), 2);
    let personal_nodes = session
        .bridge
        .mirror_tree(personal.mirrors[0].mirror_source_id.clone())
        .await
        .unwrap()
        .nodes;
    let work_id = work
        .mirrors
        .iter()
        .find(|mirror| mirror.display_name.as_str() == "Work")
        .unwrap()
        .mirror_source_id
        .clone();
    let work_nodes = session
        .bridge
        .mirror_tree(work_id.clone())
        .await
        .unwrap()
        .nodes;
    assert!(!same_identity(&personal_nodes, &work_nodes));
    assert!(work.mirrors.iter().all(|mirror| !mirror.can_write_browser));
    assert!(work.mirrors.iter().all(|mirror| mirror.association == markbridge_protocol::MirrorAssociation::Independent));
    session.close().await;
}

#[tokio::test]
async fn reopen_preserves_sibling_position_not_chrome_id_text_order() {
    let dir = tempfile::tempdir().unwrap();
    let database = dir.path().join("cache.sqlite");
    let root = dir.path().join("User Data");
    let bookmarks = r#"{
      "roots": {
        "bookmark_bar": {
          "children": [
            {"id": "9", "name": "First", "type": "url", "url": "https://example.com/first"},
            {"id": "10", "name": "Second", "type": "url", "url": "https://example.com/second"}
          ],
          "id": "1",
          "name": "Bookmarks bar",
          "type": "folder"
        }
      }
    }"#;
    write_user_data(&root, LOCAL_SINGLE, &[("Default", bookmarks)]);
    let profile = root.join("Default");
    let bookmarks_file = snapshot(&profile.join("Bookmarks"));
    let local_state = snapshot(&root.join("Local State"));
    let bridge = Bridge::open(
        &database,
        Arc::new(MemoryCredentials(Mutex::new(HashMap::new()))),
    )
    .await
    .unwrap();
    let attached = bridge
        .attach_file_mirror(root.to_str().unwrap().to_owned(), "Default".into())
        .await
        .unwrap();
    let mirror_id = attached.mirrors[0].mirror_source_id.clone();
    let before = bridge.mirror_tree(mirror_id.clone()).await.unwrap();
    assert_eq!(
        before
            .nodes
            .iter()
            .map(|node| node.chrome_id.as_str())
            .collect::<Vec<_>>(),
        ["0", "1", "9", "10"]
    );
    bridge.shutdown().await.unwrap();
    let bridge = Bridge::open(
        &database,
        Arc::new(MemoryCredentials(Mutex::new(HashMap::new()))),
    )
    .await
    .unwrap();
    let restored = bridge.mirror_tree(mirror_id).await.unwrap();
    assert_eq!(restored.nodes, before.nodes);
    assert!(!restored.can_write_browser);
    assert_eq!(snapshot(&profile.join("Bookmarks")), bookmarks_file);
    assert_eq!(snapshot(&root.join("Local State")), local_state);
    assert_no_bookmarks_bak(&root);
    bridge.shutdown().await.unwrap();
}

async fn wait_title(bridge: &Bridge, id: &markbridge_protocol::Id, title: &str) {
    let start = std::time::Instant::now();
    loop {
        let tree = bridge.mirror_tree(id.clone()).await.unwrap();
        if tree.nodes.iter().any(|node| node.title.as_str() == title) {
            return;
        }
        if start.elapsed() > Duration::from_secs(5) {
            panic!("timed out waiting for a file mirror update");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
