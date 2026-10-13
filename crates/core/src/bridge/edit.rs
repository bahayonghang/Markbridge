use super::{Bridge, Inner, Result, envelope, now, random_id};
use crate::editing::{self, ChildOrder, LocalRef, Plan, StoredEdit, StoredStep};
use crate::storage::{
    AfterBody, BeforeBody, EncodingBody, IdMapBody, OperationRecord, OrderBody, RestoreBody,
    StepRecord,
};
use crate::tags::last_title_after_receipt;
use markbridge_protocol::*;
use tokio::sync::mpsc;

impl Bridge {
    pub(super) async fn bind_outbound(
        &self,
        profile_id: &Id,
        session_id: &Id,
        sender: mpsc::UnboundedSender<WireMessage>,
    ) {
        let mut inner = self.inner.lock().await;
        if let Some(profile) = inner.profiles.get_mut(profile_id.as_str())
            && profile.session.as_ref() == Some(session_id)
        {
            profile.outbound = Some(sender);
        }
    }

    pub async fn preview_edit(
        &self,
        profile_id: Id,
        expected_revision: u64,
        action: EditAction,
    ) -> Result<EditPreview> {
        let inner = self.inner.lock().await;
        let (nodes, writable, revision) = {
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            if expected_revision != profile.view.revision.get() {
                return Err(ErrorCode::StaleProposal);
            }
            let writable = profile.view.connection == BridgeConnection::Live
                && !profile.writes_blocked
                && !profile.busy;
            (profile.nodes.clone(), writable, profile.view.revision)
        };
        let stored = stored_for(&inner, &profile_id, &action).await?;
        let planned = editing::plan(&nodes, &action, &stored.1, stored.0.as_ref());
        match planned {
            Ok(plan) => Ok(preview_of(&profile_id, revision, &plan, writable)),
            Err(error) => Ok(EditPreview {
                profile_id,
                expected_revision: Counter::new(expected_revision)?,
                affected: Counter::new(0)?,
                requires_second_confirm: false,
                writable: false,
                error_code: RequiredNullable(Some(error)),
                changes: vec![],
            }),
        }
    }

    pub async fn apply_edit(
        &self,
        profile_id: Id,
        expected_revision: u64,
        action: EditAction,
        second_confirm: bool,
    ) -> Result<ApplyResult> {
        let mut inner = self.inner.lock().await;
        let (epoch, revision, nodes, session, sender) = {
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            if profile.view.connection != BridgeConnection::Live {
                return Err(ErrorCode::ReadOnly);
            }
            if profile.writes_blocked || profile.busy {
                return Err(ErrorCode::Conflict);
            }
            if expected_revision != profile.view.revision.get() {
                return Err(ErrorCode::StaleProposal);
            }
            (
                profile.identity.source_epoch,
                profile.view.revision,
                profile.nodes.clone(),
                profile.session.clone().ok_or(ErrorCode::ReadOnly)?,
                profile.outbound.clone().ok_or(ErrorCode::ReadOnly)?,
            )
        };
        let stored = stored_for(&inner, &profile_id, &action).await?;
        let plan = editing::plan(&nodes, &action, &stored.1, stored.0.as_ref())?;
        if plan.requires_second_confirm && !second_confirm {
            return Err(ErrorCode::Cancelled);
        }
        if plan.steps.is_empty() {
            return record_conflict_only(&mut inner, self, &profile_id, &plan).await;
        }
        commit_planned(
            self,
            &mut inner,
            PlannedCommit {
                batch: None,
                profile_id: &profile_id,
                epoch,
                revision,
                nodes: &nodes,
                session: &session,
                sender,
                plan,
                encodings: Vec::new(),
                send_limit: None,
                operation_id: None,
            },
        )
        .await
    }

    pub async fn list_operations(&self, profile_id: Id) -> Result<OperationList> {
        let inner = self.inner.lock().await;
        if !inner.profiles.contains_key(profile_id.as_str()) {
            return Err(ErrorCode::WrongProfile);
        }
        let records = inner.storage()?.operations_for(profile_id).await?;
        Ok(OperationList {
            operations: summarize(inner.storage()?, records).await?,
        })
    }

