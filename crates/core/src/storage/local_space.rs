//! Dedicated local bookmark library (`local-skills`) owned solely by Rust SQLite transactions.
//! Never synchronized to or written back to Chrome `Bookmarks` or MV3 extension sessions.
use super::{Result, SCHEMA_VERSION, Storage, cursor, maintenance, semantic, storage_error};
use crate::{editing, tags as tag_rules};
use markbridge_protocol::{
    BookmarkNode, Counter, DisplayName, EditDocumentKind, ErrorCode, ExportMetadata, ExportSource,
    Id, NodeKind, Position, RequiredNullable, SourceEpoch, TagCatalog, TagCommand, TagItem, Title,
    TreeSnapshot, Url, chrome_time,
};
use rand::{TryRngCore, rngs::OsRng};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub const LOCAL_SKILLS_PROFILE_ID: &str = "local-skills";
pub const LOCAL_SKILLS_INSTANCE_ID: &str = "local-skills";
pub const LOCAL_SKILLS_SESSION_ID: &str = "local-skills";
pub const LOCAL_SKILLS_ORIGIN: &str = "markbridge-local://skills";
pub const LOCAL_SKILLS_DISPLAY_NAME: &str = "Skills 书签库";
pub const LOCAL_SKILLS_ROOT_ID: &str = "skills-root";
pub const LOCAL_SKILLS_ROOT_TITLE: &str = "Skills 书签";

const MAX_SUMMARY_CHARS: usize = 16_384;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkillsStatus {
    pub schema_version: u32,
    pub initialized: bool,
    pub profile_id: String,
    pub display_name: String,
    pub root_id: String,
    pub source_epoch: Option<u64>,
    pub revision: u64,
    pub folder_count: u64,
    pub bookmark_count: u64,
    pub last_synced_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTreeItem {
    pub bookmark_id: Id,
    pub node: BookmarkNode,
    pub children: Vec<LocalTreeItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalNodeDetail {
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub revision: Counter,
    pub bookmark_id: Id,
    pub node: BookmarkNode,
    pub ancestors: Vec<Title>,
    pub tags: Vec<TagItem>,
    pub note: String,
    pub summary: Option<String>,
    pub display_title: Option<String>,
    pub metadata_updated_at: Option<Counter>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalNodeMutation {
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub revision: Counter,
    pub bookmark_id: Id,
    pub node: BookmarkNode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDeleteOutcome {
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub revision: Counter,
    pub deleted_chrome_ids: Vec<Id>,
    pub deleted_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBackupOutcome {
    pub schema_version: u32,
    pub bytes: u64,
}

pub fn validate_local_bookmark_url(raw: &str) -> Result<Url> {
    let url = Url::new(raw)?;
    if raw.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err(ErrorCode::InvalidMessage);
    }
    let parsed = url::Url::parse(raw).map_err(|_| ErrorCode::InvalidMessage)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ErrorCode::InvalidMessage);
    }
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err(ErrorCode::InvalidMessage);
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(url)
}

pub fn validate_local_title(raw: &str, non_empty: bool) -> Result<Title> {
    if raw.chars().any(char::is_control) {
        return Err(ErrorCode::InvalidMessage);
    }
    if non_empty && raw.trim().is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    Title::new(raw)
}

fn validate_summary_text(raw: Option<&str>) -> Result<Option<String>> {
    let Some(text) = raw else {
        return Ok(None);
    };
    if text.contains('\0') || text.chars().count() > MAX_SUMMARY_CHARS {
        return Err(ErrorCode::InvalidMessage);
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed.to_owned()))
    }
}

fn require_local_profile_id(profile_id: &Id) -> Result<()> {
    if profile_id.as_str() != LOCAL_SKILLS_PROFILE_ID {
        return Err(ErrorCode::WrongProfile);
    }
    Ok(())
}

fn now_millis() -> Result<i64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::StorageError)?
        .as_millis();
    i64::try_from(millis).map_err(|_| ErrorCode::StorageError)
}

#[derive(Clone)]
struct ActiveRow {
    bookmark_id: Id,
    node: BookmarkNode,
}

fn verify_local_profile_row(conn: &Connection) -> Result<Option<(SourceEpoch, Option<u64>)>> {
    let row = conn
        .query_row(
            "SELECT instance_id,source_epoch,pairing_state,paired_origin,credential_reference,last_synced_at FROM profiles WHERE id=?1",
            [LOCAL_SKILLS_PROFILE_ID],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(storage_error)?;
    let Some((instance, epoch, state, origin, credential, synced)) = row else {
        return Ok(None);
    };
    if instance != LOCAL_SKILLS_INSTANCE_ID
        || state != "paired"
        || origin != LOCAL_SKILLS_ORIGIN
        || credential.is_some()
        || epoch < 1
    {
        return Err(ErrorCode::Conflict);
    }
    let epoch = SourceEpoch::new(epoch as u64)?;
    let synced = synced
        .map(|value| u64::try_from(value).map_err(|_| ErrorCode::StorageError))
        .transpose()?;
    Ok(Some((epoch, synced)))
}

fn read_local_status(conn: &Connection) -> Result<LocalSkillsStatus> {
    let Some((epoch, last_synced_at)) = verify_local_profile_row(conn)? else {
        return Ok(LocalSkillsStatus {
            schema_version: SCHEMA_VERSION,
            initialized: false,
            profile_id: LOCAL_SKILLS_PROFILE_ID.to_owned(),
            display_name: LOCAL_SKILLS_DISPLAY_NAME.to_owned(),
            root_id: LOCAL_SKILLS_ROOT_ID.to_owned(),
            source_epoch: None,
            revision: 0,
            folder_count: 0,
            bookmark_count: 0,
            last_synced_at: None,
        });
    };
    let local_id = Id::new(LOCAL_SKILLS_PROFILE_ID)?;
    let revision = cursor(conn, &local_id)?
        .filter(|row| row.source_epoch == epoch)
        .map_or(0, |row| row.revision.get());
    let (folders, bookmarks): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(node_kind='folder'),0), COALESCE(SUM(node_kind='bookmark'),0) FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND deleted_at IS NULL",
            params![LOCAL_SKILLS_PROFILE_ID, epoch.get() as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(storage_error)?;
    Ok(LocalSkillsStatus {
        schema_version: SCHEMA_VERSION,
        initialized: true,
        profile_id: LOCAL_SKILLS_PROFILE_ID.to_owned(),
        display_name: LOCAL_SKILLS_DISPLAY_NAME.to_owned(),
        root_id: LOCAL_SKILLS_ROOT_ID.to_owned(),
        source_epoch: Some(epoch.get()),
        revision,
        folder_count: u64::try_from(folders).map_err(|_| ErrorCode::StorageError)?,
        bookmark_count: u64::try_from(bookmarks).map_err(|_| ErrorCode::StorageError)?,
        last_synced_at,
    })
}

fn load_active_rows(conn: &Connection, epoch: SourceEpoch) -> Result<Vec<ActiveRow>> {
    let mut statement = conn
        .prepare(
            "SELECT bookmark_id,node_json FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND deleted_at IS NULL ORDER BY parent_id,position,chrome_id",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(
            params![LOCAL_SKILLS_PROFILE_ID, epoch.get() as i64],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(storage_error)?;
    let mut out = Vec::new();
    for row in rows {
        let (bookmark_id, json) = row.map_err(storage_error)?;
        out.push(ActiveRow {
            bookmark_id: Id::new(bookmark_id)?,
            node: serde_json::from_str(&json).map_err(|_| ErrorCode::StorageError)?,
        });
    }
    Ok(out)
}

fn exists_in_other_profile(conn: &Connection, chrome_id: &Id) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM bookmarks_cache WHERE profile_id<>?1 AND chrome_id=?2 AND deleted_at IS NULL)",
        params![LOCAL_SKILLS_PROFILE_ID, chrome_id.as_str()],
        |row| row.get(0),
    )
    .map_err(storage_error)
}

