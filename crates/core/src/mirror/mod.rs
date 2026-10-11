//! Read-only Chrome User Data mirror. This module never writes Bookmarks or Local State.
use markbridge_protocol::{
    BookmarkNode, DisplayName, ErrorCode, FolderType, Id, NodeKind, Position, SourceTime, Title,
    TreeSnapshot, Url, file_time,
};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fs::OpenOptions,
    io::Read,
    path::{Path, PathBuf},
    time::SystemTime,
};

const MAX_LOCAL_STATE_BYTES: usize = 8 * 1024 * 1024;
const MAX_BOOKMARKS_BYTES: usize = 64 * 1024 * 1024;
const ROOT_ID: &str = "0";

pub(crate) const DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(300);
pub(crate) const METADATA_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

type Result<T> = std::result::Result<T, ErrorCode>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryKey(String);
impl DirectoryKey {
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        if value.is_empty()
            || value.chars().count() > 128
            || value.contains(['/', '\\', '\0', ':'])
            || value == "."
            || value == ".."
        {
            return Err(ErrorCode::InvalidMessage);
        }
        Ok(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileStamp {
    pub len: u64,
    pub modified_ms: u64,
}

#[derive(Debug)]
pub(crate) enum LoadError {
    Unavailable(ErrorCode),
    Rejected(ErrorCode),
}

#[derive(Debug)]
pub(crate) struct LoadedProfile {
    pub path: PathBuf,
    pub display_name: DisplayName,
    pub nodes: Vec<BookmarkNode>,
    pub stamp: FileStamp,
}

#[derive(Debug, Deserialize)]
struct LocalStateFile {
    profile: Option<LocalProfile>,
}
#[derive(Debug, Deserialize)]
struct LocalProfile {
    info_cache: Option<BTreeMap<String, ProfileInfo>>,
}
#[derive(Debug, Deserialize)]
struct ProfileInfo {
    name: Option<String>,
}
#[derive(Debug, Deserialize)]
struct BookmarkFile {
    roots: BTreeMap<String, RawNode>,
}
#[derive(Debug, Deserialize)]
struct RawNode {
    id: String,
    name: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    url: Option<String>,
    children: Option<Vec<RawNode>>,
    date_added: Option<serde_json::Value>,
    date_last_used: Option<serde_json::Value>,
}

pub fn enumerate_user_data(root: &Path) -> Result<Vec<markbridge_protocol::ChromeProfileChoice>> {
    let root = require_directory(root)?;
    let state = read_local_state(&root)?;
    let mut profiles = Vec::new();
    let cache = state
        .profile
        .and_then(|profile| profile.info_cache)
        .unwrap_or_default();
    for (key, info) in cache {
        let Ok(directory) = DirectoryKey::new(key) else {
            continue;
        };
        let bookmarks = root.join(directory.as_str()).join("Bookmarks");
        let present = std::fs::metadata(&bookmarks)
            .map(|meta| meta.is_file())
            .unwrap_or(false);
        let display_name = display_name(info.name.as_deref(), directory.as_str())?;
        profiles.push(markbridge_protocol::ChromeProfileChoice {
            directory_key: directory.as_str().to_owned(),
            display_name,
            bookmarks_present: present,
        });
    }
    Ok(profiles)
}

pub(crate) fn load_profile(user_data: &Path, key: &DirectoryKey) -> Result<LoadedProfile> {
    let root = require_directory(user_data)?;
    let profile_dir = root.join(key.as_str());
    if !profile_dir.starts_with(&root) {
        return Err(ErrorCode::InvalidMessage);
    }
    let state = read_local_state(&root)?;
    let listed = state
        .profile
        .and_then(|profile| profile.info_cache)
        .unwrap_or_default();
    let Some(info) = listed.get(key.as_str()) else {
        return Err(ErrorCode::PathUnavailable);
    };
    let (nodes, stamp) = load_bookmarks(&profile_dir).map_err(|error| match error {
        LoadError::Unavailable(code) | LoadError::Rejected(code) => code,
    })?;
    Ok(LoadedProfile {
        path: profile_dir,
        display_name: display_name(info.name.as_deref(), key.as_str())?,
        nodes,
        stamp,
    })
}

pub(crate) fn load_bookmarks(
    profile_dir: &Path,
) -> std::result::Result<(Vec<BookmarkNode>, FileStamp), LoadError> {
    let path = profile_dir.join("Bookmarks");
    let meta = std::fs::metadata(&path).map_err(unavailable)?;
    if !meta.is_file() {
        return Err(LoadError::Unavailable(ErrorCode::PathUnavailable));
    }
    let stamp = FileStamp {
        len: meta.len(),
        modified_ms: modified_ms(meta.modified().ok()),
    };
    let bytes = read_limited(&path, MAX_BOOKMARKS_BYTES).map_err(|error| {
        if error.kind() == std::io::ErrorKind::InvalidData {
            LoadError::Rejected(ErrorCode::LimitExceeded)
        } else {
            unavailable(error)
        }
    })?;
    parse_bookmarks(&bytes)
        .map(|nodes| (nodes, stamp))
        .map_err(LoadError::Rejected)
}

pub fn parse_bookmarks(bytes: &[u8]) -> Result<Vec<BookmarkNode>> {
    let file: BookmarkFile = serde_json::from_slice(bytes).map_err(|_| ErrorCode::InvalidTree)?;
    let mut nodes = vec![folder(ROOT_ID, None, 0, "", None)?];
    let mut seen = std::collections::HashSet::from([ROOT_ID.to_owned()]);
    let mut position = 0_u64;
    let mut keys = file.roots.keys().cloned().collect::<Vec<_>>();
    keys.sort_by(|left, right| root_rank(left).cmp(&root_rank(right)));
    for key in keys {
        let Some(raw) = file.roots.get(&key) else {
            continue;
        };
        let folder_type = root_folder_type(&key);
        append_node(
            raw,
            Some(ROOT_ID),
            position,
            folder_type,
            1,
            &mut nodes,
            &mut seen,
        )?;
        position += 1;
    }
    let snapshot = TreeSnapshot {
        source_epoch: markbridge_protocol::SourceEpoch::new(1)?,
        revision: markbridge_protocol::Counter::new(0)?,
        barrier_seq: markbridge_protocol::Counter::new(0)?,
        nodes: nodes.clone(),
    };
    snapshot.validate()?;
    Ok(nodes)
}

pub fn same_identity(left: &[BookmarkNode], right: &[BookmarkNode]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut right_by_id = BTreeMap::new();
    for node in right {
        if right_by_id.insert(node.chrome_id.as_str(), node).is_some() {
            return false;
        }
    }
    left.iter().all(|node| {
        right_by_id
            .get(node.chrome_id.as_str())
            .is_some_and(|other| {
                other.parent_id == node.parent_id
                    && other.position == node.position
                    && other.kind == node.kind
                    && other.url == node.url
                    && other.folder_type == node.folder_type
            })
    })
}

fn append_node(
    raw: &RawNode,
    parent: Option<&str>,
    position: u64,
    folder_type: Option<FolderType>,
    depth: usize,
    nodes: &mut Vec<BookmarkNode>,
    seen: &mut std::collections::HashSet<String>,
) -> Result<()> {
    if nodes.len() >= markbridge_protocol::MAX_NODES || depth > markbridge_protocol::MAX_DEPTH {
        return Err(ErrorCode::LimitExceeded);
    }
    if !seen.insert(raw.id.clone()) || raw.id == ROOT_ID {
        return Err(ErrorCode::InvalidTree);
    }
    let chrome_id = Id::new(raw.id.clone())?;
    let title = Title::new(raw.name.clone().unwrap_or_default())?;
    let kind = match raw.kind.as_str() {
        "folder" => NodeKind::Folder,
        "url" => NodeKind::Bookmark,
        _ => return Err(ErrorCode::InvalidTree),
    };
    let url = match kind {
        NodeKind::Folder => None,
        NodeKind::Bookmark => Some(Url::new(raw.url.clone().unwrap_or_default())?),
    };
    if kind == NodeKind::Folder && raw.url.as_ref().is_some_and(|url| !url.is_empty()) {
        return Err(ErrorCode::InvalidTree);
    }
    let children = raw.children.as_deref().unwrap_or(&[]);
    if kind == NodeKind::Bookmark && !children.is_empty() {
        return Err(ErrorCode::InvalidTree);
    }
    nodes.push(BookmarkNode {
        chrome_id,
        parent_id: parent.map(Id::new).transpose()?,
        position: Position::new(position)?,
        kind: kind.clone(),
        title,
        url,
        folder_type: if parent == Some(ROOT_ID) {
            folder_type
        } else {
            None
        },
        unmodifiable: None,
        date_added: optional_time(raw.date_added.as_ref()),
        date_last_used: optional_time(raw.date_last_used.as_ref()),
    });
    if kind == NodeKind::Folder {
        for (index, child) in children.iter().enumerate() {
            append_node(
                child,
                Some(raw.id.as_str()),
                index as u64,
                None,
                depth + 1,
                nodes,
                seen,
            )?;
        }
    }
    Ok(())
}

fn folder(
    id: &str,
    parent: Option<&str>,
    position: u64,
    title: &str,
    folder_type: Option<FolderType>,
) -> Result<BookmarkNode> {
    Ok(BookmarkNode {
        chrome_id: Id::new(id)?,
        parent_id: parent.map(Id::new).transpose()?,
        position: Position::new(position)?,
        kind: NodeKind::Folder,
        title: Title::new(title)?,
        url: None,
        folder_type,
        unmodifiable: None,
        date_added: None,
        date_last_used: None,
    })
}

fn root_rank(key: &str) -> (u8, &str) {
    let rank = match key {
        "bookmark_bar" => 0,
        "other" => 1,
        "synced" => 2,
        _ => 3,
    };
    (rank, key)
}
fn root_folder_type(key: &str) -> Option<FolderType> {
    match key {
        "bookmark_bar" => Some(FolderType::BookmarksBar),
        "other" => Some(FolderType::Other),
        "synced" => Some(FolderType::Mobile),
        _ => None,
    }
}
fn optional_time(value: Option<&serde_json::Value>) -> Option<SourceTime> {
    let value = value?;
    let parsed = if let Some(text) = value.as_str() {
        text.parse::<u64>().ok()?
    } else {
        value.as_u64()?
    };
    file_time(parsed).ok()
}
fn display_name(name: Option<&str>, key: &str) -> Result<DisplayName> {
    let trimmed = name.unwrap_or("").trim();
    DisplayName::new(trimmed)
        .or_else(|_| DisplayName::new(key))
        .or_else(|_| DisplayName::new("Chrome 资料"))
}
fn require_directory(root: &Path) -> Result<PathBuf> {
    if !root.is_absolute() {
        return Err(ErrorCode::PathUnavailable);
    }
    let meta = std::fs::metadata(root).map_err(|_| ErrorCode::PathUnavailable)?;
    if !meta.is_dir() {
        return Err(ErrorCode::PathUnavailable);
    }
    std::fs::canonicalize(root).map_err(|_| ErrorCode::PathUnavailable)
}
fn read_local_state(root: &Path) -> Result<LocalStateFile> {
    let path = root.join("Local State");
    let bytes = read_limited(&path, MAX_LOCAL_STATE_BYTES).map_err(map_state_io)?;
    serde_json::from_slice(&bytes).map_err(|_| ErrorCode::PathUnavailable)
}
fn map_state_io(error: std::io::Error) -> ErrorCode {
    if error.kind() == std::io::ErrorKind::InvalidData {
        ErrorCode::LimitExceeded
    } else {
        ErrorCode::PathUnavailable
    }
}
fn unavailable(error: std::io::Error) -> LoadError {
    let _ = error;
    LoadError::Unavailable(ErrorCode::PathUnavailable)
}
fn read_limited(path: &Path, max: usize) -> std::io::Result<Vec<u8>> {
    let mut file = OpenOptions::new().read(true).write(false).open(path)?;
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = file.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read) > max {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "file limit",
            ));
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    Ok(bytes)
}
fn modified_ms(modified: Option<SystemTime>) -> u64 {
    modified
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|time| u64::try_from(time.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
