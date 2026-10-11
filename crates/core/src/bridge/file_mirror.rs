//! File mirror coordination. Live profile cache is never replaced from a Bookmarks file.
use super::{Bridge, Inner, now, random_id};
use crate::mirror::{self, DirectoryKey, FileStamp, LoadError};
use crate::storage::StoredMirror;
use markbridge_protocol::{
    BookmarkNode, BridgeState, ChromeProfileList, Counter, ErrorCode, Id, MirrorAssociation,
    MirrorFileStatus, MirrorSourceState, MirrorTree, RequiredNullable,
};
use notify::Watcher;
use std::{collections::BTreeMap, path::PathBuf, time::SystemTime};
use tokio::{sync::watch, task::JoinHandle};

type Result<T> = std::result::Result<T, ErrorCode>;

pub(super) struct ActiveMirror {
    pub path: PathBuf,
    pub watching: bool,
    pub stamp: Option<FileStamp>,
    pub view: MirrorSourceState,
    pub nodes: Vec<BookmarkNode>,
}

pub(super) struct Watch {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

enum Reload {
    Unchanged,
    Ready(Vec<BookmarkNode>, FileStamp),
    Failed(LoadError),
}

impl Bridge {
    pub(super) async fn arm_saved_watches(&self) {
        let targets: Vec<(Id, PathBuf, bool)> = {
            let inner = self.inner.lock().await;
            inner
                .mirrors
                .values()
                .map(|mirror| {
                    (
                        mirror.view.mirror_source_id.clone(),
                        mirror.path.clone(),
                        mirror.watching && mirror.path.is_absolute(),
                    )
                })
                .collect()
        };
        for (id, path, watch) in targets {
            if watch && self.restart_watch(id.clone(), path).await.is_ok() {
                continue;
            }
            self.mark_unwatched(id).await;
        }
    }

    pub async fn enumerate_chrome_user_data(
        &self,
        user_data_path: String,
    ) -> Result<ChromeProfileList> {
        let profiles = tokio::task::spawn_blocking(move || {
            mirror::enumerate_user_data(std::path::Path::new(&user_data_path))
        })
        .await
        .map_err(|_| ErrorCode::StorageError)??;
        Ok(ChromeProfileList { profiles })
    }

    pub async fn attach_file_mirror(
        &self,
        user_data_path: String,
        directory_key: String,
    ) -> Result<BridgeState> {
        let key = DirectoryKey::new(directory_key)?;
        let loaded = tokio::task::spawn_blocking(move || {
            mirror::load_profile(std::path::Path::new(&user_data_path), &key)
        })
        .await
        .map_err(|_| ErrorCode::StorageError)??;
        let mut inner = self.inner.lock().await;
        if inner.storage.is_none() {
            return Err(ErrorCode::Cancelled);
        }
        let existing_id = inner
            .mirrors
            .values()
            .find(|mirror| mirror.path == loaded.path)
            .map(|mirror| mirror.view.mirror_source_id.clone());
        let id = match existing_id.clone() {
            Some(id) => id,
            None => random_id("mirror")?,
        };
        let previous = existing_id
            .as_ref()
            .and_then(|id| inner.mirrors.get(id.as_str()));
        let nodes_changed = previous.is_none_or(|mirror| mirror.nodes != loaded.nodes);
        let revision = previous
            .map(|mirror| mirror.view.revision.get())
            .unwrap_or(0)
            .saturating_add(u64::from(nodes_changed));
        let mut association = previous
            .map(|mirror| mirror.view.association)
            .unwrap_or(MirrorAssociation::Independent);
        let mut paired = previous.and_then(|mirror| mirror.view.paired_profile_id.0.clone());
        let profile_nodes = paired.as_ref().and_then(|profile_id| {
            inner
                .profiles
                .get(profile_id.as_str())
                .map(|profile| profile.nodes.clone())
        });
        if association == MirrorAssociation::Confirmed
            && !mirror::same_identity(&loaded.nodes, profile_nodes.as_deref().unwrap_or(&[]))
        {
            association = MirrorAssociation::Independent;
            paired = None;
        }
        let view = mirror_view(ViewInput {
            id: id.clone(),
            display_name: loaded.display_name.clone(),
            association,
            paired_profile_id: paired,
            file_status: MirrorFileStatus::Current,
            watching: true,
            node_count: loaded.nodes.len(),
            revision,
            last_synced_at: Some(now()?),
            error_code: None,
        })?;
        let active = ActiveMirror {
            path: loaded.path.clone(),
            watching: true,
            stamp: Some(loaded.stamp),
            view,
            nodes: loaded.nodes,
        };
        inner
            .storage()?
            .put_mirror(stored(&active), nodes_changed)
            .await?;
        inner.mirrors.insert(id.as_str().to_owned(), active);
        self.publish(&mut inner);
        let path = loaded.path;
        drop(inner);
        if self.restart_watch(id.clone(), path).await.is_err() {
            self.mark_unwatched(id).await;
        }
        Ok(self.inner.lock().await.view())
    }