fn missing_node_error(
    conn: &Connection,
    chrome_id: &Id,
    default_err: ErrorCode,
) -> Result<ErrorCode> {
    if exists_in_other_profile(conn, chrome_id)? {
        Ok(ErrorCode::WrongProfile)
    } else {
        Ok(default_err)
    }
}

fn next_cursor_values(conn: &Connection, epoch: SourceEpoch) -> Result<(Counter, Counter)> {
    let local_id = Id::new(LOCAL_SKILLS_PROFILE_ID)?;
    match cursor(conn, &local_id)? {
        Some(cur) if cur.source_epoch == epoch => Ok((
            Counter::new(
                cur.last_seq
                    .get()
                    .checked_add(1)
                    .ok_or(ErrorCode::LimitExceeded)?,
            )?,
            Counter::new(
                cur.revision
                    .get()
                    .checked_add(1)
                    .ok_or(ErrorCode::LimitExceeded)?,
            )?,
        )),
        _ => Ok((Counter::new(1)?, Counter::new(1)?)),
    }
}

fn write_cursor_and_sync(
    conn: &Connection,
    epoch: SourceEpoch,
    seq: Counter,
    revision: Counter,
    now: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO source_cursors(profile_id,source_epoch,session_id,last_seq,revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id) DO UPDATE SET source_epoch=excluded.source_epoch,session_id=excluded.session_id,last_seq=excluded.last_seq,revision=excluded.revision",
        params![
            LOCAL_SKILLS_PROFILE_ID,
            epoch.get() as i64,
            LOCAL_SKILLS_SESSION_ID,
            seq.get() as i64,
            revision.get() as i64,
        ],
    )
    .map_err(storage_error)?;
    conn.execute(
        "UPDATE profiles SET last_synced_at=?2 WHERE id=?1",
        params![LOCAL_SKILLS_PROFILE_ID, now],
    )
    .map_err(storage_error)?;
    Ok(())
}

fn upsert_bookmark_node(
    conn: &Connection,
    epoch: SourceEpoch,
    node: &BookmarkNode,
    revision: Counter,
) -> Result<Id> {
    let kind = match node.kind {
        NodeKind::Folder => "folder",
        NodeKind::Bookmark => "bookmark",
    };
    let json = serde_json::to_string(node).map_err(|_| ErrorCode::StorageError)?;
    conn.execute(
        "INSERT INTO bookmarks_cache(profile_id,source_epoch,chrome_id,parent_id,position,node_kind,title,url,folder_type,unmodifiable,node_json,revision,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL,NULL,?9,?10,NULL) ON CONFLICT(profile_id,source_epoch,chrome_id) DO UPDATE SET parent_id=excluded.parent_id,position=excluded.position,node_kind=excluded.node_kind,title=excluded.title,url=excluded.url,folder_type=NULL,unmodifiable=NULL,node_json=excluded.node_json,revision=excluded.revision,deleted_at=NULL",
        params![
            LOCAL_SKILLS_PROFILE_ID,
            epoch.get() as i64,
            node.chrome_id.as_str(),
            node.parent_id.as_ref().map(Id::as_str),
            node.position.get() as i64,
            kind,
            node.title.as_str(),
            node.url.as_ref().map(Url::as_str),
            json,
            revision.get() as i64,
        ],
    )
    .map_err(storage_error)?;
    let bookmark_id: String = conn
        .query_row(
            "SELECT bookmark_id FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND chrome_id=?3",
            params![
                LOCAL_SKILLS_PROFILE_ID,
                epoch.get() as i64,
                node.chrome_id.as_str()
            ],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    Id::new(bookmark_id)
}

fn validate_local_snapshot(
    epoch: SourceEpoch,
    revision: Counter,
    seq: Counter,
    nodes: &[BookmarkNode],
) -> Result<()> {
    let snapshot = TreeSnapshot {
        source_epoch: epoch,
        revision,
        barrier_seq: seq,
        nodes: nodes.to_vec(),
    };
    snapshot.validate()?;
    // Enforce contiguous 0..N-1 sibling positions under every parent (including None root).
    let mut by_parent: HashMap<Option<&str>, Vec<u64>> = HashMap::new();
    for node in nodes {
        by_parent
            .entry(node.parent_id.as_ref().map(Id::as_str))
            .or_default()
            .push(node.position.get());
    }
    for positions in by_parent.values_mut() {
        positions.sort_unstable();
        for (expected, actual) in positions.iter().enumerate() {
            if *actual != expected as u64 {
                return Err(ErrorCode::InvalidTree);
            }
        }
    }
    if !nodes.iter().any(|node| {
        node.chrome_id.as_str() == LOCAL_SKILLS_ROOT_ID
            && node.parent_id.is_none()
            && node.kind == NodeKind::Folder
    }) {
        return Err(ErrorCode::ProtectedNode);
    }
    Ok(())
}

fn ensure_local_tx(conn: &Connection) -> Result<SourceEpoch> {
    let now = now_millis()?;
    let now_u64 = u64::try_from(now).map_err(|_| ErrorCode::StorageError)?;
    let epoch = match verify_local_profile_row(conn)? {
        Some((epoch, _)) => epoch,
        None => {
            let epoch = SourceEpoch::new(1)?;
            let display_name = DisplayName::new(LOCAL_SKILLS_DISPLAY_NAME)?;
            conn.execute(
                "INSERT INTO profiles(id,instance_id,source_epoch,display_name,pairing_state,last_synced_at,paired_origin,credential_reference) VALUES(?1,?2,?3,?4,'paired',?5,?6,NULL)",
                params![
                    LOCAL_SKILLS_PROFILE_ID,
                    LOCAL_SKILLS_INSTANCE_ID,
                    epoch.get() as i64,
                    display_name.as_str(),
                    now,
                    LOCAL_SKILLS_ORIGIN,
                ],
            )
            .map_err(storage_error)?;
            epoch
        }
    };
    let rows = load_active_rows(conn, epoch)?;
    let has_root = rows
        .iter()
        .any(|row| row.node.chrome_id.as_str() == LOCAL_SKILLS_ROOT_ID);
    if !has_root {
        let (seq, revision) = next_cursor_values(conn, epoch)?;
        let root_position = rows
            .iter()
            .filter(|row| row.node.parent_id.is_none())
            .count() as u64;
        let root = BookmarkNode {
            chrome_id: Id::new(LOCAL_SKILLS_ROOT_ID)?,
            parent_id: None,
            position: Position::new(root_position)?,
            kind: NodeKind::Folder,
            title: Title::new(LOCAL_SKILLS_ROOT_TITLE)?,
            url: None,
            folder_type: None,
            unmodifiable: None,
            date_added: Some(chrome_time(now_u64)?),
            date_last_used: None,
        };
        let mut all_nodes: Vec<BookmarkNode> = rows.into_iter().map(|row| row.node).collect();
        all_nodes.push(root.clone());
        validate_local_snapshot(epoch, revision, seq, &all_nodes)?;
        upsert_bookmark_node(conn, epoch, &root, revision)?;
        write_cursor_and_sync(conn, epoch, seq, revision, now)?;
    } else if cursor(conn, &Id::new(LOCAL_SKILLS_PROFILE_ID)?)?.is_none() {
        let one = Counter::new(1)?;
        write_cursor_and_sync(conn, epoch, one, one, now)?;
    }
    Ok(epoch)
}

fn generate_local_chrome_id(conn: &Connection, epoch: SourceEpoch, prefix: &str) -> Result<Id> {
    for _ in 0..16 {
        let mut bytes = [0_u8; 8];
        OsRng
            .try_fill_bytes(&mut bytes)
            .map_err(|_| ErrorCode::StorageError)?;
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let candidate = Id::new(format!("{prefix}:{hex}"))?;
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND chrome_id=?3)",
                params![LOCAL_SKILLS_PROFILE_ID, epoch.get() as i64, candidate.as_str()],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        if !exists {
            return Ok(candidate);
        }
    }
    Err(ErrorCode::StorageError)
}

