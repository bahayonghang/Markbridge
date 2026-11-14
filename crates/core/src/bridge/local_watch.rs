//! Live external SQLite change detection and reload for the isolated `local-skills` library.
use super::{ActiveProfile, Bridge, Result};
use crate::storage::{
    LOCAL_SKILLS_DISPLAY_NAME, LOCAL_SKILLS_INSTANCE_ID, LOCAL_SKILLS_PROFILE_ID, ProfileOrigin,
    StoredIdentity,
};
use markbridge_protocol::{
    BookmarkNode, BridgeConnection, BridgeProfile, BridgeState, Counter, DisplayName, ErrorCode,
    Id, RequiredNullable, SourceEpoch,
};
use notify::Watcher;
use std::{path::Path, time::Duration};
use tokio::{sync::watch, task::JoinHandle};

const DEBOUNCE: Duration = Duration::from_millis(120);

pub(super) struct Watch {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl Bridge {
    pub async fn ensure_local_library(&self) -> Result<BridgeState> {
        let storage = self.inner.lock().await.storage()?.share();
        storage.ensure_local_skills_space().await?;
        self.reload_local_space().await
    }

    pub async fn reload_local_space(&self) -> Result<BridgeState> {
        let storage = self.inner.lock().await.storage()?.share();
        let status = storage.local_skills_status().await?;
        if !status.initialized {
            let mut inner = self.inner.lock().await;
            inner.storage()?;
            if inner.profiles.remove(LOCAL_SKILLS_PROFILE_ID).is_some() {
                self.publish(&mut inner);
            }
            return Ok(inner.view());
        }
        let epoch = SourceEpoch::new(status.source_epoch.ok_or(ErrorCode::StorageError)?)?;
        {
            let inner = self.inner.lock().await;
            inner.storage()?;
            if let Some(existing) = inner.profiles.get(LOCAL_SKILLS_PROFILE_ID)
                && existing.identity.source_epoch == epoch
                && existing.view.revision.get() == status.revision
                && existing.view.last_synced_at.0.as_ref().map(Counter::get)
                    == status.last_synced_at
            {
                return Ok(inner.view());
            }
        }
        let profile_id = Id::new(LOCAL_SKILLS_PROFILE_ID)?;
        let nodes: Vec<BookmarkNode> = storage
            .bookmarks(profile_id.clone(), epoch)
            .await?
            .into_iter()
            .filter(|row| row.deleted_at.is_none())
            .map(|row| row.node)
            .collect();
        let instance_id = Id::new(LOCAL_SKILLS_INSTANCE_ID)?;
        let display_name = DisplayName::new(LOCAL_SKILLS_DISPLAY_NAME)?;
        let node_count = Counter::new(nodes.len() as u64)?;
        let revision = Counter::new(status.revision)?;
        let last_synced_at = RequiredNullable(status.last_synced_at.map(Counter::new).transpose()?);

        let mut inner = self.inner.lock().await;
        inner.storage()?;
        if let Some(existing) = inner.profiles.get(LOCAL_SKILLS_PROFILE_ID)
            && existing.identity.source_epoch == epoch
            && (existing.view.revision.get() > status.revision
                || (existing.view.revision.get() == status.revision
                    && existing.view.last_synced_at.0.as_ref().map(Counter::get)
                        == status.last_synced_at))
        {
            return Ok(inner.view());
        }
        let identity = StoredIdentity {
            id: profile_id.clone(),
            instance_id: instance_id.clone(),
            display_name: display_name.clone(),
            origin: ProfileOrigin::LocalSkills,
            credential_reference: None,
            source_epoch: epoch,
        };
        let view = BridgeProfile {
            profile_id,
            instance_id,
            display_name,
            connection: BridgeConnection::Local,
            node_count,
            revision,
            last_synced_at,
            error_code: RequiredNullable(None),
        };
        inner.profiles.insert(
            LOCAL_SKILLS_PROFILE_ID.to_owned(),
            ActiveProfile {
                identity,
                view,
                revoked: false,
                session: None,
                close: None,
                nodes,
                seq: 0,
                awaiting_tree: None,
                outbound: None,
                busy: false,
                writes_blocked: false,
                batch_hold: None,
            },
        );
        self.publish(&mut inner);
        Ok(inner.view())
    }

    pub(super) async fn arm_local_watch(&self, db_path: &Path) {
        let Some(directory) = db_path.parent() else {
            return;
        };
        let Some(db_name) = db_path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
        else {
            return;
        };
        if !directory.is_dir() {
            return;
        }
        if let Ok(watch) = spawn_watch(self.clone(), directory, db_name) {
            let previous = self.local_watch.lock().await.replace(watch);
            if let Some(previous) = previous {
                previous.stop.send_replace(true);
                let _ = previous.task.await;
            }
        }
    }

    pub(super) async fn stop_local_watch(&self) {
        let previous = self.local_watch.lock().await.take();
        if let Some(previous) = previous {
            previous.stop.send_replace(true);
            let _ = previous.task.await;
        }
    }
}

fn spawn_watch(bridge: Bridge, directory: &Path, db_name: String) -> Result<Watch> {
    let wal_name = format!("{db_name}-wal");
    let shm_name = format!("{db_name}-shm");
    let (tx, mut events) = tokio::sync::mpsc::channel(1);
    let mut watcher = notify::recommended_watcher(
        move |result: std::result::Result<notify::Event, notify::Error>| {
            let Ok(event) = result else {
                return;
            };
            let matches_db = event.paths.iter().any(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name == db_name || name == wal_name || name == shm_name)
            });
            if matches_db {
                let _ = tx.try_send(());
            }
        },
    )
    .map_err(|_| ErrorCode::PathUnavailable)?;
    watcher
        .watch(directory, notify::RecursiveMode::NonRecursive)
        .map_err(|_| ErrorCode::PathUnavailable)?;
    let (stop, mut stopped) = watch::channel(false);
    let task = tokio::spawn(async move {
        let _watcher = watcher;
        loop {
            tokio::select! {
                changed = stopped.changed() => {
                    if changed.is_err() || *stopped.borrow() {
                        break;
                    }
                }
                event = events.recv() => {
                    if event.is_none() {
                        break;
                    }
                    loop {
                        match tokio::time::timeout(DEBOUNCE, events.recv()).await {
                            Ok(Some(())) => continue,
                            Ok(None) => return,
                            Err(_) => break,
                        }
                    }
                    let _ = bridge.reload_local_space().await;
                }
            }
        }
    });
    Ok(Watch { stop, task })
}