    pub async fn review_operation(
        &self,
        profile_id: Id,
        operation_id: Id,
    ) -> Result<OperationList> {
        let mut inner = self.inner.lock().await;
        let record = inner.storage()?.operation(operation_id.clone()).await?;
        if record.profile_id != profile_id {
            return Err(ErrorCode::WrongProfile);
        }
        if !matches!(
            record.state,
            OperationState::Uncertain | OperationState::Partial | OperationState::RollbackConflict
        ) {
            return Err(ErrorCode::Conflict);
        }
        let mut after = record
            .after_json
            .as_deref()
            .and_then(|text| serde_json::from_str::<AfterBody>(text).ok())
            .unwrap_or_default();
        after.reviewed = true;
        let json = serde_json::to_string(&after).map_err(|_| ErrorCode::StorageError)?;
        inner
            .storage()?
            .set_operation_state(operation_id, record.state, Some(json))
            .await?;
        let blocked = inner.storage()?.blocked_profiles().await?;
        if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
            profile.writes_blocked = blocked.iter().any(|item| item == &profile_id);
        }
        let records = inner.storage()?.operations_for(profile_id).await?;
        self.publish(&mut inner);
        Ok(OperationList {
            operations: summarize(inner.storage()?, records).await?,
        })
    }

    pub async fn refresh_operations(&self, profile_id: Id) -> Result<OperationList> {
        let mut inner = self.inner.lock().await;
        if !inner.profiles.contains_key(profile_id.as_str()) {
            return Err(ErrorCode::WrongProfile);
        }
        queue_status(&mut inner, &profile_id).await;
        let records = inner.storage()?.operations_for(profile_id).await?;
        Ok(OperationList {
            operations: summarize(inner.storage()?, records).await?,
        })
    }

    pub async fn export_html(&self, profile_id: Id) -> Result<EditDocument> {
        let inner = self.inner.lock().await;
        let nodes = super::profile_nodes(&inner, &profile_id)?.to_vec();
        Ok(EditDocument {
            kind: EditDocumentKind::Html,
            body: editing::render_netscape(&nodes)?,
        })
    }

    pub async fn export_sidecar(&self, profile_id: Id) -> Result<EditDocument> {
        let inner = self.inner.lock().await;
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        let epoch = profile.identity.source_epoch;
        let rows = inner
            .storage()?
            .sidecar_rows(profile_id.clone(), epoch)
            .await?;
        Ok(EditDocument {
            kind: EditDocumentKind::Sidecar,
            body: editing::render_sidecar(&profile_id, epoch.get(), &to_locals(rows))?,
        })
    }
}

