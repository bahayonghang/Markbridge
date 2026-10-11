//! Rust owns this serial SQLite worker. No caller receives a Connection or raw SQL API.
use markbridge_protocol::{
    BookmarkNode, Counter, DisplayName, ErrorCode, Id, MirrorFileStatus, SourceEpoch, TreeSnapshot,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{mpsc, oneshot};

mod operations;
mod tags;
pub(crate) use operations::{
    AfterBody, BeforeBody, EncodingBody, IdMapBody, OperationRecord, OrderBody, RestoreBody,
    SidecarRow, StepRecord,
};

const MIGRATIONS: &[&str] = &[
    include_str!("migrations/001_identity.sql"),
    include_str!("migrations/002_history.sql"),
    include_str!("migrations/003_mirror.sql"),
    include_str!("migrations/004_tags.sql"),
];
pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;
type Result<T> = std::result::Result<T, ErrorCode>;
type Job = Box<dyn FnOnce(&mut Connection) + Send>;

#[derive(Debug, Clone)]
pub struct Profile {
    pub id: Id,
    pub instance_id: Id,
    pub source_epoch: SourceEpoch,
    pub display_name: DisplayName,
    pub paired_origin: PairedOrigin,
    pub credential_reference: Option<Id>,
}
#[derive(Debug, Clone)]
pub struct StoredProfile {
    pub profile: Profile,
    pub revoked: bool,
    pub last_synced_at: Option<Counter>,
}
/// Origin comes from the authenticated transport header, never from a hello payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairedOrigin(String);
impl PairedOrigin {
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        let extension = value
            .strip_prefix("chrome-extension://")
            .ok_or(ErrorCode::InvalidMessage)?;
        if extension.len() != 32 || !extension.bytes().all(|c| (b'a'..=b'p').contains(&c)) {
            return Err(ErrorCode::InvalidMessage);
        }
        Ok(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cursor {
    pub source_epoch: SourceEpoch,
    pub session_id: Id,
    pub last_seq: Counter,
    pub revision: Counter,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedBookmark {
    pub bookmark_id: Id,
    pub node: BookmarkNode,
    pub revision: Counter,
    pub deleted_at: Option<Counter>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Metadata {
    pub display_title: Option<String>,
    pub summary: Option<String>,
    pub note: String,
    pub updated_at: Counter,
}

pub struct Storage {
    sender: mpsc::Sender<Job>,
    finished: oneshot::Receiver<()>,
    /// Local-only path. Never serialize the path into a frontend or transport DTO.
    pub migration_backup: Option<PathBuf>,
}
impl Storage {
    pub async fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_owned();
        let (sender, mut receiver) = mpsc::channel::<Job>(32);
        let (ready_tx, ready_rx) = oneshot::channel();
        let (finished_tx, finished) = oneshot::channel();
        std::thread::Builder::new()
            .name("markbridge-storage".into())
            .spawn(move || {
                let initialized = Connection::open(&path)
                    .map_err(|_| ErrorCode::StorageError)
                    .and_then(|mut conn| {
                        let backup = migrate(&mut conn, &path, MIGRATIONS)?;
                        conn.busy_timeout(Duration::from_secs(5))
                            .map_err(storage_error)?;
                        conn.pragma_update(None, "journal_mode", "WAL")
                            .map_err(storage_error)?;
                        conn.pragma_update(None, "foreign_keys", true)
                            .map_err(storage_error)?;
                        Ok((conn, backup))
                    });
                match initialized {
                    Ok((mut conn, backup)) => {
                        if ready_tx.send(Ok(backup)).is_ok() {
                            while let Some(job) = receiver.blocking_recv() {
                                job(&mut conn);
                            }
                        }
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                    }
                }
                let _ = finished_tx.send(());
            })
            .map_err(|_| ErrorCode::StorageError)?;
        let migration_backup = ready_rx.await.map_err(|_| ErrorCode::StorageError)??;
        Ok(Self {
            sender,
            finished,
            migration_backup,
        })
    }
    pub(super) async fn call<T: Send + 'static>(
        &self,
        job: impl FnOnce(&mut Connection) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(Box::new(move |conn| {
                let _ = tx.send(job(conn));
            }))
            .await
            .map_err(|_| ErrorCode::StorageError)?;
        rx.await.map_err(|_| ErrorCode::StorageError)?
    }
    pub async fn close(self) -> Result<()> {
        drop(self.sender);
        self.finished.await.map_err(|_| ErrorCode::StorageError)
    }
    pub async fn create_profile(&self, profile: Profile) -> Result<()> {
        self.call(move |conn| {
            conn.execute("INSERT INTO profiles(id,instance_id,source_epoch,display_name,pairing_state,paired_origin,credential_reference) VALUES(?1,?2,?3,?4,'paired',?5,?6)",
                params![profile.id.as_str(), profile.instance_id.as_str(), profile.source_epoch.get() as i64, profile.display_name.as_str(), profile.paired_origin.as_str(), profile.credential_reference.as_ref().map(Id::as_str)]).map_err(storage_error)?;
            Ok(())
        }).await
    }
    pub async fn profiles(&self) -> Result<Vec<StoredProfile>> {
        self.call(|conn| {
            let mut statement = conn.prepare("SELECT id,instance_id,source_epoch,display_name,paired_origin,credential_reference,pairing_state,last_synced_at FROM profiles ORDER BY id").map_err(storage_error)?;
            let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, Option<String>>(5)?, row.get::<_, String>(6)?, row.get::<_, Option<i64>>(7)?))).map_err(storage_error)?;
            rows.map(|row| {
                let (id, instance, epoch, name, origin, reference, state, synced) = row.map_err(storage_error)?;
                Ok(StoredProfile { profile: Profile { id: Id::new(id)?, instance_id: Id::new(instance)?, source_epoch: SourceEpoch::new(epoch as u64)?, display_name: DisplayName::new(name)?, paired_origin: PairedOrigin::new(origin)?, credential_reference: reference.map(Id::new).transpose()? }, revoked: state == "revoked", last_synced_at: synced.map(|value| Counter::new(value as u64)).transpose()? })
            }).collect()
        }).await
    }
    /// Revocation preserves cache and local metadata. The OS credential is removed by Bridge.
    pub async fn revoke_profile(&self, profile_id: Id) -> Result<()> {
        self.call(move |conn| {
            if conn.execute("UPDATE profiles SET pairing_state='revoked',credential_reference=NULL WHERE id=?1", [profile_id.as_str()]).map_err(storage_error)? != 1 { return Err(ErrorCode::WrongProfile); }
            Ok(())
        }).await
    }
    /// Identity reset is explicit. Old cache and sidecar rows remain available for review.
    pub async fn reset_source_epoch(&self, profile_id: Id, epoch: SourceEpoch) -> Result<()> {
        self.call(move |conn| {
            let transaction = conn.transaction().map_err(storage_error)?;
            let changed = transaction
                .execute(
                    "UPDATE profiles SET source_epoch=?2 WHERE id=?1 AND source_epoch<?2",
                    params![profile_id.as_str(), epoch.get() as i64],
                )
                .map_err(storage_error)?;
            if changed != 1 {
                return Err(ErrorCode::Conflict);
            }
            transaction
                .execute(
                    "DELETE FROM source_cursors WHERE profile_id=?1",
                    [profile_id.as_str()],
                )
                .map_err(storage_error)?;
            transaction.commit().map_err(storage_error)
        })
        .await
    }
    pub async fn replace_tree(
        &self,
        profile_id: Id,
        session_id: Id,
        snapshot: TreeSnapshot,
    ) -> Result<()> {
        self.call(move |conn| replace_tree(conn, &profile_id, &session_id, &snapshot, || Ok(())))
            .await
    }
    pub(crate) async fn replace_tree_delta(
        &self,
        profile_id: Id,
        session_id: Id,
        previous: Vec<BookmarkNode>,
        snapshot: TreeSnapshot,
    ) -> Result<()> {
        self.call(move |conn| {
            commit_tree(
                conn,
                &profile_id,
                &session_id,
                &snapshot,
                Some(&previous),
                || Ok(()),
            )
        })
        .await
    }
    pub async fn bookmarks(
        &self,
        profile_id: Id,
        epoch: SourceEpoch,
    ) -> Result<Vec<CachedBookmark>> {
        self.call(move |conn| {
            let mut statement = conn.prepare("SELECT bookmark_id,node_json,revision,deleted_at FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 ORDER BY parent_id,position,chrome_id").map_err(storage_error)?;
            let rows = statement.query_map(params![profile_id.as_str(), epoch.get() as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, Option<i64>>(3)?))
            }).map_err(storage_error)?;
            rows.map(|row| {
                let (id, node, revision, deleted) = row.map_err(storage_error)?;
                Ok(CachedBookmark { bookmark_id: Id::new(id)?, node: serde_json::from_str(&node).map_err(|_| ErrorCode::StorageError)?,
                    revision: Counter::new(revision as u64)?, deleted_at: deleted.map(|value| Counter::new(value as u64)).transpose()? })
            }).collect()
        }).await
    }
    pub async fn cursor(&self, profile_id: Id) -> Result<Option<Cursor>> {
        self.call(move |conn| cursor(conn, &profile_id)).await
    }
    pub async fn set_metadata(&self, bookmark_id: Id, metadata: Metadata) -> Result<()> {
        self.call(move |conn| {
            conn.execute("INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(bookmark_id) DO UPDATE SET display_title=excluded.display_title,summary=excluded.summary,note=excluded.note,updated_at=excluded.updated_at",
                params![bookmark_id.as_str(), metadata.display_title, metadata.summary, metadata.note, metadata.updated_at.get() as i64]).map_err(storage_error)?;
            Ok(())
        }).await
    }
    pub async fn metadata(&self, bookmark_id: Id) -> Result<Option<Metadata>> {
        self.call(move |conn| {
            let row = conn.query_row("SELECT display_title,summary,note,updated_at FROM bookmark_metadata WHERE bookmark_id=?1", [bookmark_id.as_str()], |row| {
                Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?))
            }).optional().map_err(storage_error)?;
            row.map(|(display_title, summary, note, updated)| Ok(Metadata { display_title, summary, note, updated_at: Counter::new(updated as u64)? })).transpose()
        }).await
    }
    pub async fn mirrors(&self) -> Result<Vec<StoredMirror>> {
        self.call(|conn| load_mirrors(conn)).await
    }
    /// Writes mirror identity and, when requested, replaces only `mirror_bookmarks`.
    /// Profile cache, metadata, and tags are not updated.
    pub async fn put_mirror(&self, mirror: StoredMirror, replace_nodes: bool) -> Result<()> {
        self.call(move |conn| write_mirror(conn, &mirror, replace_nodes))
            .await
    }
}

