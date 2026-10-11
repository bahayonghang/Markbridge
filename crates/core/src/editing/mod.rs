//! Confirmed edits, backups, and conditional undo. This module does not call Chrome.
use markbridge_protocol::{
    BookmarkNode, EditAction, EditField, EditFieldChange, ErrorCode, FolderType, Id, Mutation,
    NodeKind, OperationConflict, OperationState, OperationStep, RequiredNullable, Unmodifiable,
};
use rand::{TryRngCore, rngs::OsRng};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

pub const LARGE_DELETE: u64 = 20;
pub const MAX_DOCUMENT_CHARS: usize = 8_000_000;

#[derive(Clone, Debug)]
pub struct LocalRef {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    pub note: String,
    pub summary: Option<String>,
    pub display_title: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ChildOrder {
    pub parent_id: Id,
    pub child_ids: Vec<Id>,
}

#[derive(Clone, Debug)]
pub struct RestoreHint {
    pub request_id: Id,
    pub old_chrome_id: Id,
    pub old_bookmark_id: Id,
}

#[derive(Clone, Debug)]
pub struct Plan {
    pub steps: Vec<OperationStep>,
    pub affected: u64,
    pub requires_second_confirm: bool,
    pub changes: Vec<EditFieldChange>,
    pub orders: Vec<ChildOrder>,
    pub restores: Vec<RestoreHint>,
    pub undo_of: Option<Id>,
    pub conflicts: Vec<OperationConflict>,
}

#[derive(Clone, Debug)]
pub struct StoredStep {
    pub request_id: Id,
    pub payload: Mutation,
    pub before: Option<BookmarkNode>,
    pub after: Option<BookmarkNode>,
    pub before_child_ids: Option<Vec<Id>>,
    pub after_child_ids: Option<Vec<Id>>,
    pub applied: bool,
}

#[derive(Clone, Debug)]
pub struct StoredEdit {
    pub operation_id: Id,
    pub state: OperationState,
    pub steps: Vec<StoredStep>,
    pub orders: Vec<ChildOrder>,
    /// Tree captured before the original write. Delete undo reads descendants from it.
    pub snapshot: Vec<BookmarkNode>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MutationKind {
    Create,
    Delete,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttemptPhase {
    Marker,
    Effect,
    Receipt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub phase: AttemptPhase,
    pub kind: MutationKind,
    pub receipt_applied: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Resume {
    Execute,
    Replay,
    Uncertain,
}

struct Index<'a> {
    by_id: HashMap<&'a str, &'a BookmarkNode>,
    children: HashMap<&'a str, Vec<&'a BookmarkNode>>,
}

pub fn plan(
    nodes: &[BookmarkNode],
    action: &EditAction,
    locals: &[LocalRef],
    stored: Option<&StoredEdit>,
) -> Result<Plan, ErrorCode> {
    match action {
        EditAction::Create {
            parent_id,
            position,
            title,
            url,
        } => plan_create(
            nodes,
            parent_id,
            position.get(),
            title.as_str(),
            url.as_ref().map(|value| value.as_str()),
        ),
        EditAction::Update {
            chrome_id,
            title,
            url,
        } => plan_update(
            nodes,
            chrome_id,
            title.as_ref().map(|value| value.as_str()),
            url.as_ref().map(|value| value.as_str()),
        ),
        EditAction::Move {
            chrome_id,
            parent_id,
            position,
        } => plan_move(nodes, chrome_id, parent_id, position.get()),
        EditAction::Reorder {
            parent_id,
            child_ids,
        } => plan_reorder(nodes, parent_id, child_ids),
        EditAction::Delete { chrome_id } => plan_delete(nodes, chrome_id),
        EditAction::Undo { operation_id } => {
            let stored = stored.ok_or(ErrorCode::InvalidMessage)?;
            if &stored.operation_id != operation_id {
                return Err(ErrorCode::InvalidMessage);
            }
            plan_undo(nodes, stored, locals)
        }
    }
}

pub fn render_netscape(nodes: &[BookmarkNode]) -> Result<String, ErrorCode> {
    let index = index(nodes)?;
    let mut roots: Vec<&BookmarkNode> = nodes
        .iter()
        .filter(|node| node.parent_id.is_none())
        .collect();
    roots.sort_by(by_position);
    let mut out = String::from(
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n",
    );
    for root in roots {
        write_node(&mut out, &index, root, 1)?;
    }
    out.push_str("</DL><p>\n");
    bounded(out)
}

pub fn render_sidecar(profile_id: &Id, epoch: u64, rows: &[LocalRef]) -> Result<String, ErrorCode> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct File<'a> {
        schema_version: u32,
        profile_id: &'a str,
        source_epoch: u64,
        entries: Vec<Entry<'a>>,
    }
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Entry<'a> {
        bookmark_id: &'a str,
        chrome_id: &'a str,
        display_title: Option<&'a str>,
        summary: Option<&'a str>,
        note: &'a str,
    }
    let entries = rows
        .iter()
        .map(|row| Entry {
            bookmark_id: row.bookmark_id.as_str(),
            chrome_id: row.chrome_id.as_str(),
            display_title: row.display_title.as_deref(),
            summary: row.summary.as_deref(),
            note: &row.note,
        })
        .collect();
    let body = serde_json::to_string(&File {
        schema_version: 1,
        profile_id: profile_id.as_str(),
        source_epoch: epoch,
        entries,
    })
    .map_err(|_| ErrorCode::StorageError)?;
    bounded(body)
}