pub(super) async fn accept_receipt(
    inner: &mut Inner,
    profile_id: &Id,
    receipt: &Receipt,
) -> Result<()> {
    let record = match inner
        .storage()?
        .operation(receipt.operation_id.clone())
        .await
    {
        Ok(record) => record,
        Err(_) => return Ok(()),
    };
    if record.profile_id != *profile_id {
        return Err(ErrorCode::WrongProfile);
    }
    if !record
        .steps
        .iter()
        .any(|step| step.request_id == receipt.request_id)
    {
        return Ok(());
    }
    inner.storage()?.save_receipt(receipt.clone()).await?;
    let record = inner
        .storage()?
        .operation(receipt.operation_id.clone())
        .await?;
    let before: BeforeBody =
        serde_json::from_str(&record.before_json).map_err(|_| ErrorCode::StorageError)?;
    if let Some(hint) = before
        .restores
        .iter()
        .find(|item| item.request_id == receipt.request_id)
        && matches!(receipt.state, OperationState::Applied)
        && let Some(after_node) = &receipt.after
    {
        let mut after = record
            .after_json
            .as_deref()
            .and_then(|text| serde_json::from_str::<AfterBody>(text).ok())
            .unwrap_or_default();
        after.maps.push(IdMapBody {
            request_id: hint.request_id.clone(),
            old_chrome_id: hint.old_chrome_id.clone(),
            new_chrome_id: after_node.chrome_id.clone(),
            old_bookmark_id: hint.old_bookmark_id.clone(),
        });
        let json = serde_json::to_string(&after).map_err(|_| ErrorCode::StorageError)?;
        let epoch = record.source_epoch;
        inner
            .storage()?
            .set_operation_state(
                record.operation_id.clone(),
                record.state.clone(),
                Some(json),
            )
            .await?;
        // The created event can update the cache before this map exists. Copy again when the map is stored.
        inner
            .storage()?
            .copy_mapped_metadata(profile_id.clone(), epoch, super::now()?)
            .await?;
    }
    if matches!(receipt.state, OperationState::Applied)
        && let Some(intent) = before
            .encodings
            .iter()
            .find(|item| item.request_id == receipt.request_id)
        && let Some(after_node) = &receipt.after
    {
        let matched = if intent.restore {
            after_node.title.as_str() == intent.raw_title
        } else {
            after_node.title.as_str() == intent.encoded_title
        };
        if matched {
            inner
                .storage()?
                .record_title_encoding(
                    intent.bookmark_id.clone(),
                    intent.raw_title.clone(),
                    Some(last_title_after_receipt(
                        intent.restore,
                        &intent.raw_title,
                        &intent.encoded_title,
                    )),
                    super::now()?,
                )
                .await?;
        }
    }
    let record = inner
        .storage()?
        .operation(receipt.operation_id.clone())
        .await?;
    let mut states: Vec<Option<OperationState>> = record
        .steps
        .iter()
        .map(|step| step.receipt.as_ref().map(|item| item.state.clone()))
        .collect();
    if matches!(
        receipt.state,
        OperationState::Failed | OperationState::Uncertain
    ) {
        for state in &mut states {
            if state.is_none() {
                *state = Some(receipt.state.clone());
            }
        }
    }
    let before: BeforeBody =
        serde_json::from_str(&record.before_json).map_err(|_| ErrorCode::StorageError)?;
    let finished = states.iter().all(Option::is_some);
    let state = editing::fold_states(
        &states,
        before.undo_of.is_some(),
        !before.conflicts.is_empty(),
        finished,
    );
    inner
        .storage()?
        .set_operation_state(record.operation_id.clone(), state.clone(), None)
        .await?;
    if let Some(original) = before.undo_of.clone() {
        let original_state = match &state {
            OperationState::RollingBack => OperationState::RollingBack,
            OperationState::RolledBack => OperationState::RolledBack,
            OperationState::Uncertain => OperationState::Uncertain,
            _ if !before.conflicts.is_empty()
                || matches!(
                    state,
                    OperationState::RollbackConflict
                        | OperationState::Partial
                        | OperationState::Failed
                ) =>
            {
                OperationState::RollbackConflict
            }
            other => other.clone(),
        };
        inner
            .storage()?
            .set_operation_state(original, original_state, None)
            .await?;
    }
    let blocked = inner.storage()?.blocked_profiles().await?;
    if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
        if !matches!(
            state,
            OperationState::Applying | OperationState::RollingBack | OperationState::Planned
        ) {
            profile.busy = false;
        }
        profile.writes_blocked = blocked.iter().any(|item| item == profile_id);
    }
    if state == OperationState::Applied && before.undo_of.is_none() {
        inner
            .storage()?
            .apply_merge(record.operation_id.clone())
            .await?;
    }
    if state == OperationState::RolledBack
        && let Some(original) = before.undo_of.clone()
    {
        inner.storage()?.reverse_merge(original).await?;
    }
    Ok(())
}