#[derive(Debug, Clone)]
pub struct StoredMirror {
    pub id: Id,
    pub path: String,
    pub display_name: DisplayName,
    pub paired_profile_id: Option<Id>,
    pub confirmed: bool,
    pub watching: bool,
    pub file_status: MirrorFileStatus,
    pub revision: u64,
    pub last_read_at: Option<u64>,
    pub error_code: Option<ErrorCode>,
    pub nodes: Vec<BookmarkNode>,
}
fn storage_error(_: rusqlite::Error) -> ErrorCode {
    ErrorCode::StorageError
}
fn cursor(conn: &Connection, profile_id: &Id) -> Result<Option<Cursor>> {
    let row = conn.query_row("SELECT source_epoch,session_id,last_seq,revision FROM source_cursors WHERE profile_id=?1", [profile_id.as_str()], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?))
    }).optional().map_err(storage_error)?;
    row.map(|(epoch, session, seq, revision)| {
        Ok(Cursor {
            source_epoch: SourceEpoch::new(epoch as u64)?,
            session_id: Id::new(session)?,
            last_seq: Counter::new(seq as u64)?,
            revision: Counter::new(revision as u64)?,
        })
    })
    .transpose()
}
fn replace_tree(
    conn: &mut Connection,
    profile_id: &Id,
    session_id: &Id,
    snapshot: &TreeSnapshot,
    before_commit: impl FnOnce() -> Result<()>,
) -> Result<()> {
    commit_tree(conn, profile_id, session_id, snapshot, None, before_commit)
}
fn commit_tree(
    conn: &mut Connection,
    profile_id: &Id,
    session_id: &Id,
    snapshot: &TreeSnapshot,
    previous_nodes: Option<&[BookmarkNode]>,
    before_commit: impl FnOnce() -> Result<()>,
) -> Result<()> {
    snapshot.validate()?;
    let transaction = conn.transaction().map_err(storage_error)?;
    let epoch: Option<i64> = transaction
        .query_row(
            "SELECT source_epoch FROM profiles WHERE id=?1",
            [profile_id.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    if epoch != Some(snapshot.source_epoch.get() as i64) {
        return Err(ErrorCode::WrongProfile);
    }
    if let Some(previous) = cursor(&transaction, profile_id)? {
        if previous_nodes.is_some()
            && (previous.session_id != *session_id
                || snapshot.revision.get() != previous.revision.get() + 1
                || snapshot.barrier_seq.get() != previous.last_seq.get() + 1)
        {
            return Err(ErrorCode::Conflict);
        }
        if snapshot.revision.get() <= previous.revision.get() {
            return Err(ErrorCode::Conflict);
        }
        if previous.session_id == *session_id
            && snapshot.barrier_seq.get() < previous.last_seq.get()
        {
            return Err(ErrorCode::Conflict);
        }
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::StorageError)?
        .as_millis() as i64;
    let previous: std::collections::HashMap<_, _> = previous_nodes
        .unwrap_or(&[])
        .iter()
        .map(|node| (&node.chrome_id, node))
        .collect();
    if previous_nodes.is_some() {
        let current: std::collections::HashSet<_> =
            snapshot.nodes.iter().map(|node| &node.chrome_id).collect();
        let mut remove = transaction.prepare("UPDATE bookmarks_cache SET deleted_at=?4,revision=?5 WHERE profile_id=?1 AND source_epoch=?2 AND chrome_id=?3 AND deleted_at IS NULL").map_err(storage_error)?;
        for id in previous.keys().filter(|id| !current.contains(**id)) {
            remove
                .execute(params![
                    profile_id.as_str(),
                    snapshot.source_epoch.get() as i64,
                    id.as_str(),
                    now,
                    snapshot.revision.get() as i64
                ])
                .map_err(storage_error)?;
        }
    } else {
        transaction.execute("UPDATE bookmarks_cache SET deleted_at=?3,revision=?4 WHERE profile_id=?1 AND source_epoch=?2 AND deleted_at IS NULL", params![profile_id.as_str(), snapshot.source_epoch.get() as i64, now, snapshot.revision.get() as i64]).map_err(storage_error)?;
    }
    {
        let mut insert = transaction.prepare("INSERT INTO bookmarks_cache(profile_id,source_epoch,chrome_id,parent_id,position,node_kind,title,url,folder_type,unmodifiable,node_json,revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(profile_id,source_epoch,chrome_id) DO UPDATE SET parent_id=excluded.parent_id,position=excluded.position,node_kind=excluded.node_kind,title=excluded.title,url=excluded.url,folder_type=excluded.folder_type,unmodifiable=excluded.unmodifiable,node_json=excluded.node_json,revision=excluded.revision,deleted_at=NULL").map_err(storage_error)?;
        for node in &snapshot.nodes {
            if previous
                .get(&node.chrome_id)
                .is_some_and(|old| *old == node)
            {
                continue;
            }
            let kind = match node.kind {
                markbridge_protocol::NodeKind::Folder => "folder",
                markbridge_protocol::NodeKind::Bookmark => "bookmark",
            };
            let folder = node.folder_type.as_ref().map(|value| {
                serde_json::to_value(value)
                    .expect("enum serializes")
                    .as_str()
                    .expect("enum is string")
                    .to_owned()
            });
            let unmodifiable = node.unmodifiable.as_ref().map(|_| "managed");
            insert
                .execute(params![
                    profile_id.as_str(),
                    snapshot.source_epoch.get() as i64,
                    node.chrome_id.as_str(),
                    node.parent_id.as_ref().map(Id::as_str),
                    node.position.get() as i64,
                    kind,
                    node.title.as_str(),
                    node.url.as_ref().map(|url| url.as_str()),
                    folder,
                    unmodifiable,
                    serde_json::to_string(node).map_err(|_| ErrorCode::StorageError)?,
                    snapshot.revision.get() as i64
                ])
                .map_err(storage_error)?;
        }
    }
    transaction.execute("INSERT INTO source_cursors(profile_id,source_epoch,session_id,last_seq,revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id) DO UPDATE SET source_epoch=excluded.source_epoch,session_id=excluded.session_id,last_seq=excluded.last_seq,revision=excluded.revision",
        params![profile_id.as_str(),snapshot.source_epoch.get() as i64,session_id.as_str(),snapshot.barrier_seq.get() as i64,snapshot.revision.get() as i64]).map_err(storage_error)?;
    transaction
        .execute(
            "UPDATE profiles SET last_synced_at=?2 WHERE id=?1",
            params![profile_id.as_str(), now],
        )
        .map_err(storage_error)?;
    before_commit()?;
    transaction.commit().map_err(storage_error)
}

fn status_label(status: MirrorFileStatus) -> &'static str {
    match status {
        MirrorFileStatus::Current => "current",
        MirrorFileStatus::Stale => "stale",
        MirrorFileStatus::Unavailable => "unavailable",
    }
}
fn parse_status(value: &str) -> MirrorFileStatus {
    match value {
        "current" => MirrorFileStatus::Current,
        "unavailable" => MirrorFileStatus::Unavailable,
        _ => MirrorFileStatus::Stale,
    }
}
fn error_label(error: &ErrorCode) -> Result<String> {
    let value = serde_json::to_value(error).map_err(|_| ErrorCode::StorageError)?;
    value
        .as_str()
        .map(str::to_owned)
        .ok_or(ErrorCode::StorageError)
}
fn parse_error_label(value: Option<String>) -> Result<Option<ErrorCode>> {
    value
        .map(|value| {
            serde_json::from_value(serde_json::Value::String(value))
                .map_err(|_| ErrorCode::StorageError)
        })
        .transpose()
}
fn load_mirrors(conn: &Connection) -> Result<Vec<StoredMirror>> {
    let sources = {
        let mut statement = conn
            .prepare("SELECT id,selected_path,display_name,paired_profile_id,association_status,watching,file_status,revision,last_read_at,error_code FROM mirror_sources ORDER BY id")
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                ))
            })
            .map_err(storage_error)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(storage_error)?
    };
    let mut mirrors = Vec::new();
    for (id, path, name, paired, association, watching, status, revision, read_at, error) in sources
    {
        let id = Id::new(id)?;
        let mut nodes = Vec::new();
        {
            let mut node_rows = conn
                .prepare("SELECT node_json FROM mirror_bookmarks WHERE mirror_source_id=?1 ORDER BY chrome_id")
                .map_err(storage_error)?;
            let json_rows = node_rows
                .query_map([id.as_str()], |row| row.get::<_, String>(0))
                .map_err(storage_error)?;
            for json in json_rows {
                let json = json.map_err(storage_error)?;
                if let Ok(node) = serde_json::from_str::<BookmarkNode>(&json) {
                    nodes.push(node);
                }
            }
        }
        let display_name = DisplayName::new(name).or_else(|_| DisplayName::new("文件来源"))?;
        mirrors.push(StoredMirror {
            id,
            path,
            display_name,
            paired_profile_id: paired.map(Id::new).transpose()?,
            confirmed: association == "confirmed",
            watching: watching != 0,
            file_status: parse_status(&status),
            revision: u64::try_from(revision).map_err(|_| ErrorCode::StorageError)?,
            last_read_at: read_at
                .map(|value| u64::try_from(value).map_err(|_| ErrorCode::StorageError))
                .transpose()?,
            error_code: parse_error_label(error)?,
            nodes,
        });
    }
    Ok(mirrors)
}
fn write_mirror(conn: &mut Connection, mirror: &StoredMirror, replace_nodes: bool) -> Result<()> {
    let transaction = conn.transaction().map_err(storage_error)?;
    transaction
        .execute(
            "INSERT INTO mirror_sources(id,selected_path,paired_profile_id,association_status,display_name,file_status,revision,last_read_at,error_code,watching) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET selected_path=excluded.selected_path,paired_profile_id=excluded.paired_profile_id,association_status=excluded.association_status,display_name=excluded.display_name,file_status=excluded.file_status,revision=excluded.revision,last_read_at=excluded.last_read_at,error_code=excluded.error_code,watching=excluded.watching",
            params![
                mirror.id.as_str(),
                mirror.path,
                mirror.paired_profile_id.as_ref().map(Id::as_str),
                if mirror.confirmed { "confirmed" } else { "independent" },
                mirror.display_name.as_str(),
                status_label(mirror.file_status),
                i64::try_from(mirror.revision).map_err(|_| ErrorCode::StorageError)?,
                mirror.last_read_at.map(|value| i64::try_from(value).map_err(|_| ErrorCode::StorageError)).transpose()?,
                mirror.error_code.as_ref().map(error_label).transpose()?,
                if mirror.watching { 1 } else { 0 },
            ],
        )
        .map_err(storage_error)?;
    if replace_nodes {
        transaction
            .execute(
                "DELETE FROM mirror_bookmarks WHERE mirror_source_id=?1",
                [mirror.id.as_str()],
            )
            .map_err(storage_error)?;
        let mut insert = transaction
            .prepare("INSERT INTO mirror_bookmarks(mirror_source_id,chrome_id,node_json) VALUES(?1,?2,?3)")
            .map_err(storage_error)?;
        for node in &mirror.nodes {
            insert
                .execute(params![
                    mirror.id.as_str(),
                    node.chrome_id.as_str(),
                    serde_json::to_string(node).map_err(|_| ErrorCode::StorageError)?,
                ])
                .map_err(storage_error)?;
        }
    }
    transaction.commit().map_err(storage_error)
}
fn migrate(conn: &mut Connection, path: &Path, migrations: &[&str]) -> Result<Option<PathBuf>> {
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(storage_error)?;
    // Reject newer data before changing journal settings or creating a backup.
    if version > migrations.len() as u32 {
        return Err(ErrorCode::StorageNewerSchema);
    }
    if version == migrations.len() as u32 {
        return Ok(None);
    }
    if version == 0 {
        let tables: u32 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        if tables > 0 {
            return Err(ErrorCode::MigrationFailed);
        }
    }
    let backup = if version > 0 {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ErrorCode::StorageError)?
            .as_nanos();
        let backup = path.with_file_name(format!(
            "{}.pre-v{version}-{suffix}.sqlite",
            path.file_name()
                .ok_or(ErrorCode::StorageError)?
                .to_string_lossy()
        ));
        // Reserve a new destination. Never overwrite a prior recovery point.
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)
            .map_err(|_| ErrorCode::StorageError)?;
        conn.backup("main", &backup, None).map_err(storage_error)?;
        Some(backup)
    } else {
        None
    };
    let transaction = conn.transaction().map_err(storage_error)?;
    for (index, sql) in migrations.iter().enumerate().skip(version as usize) {
        transaction
            .execute_batch(sql)
            .map_err(|_| ErrorCode::MigrationFailed)?;
        transaction
            .pragma_update(None, "user_version", (index + 1) as u32)
            .map_err(|_| ErrorCode::MigrationFailed)?;
    }
    transaction
        .commit()
        .map_err(|_| ErrorCode::MigrationFailed)?;
    Ok(backup)
}

#[cfg(test)]
mod tests;