pub fn write_backup_pair(
    dir: &Path,
    operation_id: &Id,
    html: &str,
    sidecar: &str,
) -> Result<(PathBuf, PathBuf), ErrorCode> {
    std::fs::create_dir_all(dir).map_err(|_| ErrorCode::StorageError)?;
    let stem: String = operation_id
        .as_str()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let html_path = dir.join(format!("{stem}.html"));
    let json_path = dir.join(format!("{stem}.json"));
    if html_path.exists() || json_path.exists() {
        return Err(ErrorCode::Conflict);
    }
    if let Err(error) = write_atomic(&html_path, html) {
        let _ = std::fs::remove_file(&html_path);
        return Err(error);
    }
    if let Err(error) = write_atomic(&json_path, sidecar) {
        let _ = std::fs::remove_file(&html_path);
        let _ = std::fs::remove_file(&json_path);
        return Err(error);
    }
    Ok((html_path, json_path))
}

pub fn dispatch_after_backup<T>(
    backup: Result<T, ErrorCode>,
    dispatch: impl FnOnce(T) -> Result<(), ErrorCode>,
) -> Result<(), ErrorCode> {
    dispatch(backup?)
}

pub fn resume(attempt: Option<&Attempt>) -> Resume {
    let Some(attempt) = attempt else {
        return Resume::Execute;
    };
    if attempt.phase == AttemptPhase::Receipt {
        return Resume::Replay;
    }
    if matches!(attempt.kind, MutationKind::Create | MutationKind::Delete) {
        return Resume::Uncertain;
    }
    if attempt.phase == AttemptPhase::Marker {
        return Resume::Execute;
    }
    Resume::Uncertain
}

pub fn reports_applied(decision: Resume, receipt_applied: bool) -> bool {
    decision == Resume::Replay && receipt_applied
}

pub fn freeze_state(state: OperationState) -> OperationState {
    match state {
        OperationState::Applying | OperationState::RollingBack => OperationState::Uncertain,
        other => other,
    }
}

pub fn fold_states(
    states: &[Option<OperationState>],
    undo: bool,
    conflicts: bool,
    finished: bool,
) -> OperationState {
    if states
        .iter()
        .any(|state| matches!(state, Some(OperationState::Uncertain)))
    {
        return OperationState::Uncertain;
    }
    if !finished && states.iter().any(|state| state.is_none()) {
        return if undo {
            OperationState::RollingBack
        } else {
            OperationState::Applying
        };
    }
    if states.iter().any(|state| state.is_none()) {
        return OperationState::Uncertain;
    }
    if conflicts {
        return OperationState::RollbackConflict;
    }
    let applied = states
        .iter()
        .all(|state| matches!(state, Some(OperationState::Applied)));
    if applied {
        return if undo {
            OperationState::RolledBack
        } else {
            OperationState::Applied
        };
    }
    if states
        .iter()
        .any(|state| matches!(state, Some(OperationState::Applied)))
    {
        return OperationState::Partial;
    }
    OperationState::Failed
}