pub(super) async fn queue_status(inner: &mut Inner, profile_id: &Id) {
    let pending: Vec<Id> = {
        let Ok(storage) = inner.storage() else { return };
        let Ok(records) = storage.operations_for(profile_id.clone()).await else {
            return;
        };
        records
            .into_iter()
            .filter(|record| {
                matches!(
                    record.state,
                    OperationState::Uncertain
                        | OperationState::Applying
                        | OperationState::RollingBack
                )
            })
            .map(|record| record.operation_id)
            .collect()
    };
    let Some(profile) = inner.profiles.get(profile_id.as_str()) else {
        return;
    };
    let Some(sender) = profile.outbound.clone() else {
        return;
    };
    let Some(session) = profile.session.clone() else {
        return;
    };
    for operation_id in pending {
        let Ok(request) = random_id("status") else {
            continue;
        };
        let Ok(message) = envelope(
            "get_operation_status",
            profile_id,
            &session,
            Some(request),
            serde_json::json!({"operationId": operation_id}),
        ) else {
            continue;
        };
        let _ = sender.send(message);
    }
}

pub(super) async fn stored_for(
    inner: &Inner,
    profile_id: &Id,
    action: &EditAction,
) -> Result<(Option<StoredEdit>, Vec<LocalRef>)> {
    let EditAction::Undo { operation_id } = action else {
        return Ok((None, vec![]));
    };
    let record = inner.storage()?.operation(operation_id.clone()).await?;
    if record.profile_id != *profile_id {
        return Err(ErrorCode::WrongProfile);
    }
    if inner
        .profiles
        .get(profile_id.as_str())
        .ok_or(ErrorCode::WrongProfile)?
        .identity
        .source_epoch
        != record.source_epoch
    {
        return Err(ErrorCode::Conflict);
    }
    let epoch = record.source_epoch;
    let snapshot = inner.storage()?.snapshot_tree(operation_id.clone()).await?;
    let rows = inner
        .storage()?
        .sidecar_rows(profile_id.clone(), epoch)
        .await?;
    Ok((Some(to_stored(record, snapshot)?), to_locals(rows)))
}

async fn record_conflict_only(
    inner: &mut Inner,
    bridge: &Bridge,
    profile_id: &Id,
    plan: &Plan,
) -> Result<ApplyResult> {
    let Some(original) = plan.undo_of.clone() else {
        return Err(ErrorCode::InvalidMessage);
    };
    if plan.conflicts.is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    let record = inner.storage()?.operation(original.clone()).await?;
    let mut after = record
        .after_json
        .as_deref()
        .and_then(|text| serde_json::from_str::<AfterBody>(text).ok())
        .unwrap_or_default();
    after.conflicts.extend(plan.conflicts.clone());
    after.reviewed = false;
    let json = serde_json::to_string(&after).map_err(|_| ErrorCode::StorageError)?;
    inner
        .storage()?
        .set_operation_state(
            original.clone(),
            OperationState::RollbackConflict,
            Some(json),
        )
        .await?;
    if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
        profile.writes_blocked = true;
        profile.busy = false;
    }
    bridge.publish(inner);
    Ok(ApplyResult {
        operation_id: original,
        state: OperationState::RollbackConflict,
        error_code: RequiredNullable(Some(ErrorCode::Conflict)),
        conflicts: plan.conflicts.clone(),
    })
}

fn to_stored(
    record: OperationRecord,
    snapshot: Vec<markbridge_protocol::BookmarkNode>,
) -> Result<StoredEdit> {
    let before: BeforeBody = serde_json::from_str(&record.before_json).unwrap_or(BeforeBody {
        batch: None,
        nodes: vec![],
        orders: vec![],
        restores: vec![],
        undo_of: None,
        conflicts: vec![],
        encodings: vec![],
    });
    Ok(StoredEdit {
        operation_id: record.operation_id,
        state: record.state,
        snapshot,
        orders: before
            .orders
            .into_iter()
            .map(|order| ChildOrder {
                parent_id: order.parent_id,
                child_ids: order.child_ids,
            })
            .collect(),
        steps: record
            .steps
            .into_iter()
            .map(|step| StoredStep {
                request_id: step.request_id,
                payload: step.payload,
                before: step
                    .receipt
                    .as_ref()
                    .and_then(|receipt| receipt.before.clone())
                    .or(step.expected_before),
                after: step
                    .receipt
                    .as_ref()
                    .and_then(|receipt| receipt.after.clone()),
                before_child_ids: step
                    .receipt
                    .as_ref()
                    .and_then(|receipt| receipt.before_child_ids.clone())
                    .or(step.expected_child_ids),
                after_child_ids: step
                    .receipt
                    .as_ref()
                    .and_then(|receipt| receipt.after_child_ids.clone()),
                applied: step
                    .receipt
                    .as_ref()
                    .is_some_and(|receipt| receipt.state == OperationState::Applied),
            })
            .collect(),
    })
}

