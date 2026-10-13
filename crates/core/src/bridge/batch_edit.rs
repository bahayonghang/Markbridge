//! Reviewed daily move/delete groups, using the existing snapshot and receipt executor.
use super::{Bridge, Inner, Result, edit, now, random_id, sync};
use crate::{
    editing,
    storage::{AfterBody, BeforeBody, OperationRecord},
};
use markbridge_protocol::*;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const ACK_TIMEOUT_MS: u64 = 10_000;

pub(super) struct Prepared {
    preview: BatchEditPreview,
    plan: editing::Plan,
}

impl Bridge {
    pub async fn preview_batch_edit(
        &self,
        profile_id: Id,
        expected_revision: u64,
        chrome_ids: Vec<Id>,
        action: BatchEditAction,
    ) -> Result<BatchEditPreview> {
        let mut inner = self.inner.lock().await;
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if expected_revision != profile.view.revision.get() {
            return Err(ErrorCode::StaleProposal);
        }
        let (plan, items) = build_plan(&profile.nodes, &chrome_ids, &action)?;
        let mut preview = BatchEditPreview {
            plan_id: random_id("edit-plan")?,
            plan_hash: Id::new("pending")?,
            profile_id: profile_id.clone(),
            source_epoch: profile.identity.source_epoch,
            expected_revision: profile.view.revision,
            selected_count: Counter::new(chrome_ids.len() as u64)?,
            affected: Counter::new(plan.affected)?,
            requires_second_confirm: plan.requires_second_confirm,
            destination_path: RequiredNullable(match action {
                BatchEditAction::Move { parent_id } => Some(path(&profile.nodes, &parent_id)?),
                BatchEditAction::Delete {} => None,
            }),
            writable: profile.view.connection == BridgeConnection::Live
                && !profile.busy
                && !profile.writes_blocked
                && profile.batch_hold.is_none(),
            items,
        };
        let bytes =
            serde_json::to_vec(&(&preview, &plan.steps)).map_err(|_| ErrorCode::InvalidMessage)?;
        preview.plan_hash = Id::new(format!("{:x}", Sha256::digest(bytes)))?;
        inner.edit_previews.insert(
            profile_id.as_str().to_owned(),
            Prepared {
                preview: preview.clone(),
                plan,
            },
        );
        Ok(preview)
    }

    pub async fn apply_batch_edit(
        &self,
        profile_id: Id,
        plan_id: Id,
        plan_hash: Id,
        second_confirm: bool,
    ) -> Result<BatchEditStatus> {
        let mut inner = self.inner.lock().await;
        let prepared = inner
            .edit_previews
            .get(profile_id.as_str())
            .ok_or(ErrorCode::StaleProposal)?;
        if prepared.preview.plan_id != plan_id || prepared.preview.plan_hash != plan_hash {
            return Err(ErrorCode::StaleProposal);
        }
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if profile.view.connection != BridgeConnection::Live {
            return Err(ErrorCode::ReadOnly);
        }
        if profile.busy || profile.writes_blocked || profile.batch_hold.is_some() {
            return Err(ErrorCode::Conflict);
        }
        if profile.identity.source_epoch != prepared.preview.source_epoch
            || profile.view.revision != prepared.preview.expected_revision
        {
            return Err(ErrorCode::StaleProposal);
        }
        if prepared.preview.requires_second_confirm && !second_confirm {
            return Err(ErrorCode::Cancelled);
        }
        let epoch = profile.identity.source_epoch;
        let revision = profile.view.revision;
        let nodes = profile.nodes.clone();
        let session = profile.session.clone().ok_or(ErrorCode::ReadOnly)?;
        let sender = profile.outbound.clone().ok_or(ErrorCode::ReadOnly)?;
        // Claim before committing, including failures: another confirmation must obtain a fresh review.
        let prepared = inner
            .edit_previews
            .remove(profile_id.as_str())
            .ok_or(ErrorCode::StaleProposal)?;
        let result = edit::commit_planned(
            self,
            &mut inner,
            edit::PlannedCommit {
                batch: Some(prepared.preview),
                profile_id: &profile_id,
                epoch,
                revision,
                nodes: &nodes,
                session: &session,
                sender,
                plan: prepared.plan,
                encodings: vec![],
                send_limit: Some(1),
                operation_id: None,
            },
        )
        .await?;
        arm_timeout(
            self.clone(),
            profile_id.clone(),
            result.operation_id.clone(),
        );
        present(&inner, &profile_id, &result.operation_id).await
    }