fn plan_create(
    nodes: &[BookmarkNode],
    parent_id: &Id,
    position: u64,
    title: &str,
    url: Option<&str>,
) -> Result<Plan, ErrorCode> {
    let index = index(nodes)?;
    let parent = index
        .by_id
        .get(parent_id.as_str())
        .copied()
        .ok_or(ErrorCode::InvalidTree)?;
    if !can_create_under(&index, parent) {
        return Err(ErrorCode::ProtectedNode);
    }
    let count = index.children.get(parent_id.as_str()).map_or(0, Vec::len) as u64;
    if position > count {
        return Err(ErrorCode::InvalidMessage);
    }
    let url_value = url.map(markbridge_protocol::Url::new).transpose()?;
    let step = step(
        None,
        None,
        None,
        Mutation::Create {
            parent_id: parent_id.clone(),
            position: markbridge_protocol::Position::new(position)?,
            title: markbridge_protocol::Title::new(title)?,
            url: url_value,
        },
    )?;
    Ok(Plan {
        steps: vec![step],
        affected: 1,
        requires_second_confirm: false,
        changes: vec![change(EditField::Existence, None, Some(title))?],
        orders: vec![],
        restores: vec![],
        undo_of: None,
        conflicts: vec![],
    })
}

fn plan_update(
    nodes: &[BookmarkNode],
    chrome_id: &Id,
    title: Option<&str>,
    url: Option<&str>,
) -> Result<Plan, ErrorCode> {
    let index = index(nodes)?;
    let node = index
        .by_id
        .get(chrome_id.as_str())
        .copied()
        .ok_or(ErrorCode::InvalidTree)?;
    if permanently_fixed(node) || under_managed(&index, node) {
        return Err(ErrorCode::ProtectedNode);
    }
    if node.kind == NodeKind::Folder && url.is_some() {
        return Err(ErrorCode::InvalidTree);
    }
    if title.is_none() && url.is_none() {
        return Err(ErrorCode::InvalidMessage);
    }
    let mut changes = Vec::new();
    if let Some(title) = title
        && title != node.title.as_str()
    {
        changes.push(change(
            EditField::Title,
            Some(node.title.as_str()),
            Some(title),
        )?);
    }
    if let Some(url) = url
        && node
            .url
            .as_ref()
            .is_none_or(|current| current.as_str() != url)
    {
        changes.push(change(
            EditField::Url,
            node.url.as_ref().map(|value| value.as_str()),
            Some(url),
        )?);
    }
    if changes.is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    let step = step(
        Some(chrome_id.clone()),
        Some(node.clone()),
        None,
        Mutation::Update {
            title: title.map(markbridge_protocol::Title::new).transpose()?,
            url: url.map(markbridge_protocol::Url::new).transpose()?,
        },
    )?;
    Ok(base(vec![step], 1, false, changes))
}

pub fn title_blocked(nodes: &[BookmarkNode], chrome_id: &Id) -> Result<(), ErrorCode> {
    let index = index(nodes)?;
    let node = index
        .by_id
        .get(chrome_id.as_str())
        .copied()
        .ok_or(ErrorCode::InvalidTree)?;
    if permanently_fixed(node) || under_managed(&index, node) {
        Err(ErrorCode::ProtectedNode)
    } else {
        Ok(())
    }
}

/// One confirmed title update per selected id. Equal titles produce no step and no Chrome write.
pub fn plan_title_updates(
    nodes: &[BookmarkNode],
    updates: &[(Id, String)],
) -> Result<Plan, ErrorCode> {
    let index = index(nodes)?;
    let mut steps = Vec::new();
    let mut changes = Vec::new();
    for (chrome_id, title) in updates {
        let node = index
            .by_id
            .get(chrome_id.as_str())
            .copied()
            .ok_or(ErrorCode::InvalidTree)?;
        if permanently_fixed(node) || under_managed(&index, node) {
            return Err(ErrorCode::ProtectedNode);
        }
        if title == node.title.as_str() {
            continue;
        }
        let next = markbridge_protocol::Title::new(title.clone())?;
        changes.push(change(
            EditField::Title,
            Some(node.title.as_str()),
            Some(title),
        )?);
        steps.push(step(
            Some(chrome_id.clone()),
            Some(node.clone()),
            None,
            Mutation::Update {
                title: Some(next),
                url: None,
            },
        )?);
    }
    Ok(base(steps, changes.len() as u64, false, changes))
}