fn reindex_siblings(
    nodes: &mut [BookmarkNode],
    parent_id: Option<&Id>,
    insert_id: Option<&Id>,
    requested_position: Option<u64>,
) -> Result<HashSet<String>> {
    let mut sibling_indices: Vec<usize> = nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| {
            node.parent_id.as_ref() == parent_id
                && insert_id.is_none_or(|moving| &node.chrome_id != moving)
        })
        .map(|(idx, _)| idx)
        .collect();
    sibling_indices.sort_by(|&a, &b| {
        nodes[a]
            .position
            .get()
            .cmp(&nodes[b].position.get())
            .then_with(|| nodes[a].chrome_id.as_str().cmp(nodes[b].chrome_id.as_str()))
    });
    if let Some(moving) = insert_id {
        if let Some(pos) = requested_position {
            Position::new(pos)?;
        }
        let moving_idx = nodes
            .iter()
            .position(|node| &node.chrome_id == moving)
            .ok_or(ErrorCode::InvalidTree)?;
        let slot = requested_position
            .map(|pos| {
                usize::try_from(pos)
                    .unwrap_or(sibling_indices.len())
                    .min(sibling_indices.len())
            })
            .unwrap_or(sibling_indices.len());
        sibling_indices.insert(slot, moving_idx);
    }
    let mut touched = HashSet::new();
    for (order, &idx) in sibling_indices.iter().enumerate() {
        let next_pos = Position::new(order as u64)?;
        if nodes[idx].position != next_pos || insert_id.is_some_and(|m| &nodes[idx].chrome_id == m)
        {
            nodes[idx].position = next_pos;
            touched.insert(nodes[idx].chrome_id.as_str().to_owned());
        }
    }
    Ok(touched)
}

