use super::{Bridge, Result, edit, now};
use crate::{editing, storage::BeforeBody};
use markbridge_protocol::*;

/// Captured under the Bridge lock before the native dialog opens. The body never enters IPC.
pub struct ExportSnapshot {
    pub metadata: ExportMetadata,
    pub body: String,
}

pub(super) fn mutation_kind(value: &Mutation) -> HistoryKind {
    match value {
        Mutation::Create { .. } => HistoryKind::Create,
        Mutation::Update { .. } => HistoryKind::Update,
        Mutation::Move { .. } => HistoryKind::Move,
        Mutation::Delete { .. } => HistoryKind::Delete,
        Mutation::Reorder { .. } => HistoryKind::Reorder,
    }
}

pub(super) fn descendants(nodes: &[BookmarkNode], root: &Id) -> Vec<BookmarkNode> {
    let mut pending = vec![root.clone()];
    let mut result = Vec::new();
    while let Some(parent) = pending.pop() {
        for child in nodes
            .iter()
            .filter(|node| node.parent_id.as_ref() == Some(&parent))
        {
            pending.push(child.chrome_id.clone());
            result.push(child.clone());
        }
    }
    result
}

impl Bridge {
    pub async fn operation_detail(
        &self,
        profile_id: Id,
        operation_id: Id,
    ) -> Result<OperationDetail> {
        let inner = self.inner.lock().await;
        let record = inner.storage()?.operation(operation_id).await?;
        if record.profile_id != profile_id {
            return Err(ErrorCode::WrongProfile);
        }
        let before: BeforeBody =
            serde_json::from_str(&record.before_json).map_err(|_| ErrorCode::StorageError)?;
        let snapshot = inner
            .storage()?
            .snapshot_tree(record.operation_id.clone())
            .await?;
        let summary = edit::summarize(inner.storage()?, vec![record.clone()])
            .await?
            .remove(0);
        // Copy maps are consumed after metadata restoration. Hints and receipts retain the
        // recovery association after that copy and after a process restart.
        let restored = before
            .restores
            .iter()
            .filter_map(|hint| {
                let receipt = record
                    .steps
                    .iter()
                    .find(|step| step.request_id == hint.request_id)?
                    .receipt
                    .as_ref()?;
                if receipt.state != OperationState::Applied {
                    return None;
                }
                Some(RestoredIdentity {
                    old_chrome_id: hint.old_chrome_id.clone(),
                    new_chrome_id: receipt.after.as_ref()?.chrome_id.clone(),
                    bookmark_id: hint.old_bookmark_id.clone(),
                })
            })
            .collect();
        Ok(OperationDetail {
            profile_id,
            source_epoch: record.source_epoch,
            summary,
            undo_of: RequiredNullable(before.undo_of),
            steps: record
                .steps
                .into_iter()
                .map(|step| HistoryStep {
                    deleted_descendants: if matches!(step.payload, Mutation::Delete {}) {
                        step.target
                            .as_ref()
                            .map(|target| descendants(&snapshot, target))
                            .unwrap_or_default()
                    } else {
                        vec![]
                    },
                    request_id: step.request_id,
                    mutation: step.payload,
                    before: RequiredNullable(step.expected_before),
                    receipt: RequiredNullable(step.receipt),
                })
                .collect(),
            restored,
        })
    }

    pub async fn preview_undo(
        &self,
        profile_id: Id,
        operation_id: Id,
        expected_revision: u64,
    ) -> Result<UndoPreview> {
        let inner = self.inner.lock().await;
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if profile.view.revision.get() != expected_revision {
            return Err(ErrorCode::StaleProposal);
        }
        let action = EditAction::Undo {
            operation_id: operation_id.clone(),
        };
        let stored = edit::stored_for(&inner, &profile_id, &action).await?;
        let plan = editing::plan(&profile.nodes, &action, &stored.1, stored.0.as_ref())?;
        if plan.steps.len() > 1000 {
            return Err(ErrorCode::LimitExceeded);
        }
        Ok(UndoPreview {
            profile_id,
            source_epoch: profile.identity.source_epoch,
            operation_id,
            expected_revision: profile.view.revision,
            writable: profile.view.connection == BridgeConnection::Live
                && !profile.writes_blocked
                && !profile.busy,
            affected: Counter::new(plan.affected)?,
            error_code: RequiredNullable(
                (!plan.conflicts.is_empty()).then_some(ErrorCode::Conflict),
            ),
            steps: plan.steps,
            conflicts: plan.conflicts,
        })
    }

    pub async fn export_snapshot(
        &self,
        source: ExportSource,
        format: EditDocumentKind,
    ) -> Result<ExportSnapshot> {
        let inner = self.inner.lock().await;
        let (nodes, display_name, epoch, revision, cached_at) = match &source {
            ExportSource::Profile { id } => {
                let profile = inner
                    .profiles
                    .get(id.as_str())
                    .ok_or(ErrorCode::WrongProfile)?;
                (
                    &profile.nodes,
                    profile.view.display_name.clone(),
                    Some(profile.identity.source_epoch),
                    profile.view.revision,
                    profile.view.last_synced_at.clone(),
                )
            }
            ExportSource::Mirror { id } => {
                if format == EditDocumentKind::Sidecar {
                    return Err(ErrorCode::ReadOnly);
                }
                let mirror = inner
                    .mirrors
                    .get(id.as_str())
                    .ok_or(ErrorCode::WrongProfile)?;
                (
                    &mirror.nodes,
                    mirror.view.display_name.clone(),
                    None,
                    mirror.view.revision,
                    mirror.view.last_synced_at.clone(),
                )
            }
        };
        let metadata = ExportMetadata {
            source: source.clone(),
            display_name,
            format,
            source_epoch: RequiredNullable(epoch),
            revision,
            cached_at,
            exported_at: Counter::new(now()?)?,
            node_count: Counter::new(nodes.len() as u64)?,
        };
        let body = match &source {
            ExportSource::Profile { id } if format == EditDocumentKind::Sidecar => {
                let entries = inner
                    .storage()?
                    .export_sidecar_entries(id.clone(), epoch.ok_or(ErrorCode::WrongProfile)?)
                    .await?;
                serde_json::to_string_pretty(&serde_json::json!({ "schemaVersion": 2, "metadata": metadata, "entries": entries }))
                    .map_err(|_| ErrorCode::StorageError)?
            }
            _ => {
                let html = editing::render_netscape(nodes)?;
                // A source display name may contain HTML comment terminators.
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
        Ok(ExportSnapshot { metadata, body })
    }
}