fn to_locals(rows: Vec<crate::storage::SidecarRow>) -> Vec<LocalRef> {
    rows.into_iter()
        .map(|row| LocalRef {
            bookmark_id: row.bookmark_id,
            chrome_id: row.chrome_id,
            note: row.note,
            summary: row.summary,
            display_title: row.display_title,
        })
        .collect()
}

pub(super) struct PlannedCommit<'a> {
    pub batch: Option<BatchEditPreview>,
    pub profile_id: &'a Id,
    pub epoch: SourceEpoch,
    pub revision: Counter,
    pub nodes: &'a [BookmarkNode],
    pub session: &'a Id,
    pub sender: mpsc::UnboundedSender<WireMessage>,
    pub plan: Plan,
    pub encodings: Vec<EncodingBody>,
    pub send_limit: Option<usize>,
    pub operation_id: Option<Id>,
}

pub(super) async fn commit_planned(
    bridge: &Bridge,
    inner: &mut Inner,
    commit: PlannedCommit<'_>,
) -> Result<ApplyResult> {
    let PlannedCommit {
        batch,
        profile_id,
        epoch,
        revision,
        nodes,
        session,
        sender,
        plan,
        encodings,
        send_limit,
        operation_id,
    } = commit;
    if let Some(held) = inner
        .profiles
        .get(profile_id.as_str())
        .and_then(|profile| profile.batch_hold.clone())
        && plan.undo_of.as_ref() != Some(&held)
    {
        return Err(ErrorCode::Conflict);
    }
    let operation = operation_id.unwrap_or(editing::operation_id()?);
    let limit = send_limit.unwrap_or(plan.steps.len()).min(plan.steps.len());
    if limit == 0 {
        return Err(ErrorCode::InvalidMessage);
    }
    if batch.is_some() {
        // A later oversized subtree must reject the entire group before the first effect.
        for step in &plan.steps {
            one_step(profile_id, session, &operation, epoch, revision, step)?;
        }
    }
    if batch.is_some()
        || (plan.steps.len() == 1 && matches!(plan.steps[0].payload, Mutation::Delete {}))
    {
        let recovery = editing::recovery_steps_for_frame_check(nodes, &plan.steps)?;
        let recovery_id = editing::operation_id()?;
        apply_message(
            profile_id,
            session,
            &recovery_id,
            epoch,
            revision,
            &recovery,
        )?;
    }
    let message = apply_message(
        profile_id,
        session,
        &operation,
        epoch,
        revision,
        &plan.steps[..limit],
    )?;
    let rows = inner
        .storage()?
        .sidecar_rows(profile_id.clone(), epoch)
        .await?;
    let locals = to_locals(rows);
    let html = editing::render_netscape(nodes)?;
    let sidecar = editing::render_sidecar(profile_id, epoch.get(), &locals)?;
    let backup_dir = inner.backup_dir.clone();
    let (html_path, sidecar_path) =
        editing::write_backup_pair(&backup_dir, &operation, &html, &sidecar)?;
    let created = now()?;
    let mut before = before_body(&plan, nodes, encodings);
    before.batch = batch;
    let before_json = serde_json::to_string(&before).map_err(|_| ErrorCode::StorageError)?;
    let tree_before = serde_json::to_string(nodes).map_err(|_| ErrorCode::StorageError)?;
    let record = OperationRecord {
        operation_id: operation.clone(),
        created_at: created,
        profile_id: profile_id.clone(),
        source_epoch: epoch,
        state: OperationState::Applying,
        before_json,
        after_json: before
            .batch
            .as_ref()
            .map(|_| {
                serde_json::to_string(&AfterBody {
                    batch: Some(crate::storage::BatchProgress {
                        dispatched: 1,
                        dispatched_at: created,
                        stopped: false,
                        error: None,
                    }),
                    ..AfterBody::default()
                })
            })
            .transpose()
            .map_err(|_| ErrorCode::StorageError)?,
        steps: plan
            .steps
            .iter()
            .enumerate()
            .map(|(ordinal, step)| StepRecord {
                ordinal: ordinal as u64,
                request_id: step.request_id.clone(),
                target: step.target.clone(),
                payload: step.payload.clone(),
                expected_before: step.expected_before.clone(),
                expected_child_ids: step.expected_child_ids.clone(),
                receipt: None,
            })
            .collect(),
    };
    if let Err(error) = inner
        .storage()?
        .insert_operation(
            record,
            tree_before,
            sidecar,
            html_path.to_string_lossy().into_owned(),
            sidecar_path.to_string_lossy().into_owned(),
            created,
        )
        .await
    {
        let _ = std::fs::remove_file(html_path);
        let _ = std::fs::remove_file(sidecar_path);
        return Err(error);
    }
    if let Some(original) = &plan.undo_of {
        inner
            .storage()?
            .set_operation_state(original.clone(), OperationState::RollingBack, None)
            .await?;
    }
    if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
        profile.busy = true;
        if send_limit.is_some() {
            profile.batch_hold = Some(operation.clone());
        }
    }
    if sender.send(message).is_err() {
        let _ = inner
            .storage()?
            .set_operation_state(operation.clone(), OperationState::Failed, None)
            .await;
        if let Some(original) = &plan.undo_of {
            let _ = inner
                .storage()?
                .set_operation_state(original.clone(), OperationState::Applied, None)
                .await;
        }
        if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
            profile.busy = false;
            if profile.batch_hold.as_ref() == Some(&operation) {
                profile.batch_hold = None;
            }
        }
        bridge.publish(inner);
        return Err(ErrorCode::ReadOnly);
    }
    bridge.publish(inner);
    Ok(ApplyResult {
        operation_id: operation,
        state: if plan.undo_of.is_some() {
            OperationState::RollingBack
        } else {
            OperationState::Applying
        },
        error_code: RequiredNullable(None),
        conflicts: plan.conflicts,
    })
}