fn plan_move(
    nodes: &[BookmarkNode],
    chrome_id: &Id,
    parent_id: &Id,
    position: u64,
) -> Result<Plan, ErrorCode> {
    let index = index(nodes)?;
    let node = index
        .by_id
        .get(chrome_id.as_str())
        .copied()
        .ok_or(ErrorCode::InvalidTree)?;
    let parent = index
        .by_id
        .get(parent_id.as_str())
        .copied()
        .ok_or(ErrorCode::InvalidTree)?;
    if !can_remove_or_move(&index, node) {
        return Err(ErrorCode::ProtectedNode);
    }
    if contains(&index, chrome_id.as_str(), parent_id.as_str()) {
        return Err(ErrorCode::InvalidTree);
    }
    if !can_create_under(&index, parent) {
        return Err(ErrorCode::ProtectedNode);
    }
    let same = node.parent_id.as_ref() == Some(parent_id);
    let siblings = index.children.get(parent_id.as_str()).map_or(0, Vec::len) as u64;
    let max = if same {
        siblings.saturating_sub(1)
    } else {
        siblings
    };
    if position > max || (same && node.position.get() == position) {
        return Err(ErrorCode::InvalidMessage);
    }
    let step = step(
        Some(chrome_id.clone()),
        Some(node.clone()),
        None,
        Mutation::Move {
            parent_id: parent_id.clone(),
            position: markbridge_protocol::Position::new(position)?,
        },
    )?;
    let changes = vec![
        change(
            EditField::Parent,
            node.parent_id.as_ref().map(|value| value.as_str()),
            Some(parent_id.as_str()),
        )?,
        change(
            EditField::Position,
            Some(&node.position.get().to_string()),
            Some(&position.to_string()),
        )?,
    ];
    Ok(base(vec![step], 1, false, changes))
}

fn plan_reorder(
    nodes: &[BookmarkNode],
    parent_id: &Id,
    child_ids: &[Id],
) -> Result<Plan, ErrorCode> {
    let index = index(nodes)?;
    let parent = index
        .by_id
        .get(parent_id.as_str())
        .copied()
        .ok_or(ErrorCode::InvalidTree)?;
    if !can_reorder(&index, parent) {
        return Err(ErrorCode::ProtectedNode);
    }
    let current = child_ids_of(&index, parent_id.as_str());
    if current.len() != child_ids.len()
        || current.iter().collect::<HashSet<_>>() != child_ids.iter().collect::<HashSet<_>>()
    {
        return Err(ErrorCode::InvalidMessage);
    }
    if current == child_ids {
        return Err(ErrorCode::InvalidMessage);
    }
    let step = step(
        Some(parent_id.clone()),
        Some(parent.clone()),
        Some(current),
        Mutation::Reorder {
            child_ids: child_ids.to_vec(),
        },
    )?;
    Ok(base(
        vec![step],
        child_ids.len() as u64,
        false,
        vec![change(
            EditField::Order,
            Some("当前顺序"),
            Some("调整后的顺序"),
        )?],
    ))
}

fn plan_delete(nodes: &[BookmarkNode], chrome_id: &Id) -> Result<Plan, ErrorCode> {
    let index = index(nodes)?;
    let node = index
        .by_id
        .get(chrome_id.as_str())
        .copied()
        .ok_or(ErrorCode::InvalidTree)?;
    if !can_remove_or_move(&index, node) {
        return Err(ErrorCode::ProtectedNode);
    }
    let mut seen = HashSet::new();
    let affected = subtree_len(&index, chrome_id.as_str(), &mut seen)?;
    let parent = node.parent_id.clone().ok_or(ErrorCode::ProtectedNode)?;
    let order = ChildOrder {
        parent_id: parent,
        child_ids: child_ids_of(&index, node.parent_id.as_ref().unwrap().as_str()),
    };
    let step = step(
        Some(chrome_id.clone()),
        Some(node.clone()),
        None,
        Mutation::Delete {},
    )?;
    Ok(Plan {
        steps: vec![step],
        affected,
        requires_second_confirm: affected > LARGE_DELETE,
        changes: vec![change(
            EditField::Existence,
            Some(node.title.as_str()),
            None,
        )?],
        orders: vec![order],
        restores: vec![],
        undo_of: None,
        conflicts: vec![],
    })
}