    pub async fn get_batch_edit(
        &self,
        profile_id: Id,
        operation_id: Id,
    ) -> Result<BatchEditStatus> {
        let mut inner = self.inner.lock().await;
        let (record, _, after) = load(&inner, &profile_id, &operation_id).await?;
        let progress = after.batch.as_ref().ok_or(ErrorCode::InvalidMessage)?;
        if !progress.stopped
            && (record.state == OperationState::Uncertain
                || (in_flight(&record, progress.dispatched)
                    && now()?.saturating_sub(progress.dispatched_at) >= ACK_TIMEOUT_MS))
        {
            stop(
                &mut inner,
                &profile_id,
                &operation_id,
                ErrorCode::UncertainWrite,
            )
            .await?;
            self.publish(&mut inner);
        }
        present(&inner, &profile_id, &operation_id).await
    }

    pub async fn cancel_batch_edit(
        &self,
        profile_id: Id,
        operation_id: Id,
    ) -> Result<BatchEditStatus> {
        let mut inner = self.inner.lock().await;
        stop(&mut inner, &profile_id, &operation_id, ErrorCode::Cancelled).await?;
        self.publish(&mut inner);
        present(&inner, &profile_id, &operation_id).await
    }
}

pub(super) async fn on_receipt(
    bridge: &Bridge,
    inner: &mut Inner,
    profile_id: &Id,
    operation_id: &Id,
) -> Result<()> {
    let record = inner.storage()?.operation(operation_id.clone()).await?;
    let before: BeforeBody =
        serde_json::from_str(&record.before_json).map_err(|_| ErrorCode::StorageError)?;
    let Some(preview) = before.batch else {
        return Ok(());
    };
    let mut after: AfterBody = serde_json::from_str(
        record
            .after_json
            .as_deref()
            .ok_or(ErrorCode::StorageError)?,
    )
    .map_err(|_| ErrorCode::StorageError)?;
    let progress = after.batch.as_mut().ok_or(ErrorCode::StorageError)?;
    if progress.stopped {
        stop(
            inner,
            profile_id,
            operation_id,
            progress.error.unwrap_or(ErrorCode::Cancelled),
        )
        .await?;
        return Ok(());
    }
    // Reconnection and process restart never resume a group, even when a late receipt is applied.
    let profile = inner
        .profiles
        .get(profile_id.as_str())
        .ok_or(ErrorCode::WrongProfile)?;
    let held = profile.batch_hold.as_ref() == Some(operation_id);
    if !held
        || profile.view.connection != BridgeConnection::Live
        || now()?.saturating_sub(progress.dispatched_at) >= ACK_TIMEOUT_MS
    {
        return stop(inner, profile_id, operation_id, ErrorCode::UncertainWrite).await;
    }
    if let Some(receipt) = record
        .steps
        .iter()
        .filter_map(|step| step.receipt.as_ref())
        .find(|receipt| receipt.state != OperationState::Applied)
    {
        return stop(
            inner,
            profile_id,
            operation_id,
            receipt.error_code.unwrap_or(ErrorCode::Conflict),
        )
        .await;
    }
    if in_flight(&record, progress.dispatched) {
        return Ok(());
    }
    if progress.dispatched == record.steps.len() {
        if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
            profile.batch_hold = None;
            profile.busy = false;
        }
        return Ok(());
    }
    let stored = &record.steps[progress.dispatched];
    let snapshot = inner.storage()?.snapshot_tree(operation_id.clone()).await?;
    let step = OperationStep {
        expected_subtree: Some(expected_subtree(
            &snapshot,
            stored
                .expected_before
                .as_ref()
                .ok_or(ErrorCode::InvalidMessage)?,
        )),
        request_id: stored.request_id.clone(),
        target: stored.target.clone(),
        expected_before: stored.expected_before.clone(),
        expected_child_ids: stored.expected_child_ids.clone(),
        payload: stored.payload.clone(),
    };
    let sender = profile.outbound.clone().ok_or(ErrorCode::ReadOnly)?;
    let session = profile.session.clone().ok_or(ErrorCode::ReadOnly)?;
    let message = edit::one_step(
        profile_id,
        &session,
        operation_id,
        preview.source_epoch,
        preview.expected_revision,
        &step,
    )?;
    progress.dispatched += 1;
    progress.dispatched_at = now()?;
    inner
        .storage()?
        .set_operation_state(
            operation_id.clone(),
            OperationState::Applying,
            Some(serde_json::to_string(&after).map_err(|_| ErrorCode::StorageError)?),
        )
        .await?;
    if sender.send(message).is_err() {
        stop(inner, profile_id, operation_id, ErrorCode::ReadOnly).await?;
    }
    arm_timeout(bridge.clone(), profile_id.clone(), operation_id.clone());
    bridge.publish(inner);
    Ok(())
}