fn before_body(plan: &Plan, nodes: &[BookmarkNode], encodings: Vec<EncodingBody>) -> BeforeBody {
    let touched = plan
        .steps
        .iter()
        .filter_map(|step| step.expected_before.clone())
        .collect::<Vec<_>>();
    let _ = nodes;
    BeforeBody {
        batch: None,
        nodes: if touched.is_empty() {
            nodes.to_vec()
        } else {
            touched
        },
        orders: plan
            .orders
            .iter()
            .cloned()
            .map(|order| OrderBody {
                parent_id: order.parent_id,
                child_ids: order.child_ids,
            })
            .collect(),
        restores: plan
            .restores
            .iter()
            .cloned()
            .map(|hint| RestoreBody {
                request_id: hint.request_id,
                old_chrome_id: hint.old_chrome_id,
                old_bookmark_id: hint.old_bookmark_id,
            })
            .collect(),
        undo_of: plan.undo_of.clone(),
        conflicts: plan.conflicts.clone(),
        encodings,
    }
}

fn preview_of(profile_id: &Id, revision: Counter, plan: &Plan, writable: bool) -> EditPreview {
    let error = if plan.conflicts.is_empty() {
        None
    } else {
        Some(ErrorCode::Conflict)
    };
    EditPreview {
        profile_id: profile_id.clone(),
        expected_revision: revision,
        affected: Counter::new(plan.affected).unwrap_or(revision),
        requires_second_confirm: plan.requires_second_confirm,
        writable: writable && (error.is_none() || plan.undo_of.is_some()),
        error_code: RequiredNullable(error),
        changes: plan.changes.iter().take(50).cloned().collect(),
    }
}