fn plan_undo(
    nodes: &[BookmarkNode],
    stored: &StoredEdit,
    locals: &[LocalRef],
) -> Result<Plan, ErrorCode> {
    if !matches!(
        stored.state,
        OperationState::Applied | OperationState::Partial
    ) {
        return Err(ErrorCode::UncertainWrite);
    }
    let index = index(nodes)?;
    let mut steps = Vec::new();
    let mut changes = Vec::new();
    let mut restores = Vec::new();
    let mut conflicts = Vec::new();
    for original in stored.steps.iter().rev() {
        if !original.applied {
            continue;
        }
        let outcome = if matches!(original.payload, Mutation::Delete {}) {
            restore_deleted(&index, original, &stored.orders, locals, &stored.snapshot)
        } else {
            inverse(&index, original).map_err(UndoFailure::Conflict)
        };
        match outcome {
            Ok(inverse) => {
                changes.extend(inverse.changes);
                restores.extend(inverse.restores);
                steps.extend(inverse.steps);
            }
            Err(UndoFailure::Conflict(conflict)) => {
                conflicts.push(conflict);
                break;
            }
            Err(UndoFailure::Halt(error)) => return Err(error),
        }
    }
    Ok(Plan {
        affected: steps.len() as u64,
        requires_second_confirm: false,
        steps,
        changes,
        orders: vec![],
        restores,
        undo_of: Some(stored.operation_id.clone()),
        conflicts,
    })
}

struct Inverse {
    steps: Vec<OperationStep>,
    changes: Vec<EditFieldChange>,
    restores: Vec<RestoreHint>,
}

enum UndoFailure {
    Conflict(OperationConflict),
    Halt(ErrorCode),
}

fn inverse(index: &Index, original: &StoredStep) -> Result<Inverse, OperationConflict> {
    let conflict = |request: &Id, chrome: Option<&Id>, field| OperationConflict {
        request_id: request.clone(),
        chrome_id: RequiredNullable(chrome.cloned()),
        field,
    };
    let request = &original.request_id;
    match &original.payload {
        Mutation::Create { .. } => {
            let after = original
                .after
                .clone()
                .ok_or_else(|| conflict(request, None, EditField::Existence))?;
            let current = index.by_id.get(after.chrome_id.as_str()).copied();
            if current.is_none_or(|node| !same_node(node, &after)) {
                return Err(conflict(
                    request,
                    Some(&after.chrome_id),
                    EditField::Existence,
                ));
            }
            if !can_remove_or_move(index, &after) {
                return Err(conflict(
                    request,
                    Some(&after.chrome_id),
                    EditField::Existence,
                ));
            }
            let step = step(
                Some(after.chrome_id.clone()),
                Some(after.clone()),
                None,
                Mutation::Delete {},
            )
            .map_err(|_| conflict(request, Some(&after.chrome_id), EditField::Existence))?;
            Ok(Inverse {
                changes: vec![
                    change(EditField::Existence, Some(after.title.as_str()), None).map_err(
                        |_| conflict(request, Some(&after.chrome_id), EditField::Existence),
                    )?,
                ],
                restores: vec![],
                steps: vec![step],
            })
        }
        Mutation::Update { .. } => {
            let before = original
                .before
                .clone()
                .ok_or_else(|| conflict(request, None, EditField::Title))?;
            let after = original
                .after
                .clone()
                .ok_or_else(|| conflict(request, Some(&before.chrome_id), EditField::Title))?;
            let current = index
                .by_id
                .get(after.chrome_id.as_str())
                .copied()
                .ok_or_else(|| conflict(request, Some(&after.chrome_id), EditField::Title))?;
            if !same_content(current, &after) {
                return Err(conflict(
                    request,
                    Some(&after.chrome_id),
                    if current.title != after.title {
                        EditField::Title
                    } else {
                        EditField::Url
                    },
                ));
            }
            let step = step(
                Some(before.chrome_id.clone()),
                Some(current.clone()),
                None,
                Mutation::Update {
                    title: Some(before.title.clone()),
                    url: before.url.clone(),
                },
            )
            .map_err(|_| conflict(request, Some(&before.chrome_id), EditField::Title))?;
            Ok(Inverse {
                steps: vec![step],
                restores: vec![],
                changes: vec![
                    change(
                        EditField::Title,
                        Some(after.title.as_str()),
                        Some(before.title.as_str()),
                    )
                    .map_err(|_| conflict(request, Some(&before.chrome_id), EditField::Title))?,
                ],
            })
        }
        Mutation::Move { .. } => {
            let before = original
                .before
                .clone()
                .ok_or_else(|| conflict(request, None, EditField::Parent))?;
            let after = original
                .after
                .clone()
                .ok_or_else(|| conflict(request, Some(&before.chrome_id), EditField::Parent))?;
            let current = index
                .by_id
                .get(after.chrome_id.as_str())
                .copied()
                .ok_or_else(|| conflict(request, Some(&after.chrome_id), EditField::Parent))?;
            if current.parent_id != after.parent_id || current.position != after.position {
                return Err(conflict(request, Some(&after.chrome_id), EditField::Parent));
            }
            let parent = before
                .parent_id
                .clone()
                .ok_or_else(|| conflict(request, Some(&before.chrome_id), EditField::Parent))?;
            let step = step(
                Some(before.chrome_id.clone()),
                Some(current.clone()),
                None,
                Mutation::Move {
                    parent_id: parent,
                    position: before.position,
                },
            )
            .map_err(|_| conflict(request, Some(&before.chrome_id), EditField::Parent))?;
            Ok(Inverse {
                steps: vec![step],
                restores: vec![],
                changes: vec![
                    change(
                        EditField::Parent,
                        after.parent_id.as_ref().map(|value| value.as_str()),
                        before.parent_id.as_ref().map(|value| value.as_str()),
                    )
                    .map_err(|_| conflict(request, Some(&before.chrome_id), EditField::Parent))?,
                ],
            })
        }
        Mutation::Reorder { .. } => {
            let before_ids = original
                .before_child_ids
                .clone()
                .ok_or_else(|| conflict(request, None, EditField::Order))?;
            let after_ids = original
                .after_child_ids
                .clone()
                .ok_or_else(|| conflict(request, None, EditField::Order))?;
            let parent = original
                .before
                .clone()
                .ok_or_else(|| conflict(request, None, EditField::Order))?;
            let current = child_ids_of(index, parent.chrome_id.as_str());
            if current != after_ids {
                return Err(conflict(request, Some(&parent.chrome_id), EditField::Order));
            }
            let step = step(
                Some(parent.chrome_id.clone()),
                Some(parent.clone()),
                Some(current),
                Mutation::Reorder {
                    child_ids: before_ids,
                },
            )
            .map_err(|_| conflict(request, Some(&parent.chrome_id), EditField::Order))?;
            Ok(Inverse {
                steps: vec![step],
                restores: vec![],
                changes: vec![
                    change(EditField::Order, Some("写入后的顺序"), Some("写入前的顺序")).map_err(
                        |_| conflict(request, Some(&parent.chrome_id), EditField::Order),
                    )?,
                ],
            })
        }
        Mutation::Delete {} => Err(conflict(request, None, EditField::Existence)),
    }
}