async fn load(
    inner: &Inner,
    profile_id: &Id,
    operation_id: &Id,
) -> Result<(OperationRecord, BatchEditPreview, AfterBody)> {
    let record = inner.storage()?.operation(operation_id.clone()).await?;
    if record.profile_id != *profile_id {
        return Err(ErrorCode::WrongProfile);
    }
    let before: BeforeBody =
        serde_json::from_str(&record.before_json).map_err(|_| ErrorCode::StorageError)?;
    let preview = before.batch.ok_or(ErrorCode::InvalidMessage)?;
    let after = serde_json::from_str(
        record
            .after_json
            .as_deref()
            .ok_or(ErrorCode::StorageError)?,
    )
    .map_err(|_| ErrorCode::StorageError)?;
    Ok((record, preview, after))
}

fn in_flight(record: &OperationRecord, dispatched: usize) -> bool {
    record
        .steps
        .iter()
        .take(dispatched)
        .any(|step| step.receipt.is_none())
}

async fn stop(
    inner: &mut Inner,
    profile_id: &Id,
    operation_id: &Id,
    error: ErrorCode,
) -> Result<()> {
    let (record, _, mut after) = load(inner, profile_id, operation_id).await?;
    if record.state == OperationState::Applied {
        return Ok(());
    }
    let progress = after.batch.as_mut().ok_or(ErrorCode::StorageError)?;
    progress.stopped = true;
    progress.error = Some(error);
    let uncertain = in_flight(&record, progress.dispatched)
        || record.steps.iter().any(|s| {
            s.receipt
                .as_ref()
                .is_some_and(|r| r.state == OperationState::Uncertain)
        });
    let applied = record.steps.iter().any(|s| {
        s.receipt
            .as_ref()
            .is_some_and(|r| r.state == OperationState::Applied)
    });
    let state = if uncertain {
        OperationState::Uncertain
    } else if applied {
        OperationState::Partial
    } else {
        OperationState::Failed
    };
    inner
        .storage()?
        .set_operation_state(
            operation_id.clone(),
            state,
            Some(serde_json::to_string(&after).map_err(|_| ErrorCode::StorageError)?),
        )
        .await?;
    if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
        profile.busy = false;
        profile.writes_blocked = uncertain || applied;
        if profile.batch_hold.as_ref() == Some(operation_id) {
            profile.batch_hold = None;
        }
    }
    Ok(())
}