pub(super) fn one_step(
    profile: &Id,
    session: &Id,
    operation: &Id,
    epoch: SourceEpoch,
    revision: Counter,
    step: &OperationStep,
) -> Result<WireMessage> {
    apply_message(
        profile,
        session,
        operation,
        epoch,
        revision,
        std::slice::from_ref(step),
    )
}

fn apply_message(
    profile: &Id,
    session: &Id,
    operation: &Id,
    epoch: SourceEpoch,
    revision: Counter,
    steps: &[OperationStep],
) -> Result<WireMessage> {
    let request = random_id("apply")?;
    let message = envelope(
        "apply_operation",
        profile,
        session,
        Some(request),
        serde_json::json!({
            "operationId": operation,
            "sourceEpoch": epoch.get(),
            "expectedRevision": revision.get(),
            "steps": steps,
        }),
    )?;
    // Check the complete reviewed payload before backup/operation insertion and before any send.
    encode_frame(&message)?;
    Ok(message)
}

pub(super) async fn summarize(
    storage: &crate::storage::Storage,
    records: Vec<OperationRecord>,
) -> Result<Vec<OperationSummary>> {
    let mut records = records;
    records.sort_by_key(|record| {
        !matches!(
            record.state,
            OperationState::Uncertain
                | OperationState::Partial
                | OperationState::RollbackConflict
                | OperationState::Applying
                | OperationState::RollingBack
        )
    });
    let mut summaries = Vec::new();
    for record in records.into_iter().take(200) {
        let before = serde_json::from_str::<BeforeBody>(&record.before_json).ok();
        let is_batch = before.as_ref().is_some_and(|body| body.batch.is_some());
        let snapshot = if record
            .steps
            .iter()
            .any(|step| matches!(step.payload, Mutation::Delete {}))
        {
            storage.snapshot_tree(record.operation_id.clone()).await?
        } else {
            vec![]
        };
        let affected = before
            .as_ref()
            .and_then(|body| body.batch.as_ref())
            .map_or_else(
                || {
                    let mut ids = std::collections::HashSet::new();
                    for step in &record.steps {
                        if matches!(step.payload, Mutation::Delete {}) {
                            if let Some(target) = &step.target {
                                ids.insert(target.clone());
                                ids.extend(
                                    super::history::descendants(&snapshot, target)
                                        .into_iter()
                                        .map(|node| node.chrome_id),
                                );
                            }
                        } else {
                            ids.insert(step.request_id.clone());
                        }
                    }
                    ids.len() as u64
                },
                |batch| batch.affected.get(),
            );
        let kind = if before.as_ref().is_some_and(|body| body.undo_of.is_some()) {
            HistoryKind::Undo
        } else {
            let mut kinds = record
                .steps
                .iter()
                .map(|step| super::history::mutation_kind(&step.payload));
            let first = kinds.next().unwrap_or(HistoryKind::Mixed);
            if kinds.all(|kind| kind == first) {
                first
            } else {
                HistoryKind::Mixed
            }
        };
        let after = record
            .after_json
            .as_deref()
            .and_then(|text| serde_json::from_str::<AfterBody>(text).ok());
        let conflicts = after
            .as_ref()
            .map(|body| body.conflicts.clone())
            .filter(|items| !items.is_empty())
            .or_else(|| before.map(|body| body.conflicts))
            .unwrap_or_default();
        summaries.push(OperationSummary {
            operation_id: record.operation_id,
            created_at: Some(Counter::new(record.created_at)?),
            kind: Some(kind),
            reviewed: after.as_ref().is_some_and(|body| body.reviewed),
            is_batch,
            affected: Counter::new(affected)?,
            error_code: RequiredNullable(match record.state {
                OperationState::Uncertain => Some(ErrorCode::UncertainWrite),
                OperationState::Failed => record
                    .steps
                    .iter()
                    .find_map(|step| step.receipt.as_ref().and_then(|receipt| receipt.error_code)),
                OperationState::RollbackConflict | OperationState::Partial => {
                    Some(ErrorCode::Conflict)
                }
                _ => None,
            }),
            conflicts: conflicts.into_iter().take(50).collect(),
            state: record.state,
        });
    }
    Ok(summaries)
}