fn restore_deleted(
    index: &Index,
    original: &StoredStep,
    orders: &[ChildOrder],
    locals: &[LocalRef],
    snapshot: &[BookmarkNode],
) -> Result<Inverse, UndoFailure> {
    let conflict = |chrome: Option<&Id>, field| {
        UndoFailure::Conflict(OperationConflict {
            request_id: original.request_id.clone(),
            chrome_id: RequiredNullable(chrome.cloned()),
            field,
        })
    };
    let before = original
        .before
        .clone()
        .ok_or_else(|| conflict(None, EditField::Existence))?;
    let subtree = if snapshot
        .iter()
        .any(|node| node.chrome_id == before.chrome_id)
    {
        preorder(snapshot, &before.chrome_id).map_err(UndoFailure::Halt)?
    } else {
        vec![before.clone()]
    };
    if subtree.len() > 1000 {
        return Err(UndoFailure::Halt(ErrorCode::LimitExceeded));
    }
    if let Some(node) = subtree
        .iter()
        .find(|node| index.by_id.contains_key(node.chrome_id.as_str()))
    {
        return Err(conflict(Some(&node.chrome_id), EditField::Existence));
    }
    let parent_id = before
        .parent_id
        .clone()
        .ok_or_else(|| conflict(Some(&before.chrome_id), EditField::Parent))?;
    let parent = index
        .by_id
        .get(parent_id.as_str())
        .copied()
        .ok_or_else(|| conflict(Some(&parent_id), EditField::Parent))?;
    if !can_create_under(index, parent) {
        return Err(conflict(Some(&parent_id), EditField::Parent));
    }
    let order = orders.iter().find(|order| order.parent_id == parent_id);
    let current = child_ids_of(index, parent_id.as_str());
    let expected: Vec<Id> = order
        .map(|order| {
            order
                .child_ids
                .iter()
                .filter(|id| *id != &before.chrome_id)
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if order.is_none_or(|_| current != expected) {
        return Err(conflict(Some(&before.chrome_id), EditField::Order));
    }
    let mut request_by_old = HashMap::new();
    let mut steps = Vec::new();
    let mut restores = Vec::new();
    for node in &subtree {
        let old_parent = node
            .parent_id
            .clone()
            .ok_or_else(|| conflict(Some(&node.chrome_id), EditField::Parent))?;
        let create_parent = request_by_old
            .get(&old_parent)
            .cloned()
            .unwrap_or(old_parent);
        let step = step(
            None,
            None,
            None,
            Mutation::Create {
                parent_id: create_parent,
                position: node.position,
                title: node.title.clone(),
                url: node.url.clone(),
            },
        )
        .map_err(|_| conflict(Some(&node.chrome_id), EditField::Existence))?;
        let bookmark_id = locals
            .iter()
            .find(|row| row.chrome_id == node.chrome_id)
            .map(|row| row.bookmark_id.clone())
            .ok_or_else(|| conflict(Some(&node.chrome_id), EditField::Existence))?;
        request_by_old.insert(node.chrome_id.clone(), step.request_id.clone());
        restores.push(RestoreHint {
            request_id: step.request_id.clone(),
            old_chrome_id: node.chrome_id.clone(),
            old_bookmark_id: bookmark_id,
        });
        steps.push(step);
    }
    let title = change(EditField::Existence, None, Some(before.title.as_str()))
        .map_err(|_| conflict(Some(&before.chrome_id), EditField::Existence))?;
    Ok(Inverse {
        steps,
        changes: vec![title],
        restores,
    })
}

fn preorder(nodes: &[BookmarkNode], root: &Id) -> Result<Vec<BookmarkNode>, ErrorCode> {
    let indexed = index(nodes)?;
    let mut out = Vec::new();
    fn walk(index: &Index, id: &str, out: &mut Vec<BookmarkNode>) -> Result<(), ErrorCode> {
        let node = index.by_id.get(id).copied().ok_or(ErrorCode::InvalidTree)?;
        out.push(node.clone());
        if let Some(children) = index.children.get(id) {
            for child in children {
                walk(index, child.chrome_id.as_str(), out)?;
            }
        }
        Ok(())
    }
    walk(&indexed, root.as_str(), &mut out)?;
    Ok(out)
}

fn base(
    steps: Vec<OperationStep>,
    affected: u64,
    second: bool,
    changes: Vec<EditFieldChange>,
) -> Plan {
    Plan {
        steps,
        affected,
        requires_second_confirm: second,
        changes,
        orders: vec![],
        restores: vec![],
        undo_of: None,
        conflicts: vec![],
    }
}

fn step(
    target: Option<Id>,
    before: Option<BookmarkNode>,
    children: Option<Vec<Id>>,
    payload: Mutation,
) -> Result<OperationStep, ErrorCode> {
    Ok(OperationStep {
        request_id: next_id("req")?,
        target,
        expected_before: before,
        expected_child_ids: children,
        payload,
    })
}

fn change(
    field: EditField,
    before: Option<&str>,
    after: Option<&str>,
) -> Result<EditFieldChange, ErrorCode> {
    Ok(EditFieldChange {
        field,
        before: RequiredNullable(before.map(str::to_owned)),
        after: RequiredNullable(after.map(str::to_owned)),
    })
}

fn next_id(prefix: &str) -> Result<Id, ErrorCode> {
    let mut bytes = [0_u8; 16];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| ErrorCode::StorageError)?;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Id::new(format!("{prefix}-{hex}"))
}

pub fn operation_id() -> Result<Id, ErrorCode> {
    next_id("op")
}

fn index(nodes: &[BookmarkNode]) -> Result<Index<'_>, ErrorCode> {
    let mut by_id = HashMap::new();
    for node in nodes {
        if by_id.insert(node.chrome_id.as_str(), node).is_some() {
            return Err(ErrorCode::InvalidTree);
        }
    }
    let mut children: HashMap<&str, Vec<&BookmarkNode>> = HashMap::new();
    for node in nodes {
        if let Some(parent) = &node.parent_id {
            if !by_id.contains_key(parent.as_str()) {
                return Err(ErrorCode::InvalidTree);
            }
            children.entry(parent.as_str()).or_default().push(node);
        }
    }
    for list in children.values_mut() {
        list.sort_by(by_position);
    }
    Ok(Index { by_id, children })
}