async fn present(inner: &Inner, profile_id: &Id, operation_id: &Id) -> Result<BatchEditStatus> {
    let (record, preview, after) = load(inner, profile_id, operation_id).await?;
    let progress = after.batch.ok_or(ErrorCode::StorageError)?;
    let items = record
        .steps
        .iter()
        .zip(preview.items)
        .enumerate()
        .map(|(i, (step, item))| {
            let state = match step.receipt.as_ref().map(|r| &r.state) {
                Some(OperationState::Applied) => BatchItemState::Applied,
                Some(OperationState::Uncertain) => BatchItemState::Uncertain,
                Some(_) => BatchItemState::Conflict,
                None if i >= progress.dispatched => BatchItemState::NotExecuted,
                None if progress.stopped || record.state == OperationState::Uncertain => {
                    BatchItemState::Uncertain
                }
                None => BatchItemState::InFlight,
            };
            BatchItemResult {
                chrome_id: item.chrome_id,
                title: item.title,
                state,
                error_code: RequiredNullable(step.receipt.as_ref().and_then(|r| r.error_code)),
            }
        })
        .collect();
    Ok(BatchEditStatus {
        operation_id: record.operation_id,
        profile_id: profile_id.clone(),
        state: record.state,
        stopped: progress.stopped,
        items,
        error_code: RequiredNullable(progress.error),
    })
}

fn path(nodes: &[BookmarkNode], id: &Id) -> Result<String> {
    let mut parts = vec![];
    let mut current = Some(id.clone());
    while let Some(id) = current {
        let node = nodes
            .iter()
            .find(|n| n.chrome_id == id)
            .ok_or(ErrorCode::InvalidTree)?;
        parts.push(if node.title.as_str().is_empty() {
            "书签"
        } else {
            node.title.as_str()
        });
        current = node.parent_id.clone();
    }
    parts.reverse();
    Ok(parts.join(" / "))
}