    pub async fn rescan_file_mirrors(&self) -> Result<BridgeState> {
        let ids: Vec<Id> = {
            let inner = self.inner.lock().await;
            inner
                .mirrors
                .values()
                .filter(|mirror| mirror.watching)
                .map(|mirror| mirror.view.mirror_source_id.clone())
                .collect()
        };
        for id in ids {
            reload(self.inner.clone(), self.state.clone(), id, false).await;
        }
        Ok(self.inner.lock().await.view())
    }

    pub async fn detach_file_mirror(&self, mirror_id: Id) -> Result<BridgeState> {
        self.stop_watch(mirror_id.as_str()).await;
        let mut inner = self.inner.lock().await;
        let record = {
            let mirror = inner
                .mirrors
                .get_mut(mirror_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            mirror.watching = false;
            mirror.view.watching = false;
            mirror.view.association = MirrorAssociation::Independent;
            mirror.view.paired_profile_id = RequiredNullable(None);
            stored(mirror)
        };
        inner.storage()?.put_mirror(record, false).await?;
        self.publish(&mut inner);
        Ok(inner.view())
    }

    pub async fn associate_file_mirror(
        &self,
        mirror_id: Id,
        profile_id: Id,
    ) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        let profile_nodes = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?
            .nodes
            .clone();
        let (status, nodes) = {
            let mirror = inner
                .mirrors
                .get(mirror_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            (mirror.view.file_status, mirror.nodes.clone())
        };
        if status != MirrorFileStatus::Current || !mirror::same_identity(&nodes, &profile_nodes) {
            return Err(ErrorCode::WrongProfile);
        }
        let record = {
            let mirror = inner
                .mirrors
                .get_mut(mirror_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            mirror.view.association = MirrorAssociation::Confirmed;
            mirror.view.paired_profile_id = RequiredNullable(Some(profile_id));
            mirror.view.can_write_browser = false;
            stored(mirror)
        };
        inner.storage()?.put_mirror(record, false).await?;
        self.publish(&mut inner);
        Ok(inner.view())
    }

    pub async fn mirror_tree(&self, mirror_id: Id) -> Result<MirrorTree> {
        let inner = self.inner.lock().await;
        let mirror = inner
            .mirrors
            .get(mirror_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        Ok(MirrorTree {
            mirror_source_id: mirror.view.mirror_source_id.clone(),
            display_name: mirror.view.display_name.clone(),
            file_status: mirror.view.file_status,
            association: mirror.view.association,
            revision: mirror.view.revision,
            last_synced_at: mirror.view.last_synced_at.clone(),
            error_code: mirror.view.error_code.clone(),
            can_write_browser: false,
            nodes: mirror.nodes.clone(),
        })
    }

    /// A mirror id is never writable. A paired profile is writable only while its connection is live.
    pub async fn authorize_browser_write(&self, id: Id) -> Result<()> {
        let inner = self.inner.lock().await;
        if inner.mirrors.contains_key(id.as_str()) {
            return Err(ErrorCode::ReadOnly);
        }
        let profile = inner
            .profiles
            .get(id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if profile.revoked || profile.view.connection != markbridge_protocol::BridgeConnection::Live
        {
            return Err(ErrorCode::ReadOnly);
        }
        Ok(())
    }

    pub(super) async fn stop_watches(&self) {
        let watches = std::mem::take(&mut *self.watches.lock().await);
        for (_, watch) in watches {
            watch.stop.send_replace(true);
            let _ = watch.task.await;
        }
    }

    async fn restart_watch(&self, id: Id, directory: PathBuf) -> Result<()> {
        self.stop_watch(id.as_str()).await;
        let watch = spawn_watch(
            self.inner.clone(),
            self.state.clone(),
            id.clone(),
            directory,
        )?;
        self.watches
            .lock()
            .await
            .insert(id.as_str().to_owned(), watch);
        Ok(())
    }

    async fn stop_watch(&self, id: &str) {
        if let Some(watch) = self.watches.lock().await.remove(id) {
            watch.stop.send_replace(true);
            let _ = watch.task.await;
        }
    }

    async fn mark_unwatched(&self, id: Id) {
        let mut inner = self.inner.lock().await;
        let record = {
            let Some(mirror) = inner.mirrors.get_mut(id.as_str()) else {
                return;
            };
            mirror.watching = false;
            mirror.view.watching = false;
            stored(mirror)
        };
        let save_result = if let Some(storage) = inner.storage.as_ref() {
            storage.put_mirror(record, false).await
        } else {
            return;
        };
        if save_result.is_ok() {
            self.publish(&mut inner);
        }
    }
}

pub(super) async fn load_mirrors(
    storage: &crate::storage::Storage,
) -> Result<BTreeMap<String, ActiveMirror>> {
    let mut mirrors = BTreeMap::new();
    for record in storage.mirrors().await? {
        let active = active_from_stored(record)?;
        mirrors.insert(active.view.mirror_source_id.as_str().to_owned(), active);
    }
    Ok(mirrors)
}

fn active_from_stored(record: StoredMirror) -> Result<ActiveMirror> {
    // chrome_id text order is not sibling position.
    let nodes = preorder(record.nodes);
    let view = mirror_view(ViewInput {
        id: record.id,
        display_name: record.display_name,
        association: if record.confirmed {
            MirrorAssociation::Confirmed
        } else {
            MirrorAssociation::Independent
        },
        paired_profile_id: record.paired_profile_id,
        file_status: record.file_status,
        watching: record.watching,
        node_count: nodes.len(),
        revision: record.revision,
        last_synced_at: record.last_read_at,
        error_code: record.error_code,
    })?;
    Ok(ActiveMirror {
        path: PathBuf::from(record.path),
        watching: record.watching,
        stamp: None,
        view,
        nodes,
    })
}

fn preorder(nodes: Vec<BookmarkNode>) -> Vec<BookmarkNode> {
    let mut by_parent: BTreeMap<Option<String>, Vec<BookmarkNode>> = BTreeMap::new();
    for node in nodes {
        by_parent
            .entry(node.parent_id.as_ref().map(|id| id.as_str().to_owned()))
            .or_default()
            .push(node);
    }
    let mut ordered = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut stack = by_parent.remove(&None).unwrap_or_default();
    stack.sort_by_key(|node| node.position.get());
    stack.reverse();
    while let Some(node) = stack.pop() {
        let id = node.chrome_id.as_str().to_owned();
        if !seen.insert(id.clone()) {
            continue;
        }
        if let Some(mut children) = by_parent.remove(&Some(id)) {
            children.sort_by_key(|child| child.position.get());
            children.reverse();
            stack.extend(children);
        }
        ordered.push(node);
    }
    let mut rest = Vec::new();
    for children in by_parent.into_values() {
        rest.extend(children);
    }
    rest.sort_by(|left, right| {
        left.position
            .get()
            .cmp(&right.position.get())
            .then_with(|| left.chrome_id.as_str().cmp(right.chrome_id.as_str()))
    });
    ordered.extend(rest);
    ordered
}

struct ViewInput {
    id: Id,
    display_name: markbridge_protocol::DisplayName,
    association: MirrorAssociation,
    paired_profile_id: Option<Id>,
    file_status: MirrorFileStatus,
    watching: bool,
    node_count: usize,
    revision: u64,
    last_synced_at: Option<u64>,
    error_code: Option<ErrorCode>,
}

fn mirror_view(input: ViewInput) -> Result<MirrorSourceState> {
    Ok(MirrorSourceState {
        mirror_source_id: input.id,
        display_name: input.display_name,
        association: input.association,
        paired_profile_id: RequiredNullable(input.paired_profile_id),
        file_status: input.file_status,
        watching: input.watching,
        node_count: Counter::new(input.node_count as u64)?,
        revision: Counter::new(input.revision)?,
        last_synced_at: RequiredNullable(input.last_synced_at.map(Counter::new).transpose()?),
        error_code: RequiredNullable(input.error_code),
        can_write_browser: false,
    })
}

fn stored(mirror: &ActiveMirror) -> StoredMirror {
    StoredMirror {
        id: mirror.view.mirror_source_id.clone(),
        path: mirror.path.to_string_lossy().into_owned(),
        display_name: mirror.view.display_name.clone(),
        paired_profile_id: mirror.view.paired_profile_id.0.clone(),
        confirmed: mirror.view.association == MirrorAssociation::Confirmed,
        watching: mirror.watching,
        file_status: mirror.view.file_status,
        revision: mirror.view.revision.get(),
        last_read_at: mirror.view.last_synced_at.0.as_ref().map(Counter::get),
        error_code: mirror.view.error_code.0,
        nodes: mirror.nodes.clone(),
    }
}

fn spawn_watch(
    inner: std::sync::Arc<tokio::sync::Mutex<Inner>>,
    state: watch::Sender<BridgeState>,
    id: Id,
    directory: PathBuf,
) -> Result<Watch> {
    let (tx, mut events) = tokio::sync::mpsc::channel(8);
    let mut watcher = notify::recommended_watcher(
        move |result: std::result::Result<notify::Event, notify::Error>| {
            if result.is_ok() {
                let _ = tx.try_send(());
            }
        },
    )
    .map_err(|_| ErrorCode::PathUnavailable)?;
    watcher
        .watch(&directory, notify::RecursiveMode::NonRecursive)
        .map_err(|_| ErrorCode::PathUnavailable)?;
    let (stop, mut stopped) = watch::channel(false);
    let task = tokio::spawn(async move {
        let _watcher = watcher;
        let mut interval = tokio::time::interval(mirror::METADATA_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        loop {
            tokio::select! {
                changed = stopped.changed() => {
                    if changed.is_err() || *stopped.borrow() {
                        break;
                    }
                }
                _ = interval.tick() => reload(inner.clone(), state.clone(), id.clone(), true).await,
                event = events.recv() => {
                    if event.is_none() {
                        break;
                    }
                    loop {
                        match tokio::time::timeout(mirror::DEBOUNCE, events.recv()).await {
                            Ok(Some(())) => continue,
                            Ok(None) => return,
                            Err(_) => break,
                        }
                    }
                    reload(inner.clone(), state.clone(), id.clone(), false).await;
                }
            }
        }
    });
    Ok(Watch { stop, task })
}

async fn reload(
    inner: std::sync::Arc<tokio::sync::Mutex<Inner>>,
    state: watch::Sender<BridgeState>,
    id: Id,
    metadata_only: bool,
) {
    let (path, previous) = {
        let guard = inner.lock().await;
        let Some(mirror) = guard.mirrors.get(id.as_str()) else {
            return;
        };
        if !mirror.watching {
            return;
        }
        (mirror.path.clone(), mirror.stamp)
    };
    let outcome = tokio::task::spawn_blocking(move || read_outcome(&path, previous, metadata_only))
        .await
        .unwrap_or(Reload::Failed(LoadError::Unavailable(
            ErrorCode::PathUnavailable,
        )));
    let mut guard = inner.lock().await;
    if !apply_outcome(&mut guard, &id, outcome) {
        return;
    }
    let record = guard.mirrors.get(id.as_str()).map(stored);
    let saved = if let Some(record) = record
        && let Some(storage) = guard.storage.as_ref()
    {
        storage.put_mirror(record, true).await.ok()
    } else {
        None
    };
    if saved.is_some() {
        guard.revision = guard.revision.saturating_add(1);
        let _ = state.send_replace(guard.view());
    }
}

fn read_outcome(
    path: &std::path::Path,
    previous: Option<FileStamp>,
    metadata_only: bool,
) -> Reload {
    if metadata_only {
        match std::fs::metadata(path.join("Bookmarks")) {
            Ok(meta) if meta.is_file() => {
                let stamp = FileStamp {
                    len: meta.len(),
                    modified_ms: modified_ms(meta.modified().ok()),
                };
                if previous == Some(stamp) {
                    return Reload::Unchanged;
                }
            }
            _ => return Reload::Failed(LoadError::Unavailable(ErrorCode::PathUnavailable)),
        }
    }
    match mirror::load_bookmarks(path) {
        Ok((nodes, stamp)) => Reload::Ready(nodes, stamp),
        Err(error) => Reload::Failed(error),
    }
}

fn apply_outcome(inner: &mut Inner, id: &Id, outcome: Reload) -> bool {
    let Some(mirror) = inner.mirrors.get(id.as_str()) else {
        return false;
    };
    if !mirror.watching {
        return false;
    }
    let paired = mirror.view.paired_profile_id.0.clone();
    let profile_nodes = paired.as_ref().and_then(|profile_id| {
        inner
            .profiles
            .get(profile_id.as_str())
            .map(|profile| profile.nodes.clone())
    });
    let Some(mirror) = inner.mirrors.get_mut(id.as_str()) else {
        return false;
    };
    match outcome {
        Reload::Unchanged => return false,
        Reload::Ready(nodes, stamp) => {
            if mirror.nodes != nodes {
                let revision = mirror.view.revision.get().saturating_add(1);
                mirror.view.revision = Counter::new(revision).unwrap_or(mirror.view.revision);
                mirror.nodes = nodes;
            }
            mirror.stamp = Some(stamp);
            mirror.view.file_status = MirrorFileStatus::Current;
            mirror.view.error_code = RequiredNullable(None);
            mirror.view.node_count =
                Counter::new(mirror.nodes.len() as u64).unwrap_or(mirror.view.node_count);
            mirror.view.last_synced_at =
                RequiredNullable(now().ok().and_then(|value| Counter::new(value).ok()));
        }
        Reload::Failed(LoadError::Unavailable(code)) => {
            if mirror.view.file_status == MirrorFileStatus::Unavailable
                && mirror.view.error_code.0 == Some(code)
            {
                return false;
            }
            mirror.view.file_status = MirrorFileStatus::Unavailable;
            mirror.view.error_code = RequiredNullable(Some(code));
        }
        Reload::Failed(LoadError::Rejected(code)) => {
            if mirror.view.file_status == MirrorFileStatus::Stale
                && mirror.view.error_code.0 == Some(code)
            {
                return false;
            }
            mirror.view.file_status = MirrorFileStatus::Stale;
            mirror.view.error_code = RequiredNullable(Some(code));
        }
    }
    if mirror.view.association == MirrorAssociation::Confirmed
        && (mirror.view.file_status != MirrorFileStatus::Current
            || !mirror::same_identity(&mirror.nodes, profile_nodes.as_deref().unwrap_or(&[])))
    {
        mirror.view.association = MirrorAssociation::Independent;
        mirror.view.paired_profile_id = RequiredNullable(None);
    }
    true
}

fn modified_ms(modified: Option<SystemTime>) -> u64 {
    modified
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|time| u64::try_from(time.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