fn by_position(left: &&BookmarkNode, right: &&BookmarkNode) -> std::cmp::Ordering {
    left.position
        .get()
        .cmp(&right.position.get())
        .then(left.chrome_id.as_str().cmp(right.chrome_id.as_str()))
}

fn permanently_fixed(node: &BookmarkNode) -> bool {
    node.parent_id.is_none() || node.folder_type.is_some() || node.unmodifiable.is_some()
}

fn under_managed(index: &Index, node: &BookmarkNode) -> bool {
    let mut current = node.parent_id.as_ref();
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id.as_str()) {
            return true;
        }
        let Some(parent) = index.by_id.get(id.as_str()) else {
            return true;
        };
        if parent.folder_type == Some(FolderType::Managed)
            || parent.unmodifiable == Some(Unmodifiable::Managed)
        {
            return true;
        }
        current = parent.parent_id.as_ref();
    }
    false
}

fn can_remove_or_move(index: &Index, node: &BookmarkNode) -> bool {
    !permanently_fixed(node) && !under_managed(index, node)
}

fn can_create_under(index: &Index, parent: &BookmarkNode) -> bool {
    parent.kind == NodeKind::Folder
        && parent.folder_type != Some(FolderType::Managed)
        && parent.unmodifiable.is_none()
        && !under_managed(index, parent)
}