fn build_plan(
    nodes: &[BookmarkNode],
    ids: &[Id],
    action: &BatchEditAction,
) -> Result<(editing::Plan, Vec<BatchEditItem>)> {
    if ids.is_empty() || ids.len() > 1000 {
        return Err(ErrorCode::LimitExceeded);
    }
    let selected: HashSet<&Id> = ids.iter().collect();
    if selected.len() != ids.len() {
        return Err(ErrorCode::InvalidMessage);
    }
    for id in ids {
        // Validate every selected subtree, including descendants removed by deduplication.
        let check = match action {
            BatchEditAction::Delete {} => EditAction::Delete {
                chrome_id: id.clone(),
            },
            BatchEditAction::Move { parent_id } => EditAction::Move {
                chrome_id: id.clone(),
                parent_id: parent_id.clone(),
                position: Position::new(
                    nodes
                        .iter()
                        .filter(|n| n.parent_id.as_ref() == Some(parent_id))
                        .count() as u64,
                )?,
            },
        };
        editing::plan(nodes, &check, &[], None)?;
    }
    let by_id: std::collections::HashMap<_, _> =
        nodes.iter().map(|node| (&node.chrome_id, node)).collect();
    let mut roots: Vec<_> = nodes
        .iter()
        .filter(|node| selected.contains(&node.chrome_id))
        .filter(|node| {
            let mut parent = node.parent_id.as_ref();
            while let Some(id) = parent {
                if selected.contains(id) {
                    return false;
                }
                parent = by_id.get(id).and_then(|n| n.parent_id.as_ref());
            }
            true
        })
        .collect();
    // Snapshot vectors are arrival ordered; preserve the visible tree order after external moves.
    roots.sort_by_cached_key(|node| {
        let mut order = vec![node.position.get()];
        let mut parent = node.parent_id.as_ref();
        while let Some(id) = parent {
            let Some(ancestor) = by_id.get(id) else {
                break;
            };
            order.push(ancestor.position.get());
            parent = ancestor.parent_id.as_ref();
        }
        order.reverse();
        order
    });
    let mut simulated = nodes.to_vec();
    let mut group = editing::Plan {
        steps: vec![],
        affected: 0,
        requires_second_confirm: false,
        changes: vec![],
        orders: vec![],
        restores: vec![],
        undo_of: None,
        conflicts: vec![],
    };
    let mut items = vec![];
    for original in roots {
        let current = simulated
            .iter()
            .find(|n| n.chrome_id == original.chrome_id)
            .cloned()
            .ok_or(ErrorCode::Conflict)?;
        let subtree: Vec<_> = nodes
            .iter()
            .filter(|n| {
                n.chrome_id == original.chrome_id
                    || is_descendant(nodes, &n.chrome_id, &original.chrome_id)
            })
            .cloned()
            .collect();
        let edit_action = match action {
            BatchEditAction::Move { parent_id } => {
                if current.parent_id.as_ref() == Some(parent_id) {
                    return Err(ErrorCode::InvalidMessage);
                }
                EditAction::Move {
                    chrome_id: current.chrome_id.clone(),
                    parent_id: parent_id.clone(),
                    position: Position::new(
                        simulated
                            .iter()
                            .filter(|n| n.parent_id.as_ref() == Some(parent_id))
                            .count() as u64,
                    )?,
                }
            }
            BatchEditAction::Delete {} => EditAction::Delete {
                chrome_id: current.chrome_id.clone(),
            },
        };
        let plan = editing::plan(&simulated, &edit_action, &[], None)?;
        let mut changes = plan.changes.clone();
        for change in &mut changes {
            if change.field == EditField::Parent {
                change.before.0 = original
                    .parent_id
                    .as_ref()
                    .map(|id| path(nodes, id))
                    .transpose()?;
                if let BatchEditAction::Move { parent_id } = action {
                    change.after.0 = Some(path(nodes, parent_id)?);
                }
            }
        }
        items.push(BatchEditItem {
            chrome_id: original.chrome_id.clone(),
            title: original.title.clone(),
            path: path(nodes, &original.chrome_id)?,
            affected: Counter::new(subtree.len() as u64)?,
            changes,
        });
        let event = match &edit_action {
            EditAction::Move {
                parent_id,
                position,
                ..
            } => BookmarkEvent::Moved {
                chrome_id: current.chrome_id.clone(),
                old_parent_id: current.parent_id.clone().ok_or(ErrorCode::ProtectedNode)?,
                old_position: current.position,
                parent_id: parent_id.clone(),
                position: *position,
            },
            _ => BookmarkEvent::Removed {
                chrome_id: current.chrome_id.clone(),
                parent_id: current.parent_id.clone().ok_or(ErrorCode::ProtectedNode)?,
                position: current.position,
                subtree,
            },
        };
        sync::apply_event(&mut simulated, &event)?;
        group.affected += items
            .last()
            .ok_or(ErrorCode::InvalidMessage)?
            .affected
            .get();
        if matches!(action, BatchEditAction::Delete {}) && group.affected > 1000 {
            return Err(ErrorCode::LimitExceeded);
        }
        group.steps.extend(plan.steps);
        for order in plan.orders {
            if !group.orders.iter().any(|o| o.parent_id == order.parent_id) {
                group.orders.push(order);
            }
        }
    }
    group.requires_second_confirm =
        matches!(action, BatchEditAction::Delete {}) && group.affected > editing::LARGE_DELETE;
    Ok((group, items))
}

fn is_descendant(nodes: &[BookmarkNode], id: &Id, ancestor: &Id) -> bool {
    let mut parent = nodes
        .iter()
        .find(|n| n.chrome_id == *id)
        .and_then(|n| n.parent_id.as_ref());
    while let Some(id) = parent {
        if id == ancestor {
            return true;
        }
        parent = nodes
            .iter()
            .find(|n| &n.chrome_id == id)
            .and_then(|n| n.parent_id.as_ref());
    }
    false
}

fn arm_timeout(bridge: Bridge, profile_id: Id, operation_id: Id) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(ACK_TIMEOUT_MS)).await;
        let _ = bridge.get_batch_edit(profile_id, operation_id).await;
    });
}

fn expected_subtree(nodes: &[BookmarkNode], target: &BookmarkNode) -> Vec<BookmarkNode> {
    nodes
        .iter()
        .filter(|node| {
            node.chrome_id == target.chrome_id
                || is_descendant(nodes, &node.chrome_id, &target.chrome_id)
        })
        .map(|node| {
            if node.chrome_id == target.chrome_id {
                target.clone()
            } else {
                node.clone()
            }
        })
        .collect()
}