fn read_node_detail(
    conn: &Connection,
    epoch: SourceEpoch,
    chrome_id: &Id,
) -> Result<LocalNodeDetail> {
    let rows = load_active_rows(conn, epoch)?;
    let by_id: HashMap<&str, &ActiveRow> = rows
        .iter()
        .map(|row| (row.node.chrome_id.as_str(), row))
        .collect();
    let Some(target) = by_id.get(chrome_id.as_str()).copied() else {
        return Err(missing_node_error(
            conn,
            chrome_id,
            ErrorCode::InvalidMessage,
        )?);
    };
    let mut ancestors = Vec::new();
    let mut cursor_parent = target.node.parent_id.as_ref();
    let mut seen = HashSet::new();
    while let Some(parent_id) = cursor_parent {
        if !seen.insert(parent_id.as_str()) {
            return Err(ErrorCode::InvalidTree);
        }
        let parent = by_id
            .get(parent_id.as_str())
            .ok_or(ErrorCode::InvalidTree)?;
        ancestors.push(parent.node.title.clone());
        cursor_parent = parent.node.parent_id.as_ref();
    }
    ancestors.reverse();

    let meta = conn
        .query_row(
            "SELECT display_title,summary,note,updated_at FROM bookmark_metadata WHERE bookmark_id=?1",
            [target.bookmark_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(storage_error)?;
    let (display_title, summary, note, updated_at) = match meta {
        Some((display, summary, note, updated)) => (
            display,
            summary,
            note,
            Some(Counter::new(
                u64::try_from(updated.max(0)).map_err(|_| ErrorCode::StorageError)?,
            )?),
        ),
        None => (None, None, String::new(), None),
    };

    let mut tag_stmt = conn
        .prepare(
            "SELECT t.id,t.name,(SELECT COUNT(*) FROM bookmark_tags bt2 JOIN bookmarks_cache c2 ON c2.bookmark_id=bt2.bookmark_id WHERE bt2.tag_id=t.id AND c2.profile_id=?1 AND c2.source_epoch=?2 AND c2.deleted_at IS NULL) FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id WHERE bt.bookmark_id=?3 ORDER BY t.normalized_name",
        )
        .map_err(storage_error)?;
    let tag_rows = tag_stmt
        .query_map(
            params![
                LOCAL_SKILLS_PROFILE_ID,
                epoch.get() as i64,
                target.bookmark_id.as_str()
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(storage_error)?;
    let mut tags = Vec::new();
    for row in tag_rows {
        let (tag_id, name, count) = row.map_err(storage_error)?;
        tags.push(TagItem {
            tag_id: Id::new(tag_id)?,
            name,
            count: Counter::new(u64::try_from(count.max(0)).map_err(|_| ErrorCode::StorageError)?)?,
        });
    }
    let local_id = Id::new(LOCAL_SKILLS_PROFILE_ID)?;
    let revision = cursor(conn, &local_id)?
        .filter(|row| row.source_epoch == epoch)
        .map_or(Counter::new(0)?, |row| row.revision);
    Ok(LocalNodeDetail {
        profile_id: local_id,
        source_epoch: epoch,
        revision,
        bookmark_id: target.bookmark_id.clone(),
        node: target.node.clone(),
        ancestors,
        tags,
        note,
        summary,
        display_title,
        metadata_updated_at: updated_at,
    })
}

fn build_tree_items(
    rows: &[ActiveRow],
    folder_id: Option<&Id>,
    max_depth: u64,
) -> Result<Vec<LocalTreeItem>> {
    let by_id: HashMap<&str, &ActiveRow> = rows
        .iter()
        .map(|row| (row.node.chrome_id.as_str(), row))
        .collect();
    if let Some(root_id) = folder_id {
        let Some(folder) = by_id.get(root_id.as_str()) else {
            return Err(ErrorCode::InvalidTree);
        };
        if folder.node.kind != NodeKind::Folder {
            return Err(ErrorCode::InvalidTree);
        }
    }
    let mut children_map: HashMap<Option<&str>, Vec<&ActiveRow>> = HashMap::new();
    for row in rows {
        children_map
            .entry(row.node.parent_id.as_ref().map(Id::as_str))
            .or_default()
            .push(row);
    }
    for siblings in children_map.values_mut() {
        siblings.sort_by(|a, b| {
            a.node
                .position
                .get()
                .cmp(&b.node.position.get())
                .then_with(|| a.node.chrome_id.as_str().cmp(b.node.chrome_id.as_str()))
        });
    }
    fn walk<'a>(
        parent: Option<&'a str>,
        depth: u64,
        max_depth: u64,
        children_map: &HashMap<Option<&'a str>, Vec<&'a ActiveRow>>,
    ) -> Vec<LocalTreeItem> {
        let Some(items) = children_map.get(&parent) else {
            return Vec::new();
        };
        items
            .iter()
            .map(|row| LocalTreeItem {
                bookmark_id: row.bookmark_id.clone(),
                node: row.node.clone(),
                children: if row.node.kind == NodeKind::Folder
                    && (max_depth == 0 || depth < max_depth)
                {
                    walk(
                        Some(row.node.chrome_id.as_str()),
                        depth + 1,
                        max_depth,
                        children_map,
                    )
                } else {
                    Vec::new()
                },
            })
            .collect()
    }
    Ok(walk(folder_id.map(Id::as_str), 1, max_depth, &children_map))
}

impl Storage {
    pub async fn local_skills_status(&self) -> Result<LocalSkillsStatus> {
        self.call(|conn| read_local_status(conn)).await
    }

    pub async fn ensure_local_skills_space(&self) -> Result<LocalSkillsStatus> {
        self.call(|conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            ensure_local_tx(&tx)?;
            let status = read_local_status(&tx)?;
            tx.commit().map_err(storage_error)?;
            Ok(status)
        })
        .await
    }

    pub async fn local_tree(
        &self,
        profile_id: Id,
        folder_id: Option<Id>,
        depth: Option<u64>,
    ) -> Result<Vec<LocalTreeItem>> {
        require_local_profile_id(&profile_id)?;
        self.call(move |conn| {
            let Some((epoch, _)) = verify_local_profile_row(conn)? else {
                if let Some(id) = &folder_id {
                    return Err(missing_node_error(conn, id, ErrorCode::InvalidTree)?);
                }
                return Ok(Vec::new());
            };
            let rows = load_active_rows(conn, epoch)?;
            if let Some(id) = &folder_id
                && !rows.iter().any(|row| &row.node.chrome_id == id)
            {
                return Err(missing_node_error(conn, id, ErrorCode::InvalidTree)?);
            }
            build_tree_items(&rows, folder_id.as_ref(), depth.unwrap_or(0))
        })
        .await
    }

    pub async fn local_node_detail(
        &self,
        profile_id: Id,
        chrome_id: Id,
    ) -> Result<LocalNodeDetail> {
        require_local_profile_id(&profile_id)?;
        self.call(move |conn| {
            let Some((epoch, _)) = verify_local_profile_row(conn)? else {
                return Err(missing_node_error(conn, &chrome_id, ErrorCode::Unpaired)?);
            };
            read_node_detail(conn, epoch, &chrome_id)
        })
        .await
    }

    pub async fn local_mkdir(
        &self,
        profile_id: Id,
        parent_id: Option<Id>,
        title: String,
        position: Option<u64>,
    ) -> Result<LocalNodeMutation> {
        require_local_profile_id(&profile_id)?;
        let title = validate_local_title(&title, true)?;
        self.call(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let epoch = ensure_local_tx(&tx)?;
            let parent_id = match parent_id {
                Some(id) => id,
                None => Id::new(LOCAL_SKILLS_ROOT_ID)?,
            };
            let rows = load_active_rows(&tx, epoch)?;
            let Some(parent_row) = rows.iter().find(|row| row.node.chrome_id == parent_id) else {
                return Err(missing_node_error(&tx, &parent_id, ErrorCode::InvalidTree)?);
            };
            if parent_row.node.kind != NodeKind::Folder {
                return Err(ErrorCode::InvalidTree);
            }
            let now = now_millis()?;
            let now_u64 = u64::try_from(now).map_err(|_| ErrorCode::StorageError)?;
            let (seq, revision) = next_cursor_values(&tx, epoch)?;
            let new_chrome_id = generate_local_chrome_id(&tx, epoch, "local-f")?;
            let mut nodes: Vec<BookmarkNode> = rows.into_iter().map(|row| row.node).collect();
            nodes.push(BookmarkNode {
                chrome_id: new_chrome_id.clone(),
                parent_id: Some(parent_id.clone()),
                position: Position::new(0)?,
                kind: NodeKind::Folder,
                title,
                url: None,
                folder_type: None,
                unmodifiable: None,
                date_added: Some(chrome_time(now_u64)?),
                date_last_used: None,
            });
            let touched =
                reindex_siblings(&mut nodes, Some(&parent_id), Some(&new_chrome_id), position)?;
            validate_local_snapshot(epoch, revision, seq, &nodes)?;
            let mut created_bookmark_id = None;
            let mut created_node = None;
            for node in &nodes {
                if touched.contains(node.chrome_id.as_str()) {
                    let b_id = upsert_bookmark_node(&tx, epoch, node, revision)?;
                    if node.chrome_id == new_chrome_id {
                        created_bookmark_id = Some(b_id);
                        created_node = Some(node.clone());
                    }
                }
            }
            write_cursor_and_sync(&tx, epoch, seq, revision, now)?;
            tx.commit().map_err(storage_error)?;
            Ok(LocalNodeMutation {
                profile_id,
                source_epoch: epoch,
                revision,
                bookmark_id: created_bookmark_id.ok_or(ErrorCode::StorageError)?,
                node: created_node.ok_or(ErrorCode::StorageError)?,
            })
        })
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn local_add_bookmark(
        &self,
        profile_id: Id,
        parent_id: Option<Id>,
        title: String,
        url: String,
        position: Option<u64>,
        tags: Vec<String>,
        note: Option<String>,
        summary: Option<String>,
    ) -> Result<LocalNodeMutation> {
        require_local_profile_id(&profile_id)?;
        let title = validate_local_title(&title, true)?;
        let url = validate_local_bookmark_url(&url)?;
        if let Some(note_ref) = &note {
            tag_rules::note_ok(note_ref)?;
        }
        let summary = validate_summary_text(summary.as_deref())?;
        let mut normalized_tags = Vec::new();
        let mut seen_keys = HashSet::new();
        for raw_tag in &tags {
            let norm = tag_rules::normalize_tag(raw_tag)?;
            if seen_keys.insert(norm.key.clone()) {
                normalized_tags.push(norm.display);
            }
        }
        if normalized_tags.len() > tag_rules::TAGS_PER_BOOKMARK {
            return Err(ErrorCode::LimitExceeded);
        }
        self.call(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let epoch = ensure_local_tx(&tx)?;
            let parent_id = match parent_id {
                Some(id) => id,
                None => Id::new(LOCAL_SKILLS_ROOT_ID)?,
            };
            let rows = load_active_rows(&tx, epoch)?;
            let Some(parent_row) = rows.iter().find(|row| row.node.chrome_id == parent_id) else {
                return Err(missing_node_error(&tx, &parent_id, ErrorCode::InvalidTree)?);
            };
            if parent_row.node.kind != NodeKind::Folder {
                return Err(ErrorCode::InvalidTree);
            }
            let now = now_millis()?;
            let now_u64 = u64::try_from(now).map_err(|_| ErrorCode::StorageError)?;
            let (seq, revision) = next_cursor_values(&tx, epoch)?;
            let new_chrome_id = generate_local_chrome_id(&tx, epoch, "local-b")?;
            let mut nodes: Vec<BookmarkNode> = rows.into_iter().map(|row| row.node).collect();
            nodes.push(BookmarkNode {
                chrome_id: new_chrome_id.clone(),
                parent_id: Some(parent_id.clone()),
                position: Position::new(0)?,
                kind: NodeKind::Bookmark,
                title,
                url: Some(url),
                folder_type: None,
                unmodifiable: None,
                date_added: Some(chrome_time(now_u64)?),
                date_last_used: None,
            });
            let touched =
                reindex_siblings(&mut nodes, Some(&parent_id), Some(&new_chrome_id), position)?;
            validate_local_snapshot(epoch, revision, seq, &nodes)?;
            let mut created_bookmark_id = None;
            let mut created_node = None;
            for node in &nodes {
                if touched.contains(node.chrome_id.as_str()) {
                    let b_id = upsert_bookmark_node(&tx, epoch, node, revision)?;
                    if node.chrome_id == new_chrome_id {
                        created_bookmark_id = Some(b_id);
                        created_node = Some(node.clone());
                    }
                }
            }
            let bookmark_id = created_bookmark_id.ok_or(ErrorCode::StorageError)?;
            if let Some(note_text) = note {
                super::tags::apply(
                    &tx,
                    &profile_id,
                    &TagCommand::SetNote {
                        chrome_ids: vec![new_chrome_id.clone()],
                        note: note_text,
                    },
                )?;
            }
            if let Some(summary_text) = summary {
                tx.execute(
                    "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,updated_at) VALUES(?1,NULL,?2,'',?3) ON CONFLICT(bookmark_id) DO UPDATE SET summary=excluded.summary,updated_at=excluded.updated_at",
                    params![bookmark_id.as_str(), summary_text, now],
                )
                .map_err(storage_error)?;
                maintenance::sync_metadata_fts(&tx, bookmark_id.as_str())?;
            }
            for tag_name in normalized_tags {
                super::tags::apply(
                    &tx,
                    &profile_id,
                    &TagCommand::Add {
                        chrome_ids: vec![new_chrome_id.clone()],
                        name: tag_name,
                    },
                )?;
            }
            write_cursor_and_sync(&tx, epoch, seq, revision, now)?;
            tx.commit().map_err(storage_error)?;
            Ok(LocalNodeMutation {
                profile_id,
                source_epoch: epoch,
                revision,
                bookmark_id,
                node: created_node.ok_or(ErrorCode::StorageError)?,
            })
        })
        .await
    }

    pub async fn local_update_node(
        &self,
        profile_id: Id,
        chrome_id: Id,
        title: Option<String>,
        url: Option<String>,
    ) -> Result<LocalNodeMutation> {
        require_local_profile_id(&profile_id)?;
        if title.is_none() && url.is_none() {
            return Err(ErrorCode::InvalidMessage);
        }
        if chrome_id.as_str() == LOCAL_SKILLS_ROOT_ID {
            return Err(ErrorCode::ProtectedNode);
        }
        let parsed_title = title
            .as_deref()
            .map(|value| validate_local_title(value, true))
            .transpose()?;
        let parsed_url = url
            .as_deref()
            .map(validate_local_bookmark_url)
            .transpose()?;
        self.call(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let Some((epoch, _)) = verify_local_profile_row(&tx)? else {
                return Err(missing_node_error(&tx, &chrome_id, ErrorCode::Unpaired)?);
            };
            let rows = load_active_rows(&tx, epoch)?;
            let mut nodes: Vec<BookmarkNode> = rows.iter().map(|row| row.node.clone()).collect();
            let Some(target_idx) = nodes.iter().position(|node| node.chrome_id == chrome_id) else {
                return Err(missing_node_error(
                    &tx,
                    &chrome_id,
                    ErrorCode::InvalidMessage,
                )?);
            };
            if nodes[target_idx].kind == NodeKind::Folder && parsed_url.is_some() {
                return Err(ErrorCode::InvalidMessage);
            }
            if let Some(new_title) = parsed_title {
                nodes[target_idx].title = new_title;
            }
            if let Some(new_url) = parsed_url {
                nodes[target_idx].url = Some(new_url);
            }
            let now = now_millis()?;
            let (seq, revision) = next_cursor_values(&tx, epoch)?;
            validate_local_snapshot(epoch, revision, seq, &nodes)?;
            let updated_node = nodes[target_idx].clone();
            let bookmark_id = upsert_bookmark_node(&tx, epoch, &updated_node, revision)?;
            write_cursor_and_sync(&tx, epoch, seq, revision, now)?;
            tx.commit().map_err(storage_error)?;
            Ok(LocalNodeMutation {
                profile_id,
                source_epoch: epoch,
                revision,
                bookmark_id,
                node: updated_node,
            })
        })
        .await
    }

    pub async fn local_move_node(
        &self,
        profile_id: Id,
        chrome_id: Id,
        parent_id: Id,
        position: Option<u64>,
    ) -> Result<LocalNodeMutation> {
        require_local_profile_id(&profile_id)?;
        if chrome_id.as_str() == LOCAL_SKILLS_ROOT_ID {
            return Err(ErrorCode::ProtectedNode);
        }
        if let Some(pos) = position {
            Position::new(pos)?;
        }
        self.call(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let Some((epoch, _)) = verify_local_profile_row(&tx)? else {
                return Err(missing_node_error(&tx, &chrome_id, ErrorCode::Unpaired)?);
            };
            let rows = load_active_rows(&tx, epoch)?;
            let mut nodes: Vec<BookmarkNode> = rows.into_iter().map(|row| row.node).collect();
            let Some(target_idx) = nodes.iter().position(|node| node.chrome_id == chrome_id) else {
                return Err(missing_node_error(
                    &tx,
                    &chrome_id,
                    ErrorCode::InvalidMessage,
                )?);
            };
            let Some(parent_idx) = nodes.iter().position(|node| node.chrome_id == parent_id) else {
                return Err(missing_node_error(&tx, &parent_id, ErrorCode::InvalidTree)?);
            };
            if nodes[parent_idx].kind != NodeKind::Folder || chrome_id == parent_id {
                return Err(ErrorCode::InvalidTree);
            }
            // Reject moving a folder into any of its own descendants.
            {
                let by_id: HashMap<&str, &BookmarkNode> = nodes
                    .iter()
                    .map(|node| (node.chrome_id.as_str(), node))
                    .collect();
                let mut walk = Some(parent_id.as_str());
                let mut seen = HashSet::new();
                while let Some(curr) = walk {
                    if curr == chrome_id.as_str() || !seen.insert(curr) {
                        return Err(ErrorCode::InvalidTree);
                    }
                    walk = by_id
                        .get(curr)
                        .and_then(|node| node.parent_id.as_ref().map(Id::as_str));
                }
            }
            let old_parent = nodes[target_idx].parent_id.clone();
            nodes[target_idx].parent_id = Some(parent_id.clone());
            let mut touched =
                reindex_siblings(&mut nodes, Some(&parent_id), Some(&chrome_id), position)?;
            if old_parent.as_ref() != Some(&parent_id) {
                let old_touched = reindex_siblings(&mut nodes, old_parent.as_ref(), None, None)?;
                touched.extend(old_touched);
            }
            touched.insert(chrome_id.as_str().to_owned());
            let now = now_millis()?;
            let (seq, revision) = next_cursor_values(&tx, epoch)?;
            validate_local_snapshot(epoch, revision, seq, &nodes)?;
            let mut moved_bookmark_id = None;
            let mut moved_node = None;
            for node in &nodes {
                if touched.contains(node.chrome_id.as_str()) {
                    let b_id = upsert_bookmark_node(&tx, epoch, node, revision)?;
                    if node.chrome_id == chrome_id {
                        moved_bookmark_id = Some(b_id);
                        moved_node = Some(node.clone());
                    }
                }
            }
            write_cursor_and_sync(&tx, epoch, seq, revision, now)?;
            tx.commit().map_err(storage_error)?;
            Ok(LocalNodeMutation {
                profile_id,
                source_epoch: epoch,
                revision,
                bookmark_id: moved_bookmark_id.ok_or(ErrorCode::StorageError)?,
                node: moved_node.ok_or(ErrorCode::StorageError)?,
            })
        })
        .await
    }

    pub async fn local_delete_node(
        &self,
        profile_id: Id,
        chrome_id: Id,
        recursive: bool,
    ) -> Result<LocalDeleteOutcome> {
        require_local_profile_id(&profile_id)?;
        if chrome_id.as_str() == LOCAL_SKILLS_ROOT_ID {
            return Err(ErrorCode::ProtectedNode);
        }
        self.call(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let Some((epoch, _)) = verify_local_profile_row(&tx)? else {
                return Err(missing_node_error(&tx, &chrome_id, ErrorCode::Unpaired)?);
            };
            let rows = load_active_rows(&tx, epoch)?;
            let Some(target_row) = rows.iter().find(|row| row.node.chrome_id == chrome_id) else {
                return Err(missing_node_error(&tx, &chrome_id, ErrorCode::InvalidMessage)?);
            };
            let old_parent = target_row.node.parent_id.clone();
            let mut subtree = HashSet::from([chrome_id.as_str().to_owned()]);
            loop {
                let before = subtree.len();
                for row in &rows {
                    if row
                        .node
                        .parent_id
                        .as_ref()
                        .is_some_and(|parent| subtree.contains(parent.as_str()))
                    {
                        subtree.insert(row.node.chrome_id.as_str().to_owned());
                    }
                }
                if subtree.len() == before {
                    break;
                }
            }
            if subtree.len() > 1 && !recursive {
                return Err(ErrorCode::Conflict);
            }
            let mut deleted_ids: Vec<Id> = rows
                .iter()
                .filter(|row| subtree.contains(row.node.chrome_id.as_str()))
                .map(|row| row.node.chrome_id.clone())
                .collect();
            deleted_ids.sort_by(|a, b| a.as_str().cmp(b.as_str()));

            let mut remaining: Vec<BookmarkNode> = rows
                .into_iter()
                .filter(|row| !subtree.contains(row.node.chrome_id.as_str()))
                .map(|row| row.node)
                .collect();
            let touched = reindex_siblings(&mut remaining, old_parent.as_ref(), None, None)?;
            let now = now_millis()?;
            let (seq, revision) = next_cursor_values(&tx, epoch)?;
            validate_local_snapshot(epoch, revision, seq, &remaining)?;
            {
                let mut remove = tx
                    .prepare(
                        "UPDATE bookmarks_cache SET deleted_at=?4,revision=?5 WHERE profile_id=?1 AND source_epoch=?2 AND chrome_id=?3 AND deleted_at IS NULL",
                    )
                    .map_err(storage_error)?;
                for id in &deleted_ids {
                    remove
                        .execute(params![
                            LOCAL_SKILLS_PROFILE_ID,
                            epoch.get() as i64,
                            id.as_str(),
                            now,
                            revision.get() as i64,
                        ])
                        .map_err(storage_error)?;
                }
            }
            for node in &remaining {
                if touched.contains(node.chrome_id.as_str()) {
                    upsert_bookmark_node(&tx, epoch, node, revision)?;
                }
            }
            semantic::invalidate_final_tree(&tx, &profile_id, epoch)?;
            write_cursor_and_sync(&tx, epoch, seq, revision, now)?;
            tx.commit().map_err(storage_error)?;
            let deleted_count = deleted_ids.len() as u64;
            Ok(LocalDeleteOutcome {
                profile_id,
                source_epoch: epoch,
                revision,
                deleted_chrome_ids: deleted_ids,
                deleted_count,
            })
        })
        .await
    }

    pub async fn local_mutate_tags(
        &self,
        profile_id: Id,
        command: TagCommand,
    ) -> Result<TagCatalog> {
        require_local_profile_id(&profile_id)?;
        if matches!(command, TagCommand::SetEncoding { .. }) {
            return Err(ErrorCode::ReadOnly);
        }
        self.call(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let Some((epoch, _)) = verify_local_profile_row(&tx)? else {
                for id in super::tags::command_ids(&command) {
                    if exists_in_other_profile(&tx, id)? {
                        return Err(ErrorCode::WrongProfile);
                    }
                }
                return Err(ErrorCode::Unpaired);
            };
            let active = load_active_rows(&tx, epoch)?;
            let active_ids: HashSet<&str> = active
                .iter()
                .map(|row| row.node.chrome_id.as_str())
                .collect();
            for id in super::tags::command_ids(&command) {
                if !active_ids.contains(id.as_str()) {
                    return Err(missing_node_error(&tx, id, ErrorCode::InvalidMessage)?);
                }
            }
            let outcome = super::tags::apply(&tx, &profile_id, &command)?;
            if outcome.affected > 0 {
                let now = now_millis()?;
                let (seq, revision) = next_cursor_values(&tx, epoch)?;
                write_cursor_and_sync(&tx, epoch, seq, revision, now)?;
            }
            let mut catalog = super::tags::read_catalog(
                &tx,
                &profile_id,
                super::tags::command_ids(&command),
                None,
            )?;
            catalog.affected = Counter::new(outcome.affected)?;
            catalog.merge_required = outcome.merge_required;
            catalog.source_tag_id = RequiredNullable(outcome.source);
            catalog.target_tag_id = RequiredNullable(outcome.target);
            tx.commit().map_err(storage_error)?;
            Ok(catalog)
        })
        .await
    }

    pub async fn local_set_summary(
        &self,
        profile_id: Id,
        chrome_id: Id,
        summary: Option<String>,
    ) -> Result<LocalNodeDetail> {
        require_local_profile_id(&profile_id)?;
        let summary = validate_summary_text(summary.as_deref())?;
        self.call(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let Some((epoch, _)) = verify_local_profile_row(&tx)? else {
                return Err(missing_node_error(&tx, &chrome_id, ErrorCode::Unpaired)?);
            };
            let rows = load_active_rows(&tx, epoch)?;
            let Some(target) = rows.iter().find(|row| row.node.chrome_id == chrome_id) else {
                return Err(missing_node_error(&tx, &chrome_id, ErrorCode::InvalidMessage)?);
            };
            if target.node.kind != NodeKind::Bookmark {
                return Err(ErrorCode::InvalidMessage);
            }
            let now = now_millis()?;
            tx.execute(
                "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,updated_at) VALUES(?1,NULL,?2,'',?3) ON CONFLICT(bookmark_id) DO UPDATE SET summary=excluded.summary,updated_at=excluded.updated_at",
                params![target.bookmark_id.as_str(), summary, now],
            )
            .map_err(storage_error)?;
            maintenance::sync_metadata_fts(&tx, target.bookmark_id.as_str())?;
            let (seq, revision) = next_cursor_values(&tx, epoch)?;
            write_cursor_and_sync(&tx, epoch, seq, revision, now)?;
            let detail = read_node_detail(&tx, epoch, &chrome_id)?;
            tx.commit().map_err(storage_error)?;
            Ok(detail)
        })
        .await
    }

    pub async fn local_export(
        &self,
        profile_id: Id,
        format: EditDocumentKind,
    ) -> Result<(ExportMetadata, String)> {
        require_local_profile_id(&profile_id)?;
        let (epoch, last_synced_at, revision, nodes) = self
            .call({
                let profile_id = profile_id.clone();
                move |conn| {
                    let Some((epoch, last_synced_at)) = verify_local_profile_row(conn)? else {
                        return Err(ErrorCode::Unpaired);
                    };
                    let revision = cursor(conn, &profile_id)?
                        .filter(|row| row.source_epoch == epoch)
                        .map_or(Counter::new(0)?, |row| row.revision);
                    let nodes: Vec<BookmarkNode> = load_active_rows(conn, epoch)?
                        .into_iter()
                        .map(|row| row.node)
                        .collect();
                    Ok((epoch, last_synced_at, revision, nodes))
                }
            })
            .await?;
        let now = u64::try_from(now_millis()?).map_err(|_| ErrorCode::StorageError)?;
        let metadata = ExportMetadata {
            source: ExportSource::Profile {
                id: profile_id.clone(),
            },
            display_name: DisplayName::new(LOCAL_SKILLS_DISPLAY_NAME)?,
            format,
            source_epoch: RequiredNullable(Some(epoch)),
            revision,
            cached_at: RequiredNullable(last_synced_at.map(Counter::new).transpose()?),
            exported_at: Counter::new(now)?,
            node_count: Counter::new(nodes.len() as u64)?,
        };
        let body = match format {
            EditDocumentKind::Sidecar => {
                let entries = self.export_sidecar_entries(profile_id, epoch).await?;
                serde_json::to_string_pretty(&serde_json::json!({
                    "schemaVersion": 2,
                    "metadata": metadata,
                    "entries": entries,
                }))
                .map_err(|_| ErrorCode::StorageError)?
            }
            EditDocumentKind::Html => {
                let html = editing::render_netscape(&nodes)?;
                let info = serde_json::to_string(&metadata)
                    .map_err(|_| ErrorCode::StorageError)?
                    .replace('<', "\\u003c")
                    .replace('>', "\\u003e")
                    .replace('-', "\\u002d");
                format!("{html}<!-- Markbridge export {info} -->\n")
            }
        };
        if body.chars().count() > editing::MAX_DOCUMENT_CHARS {
            return Err(ErrorCode::LimitExceeded);
        }
        Ok((metadata, body))
    }

    pub async fn backup_database(&self, dest: PathBuf) -> Result<LocalBackupOutcome> {
        self.call(move |conn| {
            if let Some(parent) = dest.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent).map_err(|_| ErrorCode::StorageError)?;
            }
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&dest)
                .map_err(|err| {
                    if err.kind() == std::io::ErrorKind::AlreadyExists {
                        ErrorCode::Conflict
                    } else {
                        ErrorCode::StorageError
                    }
                })?;
            if let Err(err) = conn.backup("main", &dest, None) {
                let _ = std::fs::remove_file(&dest);
                return Err(storage_error(err));
            }
            let bytes = std::fs::metadata(&dest)
                .map_err(|_| ErrorCode::StorageError)?
                .len();
            Ok(LocalBackupOutcome {
                schema_version: SCHEMA_VERSION,
                bytes,
            })
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{PairedOrigin, Profile, ProfileOrigin};

    #[tokio::test]
    async fn local_space_rejects_spoofed_profile_origin_and_extension_writes() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("local_space.sqlite");
        let storage = Storage::open(&db).await.unwrap();

        // Chrome pairing cannot claim reserved `local-skills` id
        let bad_profile = Profile {
            id: Id::new(LOCAL_SKILLS_PROFILE_ID).unwrap(),
            instance_id: Id::new("inst-spoof").unwrap(),
            source_epoch: SourceEpoch::new(1).unwrap(),
            display_name: DisplayName::new("Spoof").unwrap(),
            paired_origin: PairedOrigin::new("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .unwrap(),
            credential_reference: None,
        };
        assert_eq!(
            storage.create_profile(bad_profile).await.unwrap_err(),
            ErrorCode::WrongProfile
        );

        let status = storage.ensure_local_skills_space().await.unwrap();
        assert!(status.initialized);
        assert_eq!(status.schema_version, 8);
        assert_eq!(status.folder_count, 1);

        let local_id = Id::new(LOCAL_SKILLS_PROFILE_ID).unwrap();
        assert_eq!(
            storage.revoke_profile(local_id.clone()).await.unwrap_err(),
            ErrorCode::ReadOnly
        );
        assert_eq!(
            storage
                .reset_source_epoch(local_id.clone(), SourceEpoch::new(2).unwrap())
                .await
                .unwrap_err(),
            ErrorCode::ReadOnly
        );
        assert_eq!(
            storage
                .replace_tree(
                    local_id,
                    Id::new("sess").unwrap(),
                    TreeSnapshot {
                        source_epoch: SourceEpoch::new(1).unwrap(),
                        revision: Counter::new(2).unwrap(),
                        barrier_seq: Counter::new(2).unwrap(),
                        nodes: vec![],
                    }
                )
                .await
                .unwrap_err(),
            ErrorCode::WrongProfile
        );
        storage.close().await.unwrap();

        // Spoofed non-local row using markbridge-local://skills origin is rejected by profiles()
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "INSERT INTO profiles(id,instance_id,source_epoch,display_name,pairing_state,paired_origin,credential_reference) VALUES('spoof-id','spoof-id',1,'Spoof','paired','markbridge-local://skills',NULL)",
            [],
        )
        .unwrap();
        drop(conn);

        let reopened = Storage::open(&db).await.unwrap();
        assert_eq!(
            reopened.profiles().await.unwrap_err(),
            ErrorCode::InvalidMessage
        );
        reopened.close().await.unwrap();
    }

    #[tokio::test]
    async fn local_space_maintains_contiguous_positions_and_cleans_semantic_members_on_delete() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("positions.sqlite");
        let storage = Storage::open(&db).await.unwrap();
        let pid = Id::new(LOCAL_SKILLS_PROFILE_ID).unwrap();

        let b0 = storage
            .local_add_bookmark(
                pid.clone(),
                None,
                "First".into(),
                "https://example.com/1".into(),
                None,
                vec![],
                None,
                None,
            )
            .await
            .unwrap();
        let b1 = storage
            .local_add_bookmark(
                pid.clone(),
                None,
                "Second".into(),
                "https://example.com/2".into(),
                None,
                vec![],
                None,
                None,
            )
            .await
            .unwrap();
        let b2 = storage
            .local_add_bookmark(
                pid.clone(),
                None,
                "Third".into(),
                "https://example.com/3".into(),
                Some(1),
                vec![],
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(b2.node.position.get(), 1);

        // Seed semantic member for b2, delete b2, verify semantic_members cleaned & remaining positions 0..=1
        storage
            .call({
                let bm_id = b2.bookmark_id.clone();
                move |conn| {
                    conn.execute(
                        "INSERT INTO semantic_indexes(index_id,profile_id,source_epoch,generation,phase,model,endpoint,recipe) VALUES('idx-1','local-skills',1,1,'ready','bge-m3','http://127.0.0.1:11434',1)",
                        [],
                    )
                    .unwrap();
                    conn.execute(
                        "INSERT INTO semantic_members(index_id,bookmark_id,state) VALUES('idx-1',?1,'pending')",
                        [bm_id.as_str()],
                    )
                    .unwrap();
                    Ok(())
                }
            })
            .await
            .unwrap();

        storage
            .local_delete_node(pid.clone(), b2.node.chrome_id, false)
            .await
            .unwrap();

        let tree = storage.local_tree(pid.clone(), None, None).await.unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].children.len(), 2);
        assert_eq!(tree[0].children[0].node.chrome_id, b0.node.chrome_id);
        assert_eq!(tree[0].children[0].node.position.get(), 0);
        assert_eq!(tree[0].children[1].node.chrome_id, b1.node.chrome_id);
        assert_eq!(tree[0].children[1].node.position.get(), 1);

        let profiles = storage.profiles().await.unwrap();
        assert_eq!(profiles[0].profile.origin, ProfileOrigin::LocalSkills);

        let remaining_members: i64 = storage
            .call(|conn| {
                Ok(conn
                    .query_row(
                        "SELECT COUNT(*) FROM semantic_members WHERE index_id='idx-1'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap())
            })
            .await
            .unwrap();
        assert_eq!(remaining_members, 0);
        storage.close().await.unwrap();
    }
}