fn can_reorder(index: &Index, parent: &BookmarkNode) -> bool {
    parent.kind == NodeKind::Folder && parent.parent_id.is_some() && can_create_under(index, parent)
}

fn contains(index: &Index, ancestor: &str, node: &str) -> bool {
    if ancestor == node {
        return true;
    }
    let mut current = index
        .by_id
        .get(node)
        .and_then(|item| item.parent_id.as_ref());
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if id.as_str() == ancestor {
            return true;
        }
        if !seen.insert(id.as_str()) {
            return true;
        }
        current = index
            .by_id
            .get(id.as_str())
            .and_then(|item| item.parent_id.as_ref());
    }
    false
}

fn child_ids_of(index: &Index, parent: &str) -> Vec<Id> {
    index
        .children
        .get(parent)
        .map(|list| list.iter().map(|node| node.chrome_id.clone()).collect())
        .unwrap_or_default()
}

fn subtree_len(index: &Index, id: &str, seen: &mut HashSet<String>) -> Result<u64, ErrorCode> {
    if !seen.insert(id.to_owned()) {
        return Err(ErrorCode::InvalidTree);
    }
    let mut total = 1_u64;
    if let Some(children) = index.children.get(id) {
        for child in children {
            total += subtree_len(index, child.chrome_id.as_str(), seen)?;
        }
    }
    Ok(total)
}

fn same_node(left: &BookmarkNode, right: &BookmarkNode) -> bool {
    left.chrome_id == right.chrome_id
        && left.parent_id == right.parent_id
        && left.position == right.position
        && left.kind == right.kind
        && left.title == right.title
        && left.url == right.url
        && left.folder_type == right.folder_type
        && left.unmodifiable == right.unmodifiable
}

fn same_content(left: &BookmarkNode, right: &BookmarkNode) -> bool {
    left.chrome_id == right.chrome_id
        && left.title == right.title
        && left.url == right.url
        && left.kind == right.kind
}

fn write_node(
    out: &mut String,
    index: &Index,
    node: &BookmarkNode,
    depth: usize,
) -> Result<(), ErrorCode> {
    let pad = "    ".repeat(depth);
    match node.kind {
        NodeKind::Folder => {
            out.push_str(&pad);
            out.push_str("<DT><H3>");
            out.push_str(&escape(node.title.as_str()));
            out.push_str("</H3>\n");
            out.push_str(&pad);
            out.push_str("<DL><p>\n");
            if let Some(children) = index.children.get(node.chrome_id.as_str()) {
                for child in children {
                    write_node(out, index, child, depth + 1)?;
                }
            }
            out.push_str(&pad);
            out.push_str("</DL><p>\n");
        }
        NodeKind::Bookmark => {
            out.push_str(&pad);
            out.push_str("<DT><A HREF=\"");
            out.push_str(&escape(
                node.url.as_ref().map(|url| url.as_str()).unwrap_or(""),
            ));
            out.push_str("\">");
            out.push_str(&escape(node.title.as_str()));
            out.push_str("</A>\n");
        }
    }
    Ok(())
}

fn escape(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn bounded(value: String) -> Result<String, ErrorCode> {
    if value.chars().count() > MAX_DOCUMENT_CHARS {
        return Err(ErrorCode::LimitExceeded);
    }
    Ok(value)
}

fn write_atomic(path: &Path, body: &str) -> Result<(), ErrorCode> {
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, body).map_err(|_| ErrorCode::StorageError)?;
    std::fs::rename(&temporary, path).map_err(|_| {
        let _ = std::fs::remove_file(&temporary);
        ErrorCode::StorageError
    })
}

#[cfg(test)]
mod tests;
