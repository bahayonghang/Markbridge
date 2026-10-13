//! One organization job. Browser steps leave this process one at a time through `apply_operation`.
use std::collections::{HashMap, HashSet};

use markbridge_protocol::{
    BridgeConnection, Counter, ErrorCode, Id, Mutation, NodeKind, OperationState,
    OrganizationFolder, OrganizationPlan, SourceEpoch,
};
use tokio::sync::mpsc;

use super::{Bridge, Inner, Result};
use crate::editing::{self, ReclassFolder, ReclassMove};
use crate::organization::{self as org, AssignRow, FolderRow, Record, ScopeRow, StepFact};
use crate::storage::{OperationRecord, StepRecord, ai::OrganizationJob};

impl Bridge {
    pub async fn propose_organization(
        &self,
        profile_id: Id,
        chrome_ids: Vec<Id>,
    ) -> Result<OrganizationPlan> {
        self.propose_organization_with_request(profile_id, chrome_ids, None)
            .await
    }

    pub async fn propose_organization_with_request(
        &self,
        profile_id: Id,
        chrome_ids: Vec<Id>,
        request_id: Option<Id>,
    ) -> Result<OrganizationPlan> {
        let id = match request_id {
            Some(id) => id,
            None => org::job_id()?,
        };
        let flag = self.ai_gate.begin_unique(&id).await?;
        let result = async {
            let (storage, mut record, sample, reserved, revision) = {
                let inner = self.inner.lock().await;
                let profile = inner
                    .profiles
                    .get(profile_id.as_str())
                    .ok_or(ErrorCode::WrongProfile)?;
                let cached = inner
                    .storage()?
                    .bookmarks(profile_id.clone(), profile.identity.source_epoch)
                    .await?;
                let bookmarks = bookmark_ids(&cached);
                let nodes = profile.nodes.clone();
                let rows = scope_rows(&nodes, &chrome_ids, &bookmarks)?;
                let parents = rows
                    .iter()
                    .map(|row| Id::new(&row.parent_id))
                    .collect::<Result<Vec<_>>>()?;
                let anchor = editing::choose_anchor(&nodes, &parents)?;
                let mut reserved = org::reserved_ids(&rows, anchor.as_str());
                for node in &nodes {
                    reserved.insert(node.chrome_id.as_str().to_owned());
                }
                let sample = org::sample_rows(&rows);
                let mut record = Record {
                    profile_id: profile_id.as_str().to_owned(),
                    source_epoch: profile.identity.source_epoch.get(),
                    source_revision: profile.view.revision.get(),
                    fingerprint: org::input_fingerprint(
                        profile_id.as_str(),
                        profile.identity.source_epoch.get(),
                        profile.view.revision.get(),
                        &rows,
                    ),
                    anchor_id: anchor.as_str().to_owned(),
                    scope: rows,
                    sampled: sample.len() as u64,
                    folders: Vec::new(),
                    assignments: Vec::new(),
                    phase: "folders".to_owned(),
                    plan_hash: String::new(),
                    operation_id: None,
                    dispatched: Vec::new(),
                    backup_verified: false,
                    failure: None,
                    failure_message: None,
                };
                org::rehash(&mut record);
                let revision = profile.view.revision.get();
                (inner.storage()?.share(), record, sample, reserved, revision)
            };
            save_new(&storage, &id, &record).await?;
            let secrets = self.secrets();
            let states = self.state.clone();
            let watched = profile_id.as_str().to_owned();
            let outcome = org::propose_folders(
                org::ModelEnv {
                    storage: &storage,
                    secrets: &secrets,
                    transport: self.model_transport.as_ref(),
                    flag: &flag,
                },
                &sample,
                &reserved,
                move || current_revision(&states, &watched) == Some(revision),
            )
            .await;
            let inner = self.inner.lock().await;
            record = reload(&inner, &id).await?.1;
            match outcome {
                Ok(folders) if same_basis(&inner, &record)? => {
                    record.folders = folders;
                    record.phase = "folders".to_owned();
                    record.failure = None;
                    record.failure_message = None;
                    org::rehash(&mut record);
                }
                Ok(_) => org::fail(
                    &mut record,
                    "invalid",
                    ErrorCode::StaleProposal,
                    org::MSG_STALE,
                ),
                Err(error) => {
                    let phase = if error.code == ErrorCode::StaleProposal {
                        "invalid"
                    } else if error.code == ErrorCode::Cancelled {
                        "cancelled"
                    } else {
                        "failed"
                    };
                    org::fail(&mut record, phase, error.code, &error.message);
                }
            }
            store(&inner, &id, &record).await?;
            present(&inner, &id, &record).await
        }
        .await;
        self.ai_gate.finish(&id, &flag).await;
        result
    }

    pub async fn review_organization(
        &self,
        job_id: Id,
        folders: Vec<OrganizationFolder>,
    ) -> Result<OrganizationPlan> {
        let inner = self.inner.lock().await;
        let (_, mut record) = reload(&inner, &job_id).await?;
        if !matches!(
            record.phase.as_str(),
            "folders" | "reviewed" | "ready" | "failed" | "invalid" | "paused" | "cancelled"
        ) {
            return Err(ErrorCode::Conflict);
        }
        if !same_basis(&inner, &record)? {
            org::fail(
                &mut record,
                "invalid",
                ErrorCode::StaleProposal,
                org::MSG_STALE,
            );
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        let rows = folders
            .into_iter()
            .map(|folder| FolderRow {
                folder_id: folder.folder_id.as_str().to_owned(),
                name: folder.name,
                parent_folder_id: folder
                    .parent_folder_id
                    .0
                    .as_ref()
                    .map(|id| id.as_str().to_owned()),
                reviewed: folder.reviewed,
            })
            .collect();
        let profile = inner
            .profiles
            .get(record.profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        let mut reserved = org::reserved_ids(&record.scope, &record.anchor_id);
        for node in &profile.nodes {
            reserved.insert(node.chrome_id.as_str().to_owned());
        }
        org::review_folders(&mut record, rows, &reserved)?;
        store(&inner, &job_id, &record).await?;
        present(&inner, &job_id, &record).await
    }

    pub async fn assign_organization(&self, job_id: Id) -> Result<OrganizationPlan> {
        let (storage, scope, folders, revision, profile_id) = {
            let inner = self.inner.lock().await;
            let (_, mut record) = reload(&inner, &job_id).await?;
            if !matches!(record.phase.as_str(), "reviewed" | "paused" | "failed") {
                return Err(ErrorCode::Conflict);
            }
            if !same_basis(&inner, &record)? {
                org::fail(
                    &mut record,
                    "invalid",
                    ErrorCode::StaleProposal,
                    org::MSG_STALE,
                );
                store(&inner, &job_id, &record).await?;
                return present(&inner, &job_id, &record).await;
            }
            let pending: Vec<ScopeRow> = record
                .scope
                .iter()
                .filter(|row| {
                    record
                        .assignments
                        .iter()
                        .all(|item| item.chrome_id != row.chrome_id)
                })
                .cloned()
                .collect();
            record.phase = "assigning".to_owned();
            record.failure = None;
            record.failure_message = None;
            let revision = record.source_revision;
            let profile_id = record.profile_id.clone();
            let folders = record.folders.clone();
            store(&inner, &job_id, &record).await?;
            (
                inner.storage()?.share(),
                pending,
                folders,
                revision,
                profile_id,
            )
        };
        let flag = self.ai_gate.begin(&job_id).await;
        let secrets = self.secrets();
        let states = self.state.clone();
        let watched = profile_id.clone();
        let outcome = org::classify_scope(
            org::ModelEnv {
                storage: &storage,
                secrets: &secrets,
                transport: self.model_transport.as_ref(),
                flag: &flag,
            },
            &scope,
            &folders,
            move || current_revision(&states, &watched) == Some(revision),
        )
        .await;
        let inner = self.inner.lock().await;
        let (_, mut record) = reload(&inner, &job_id).await?;
        let (rows, error) = match outcome {
            Ok(rows) => (rows, None),
            Err(mut error) => {
                let rows = std::mem::take(&mut error.rows);
                (rows, Some(error))
            }
        };
        for row in rows {
            if record
                .assignments
                .iter()
                .any(|item| item.chrome_id == row.chrome_id)
            {
                org::fail(
                    &mut record,
                    "failed",
                    ErrorCode::InvalidAiOutput,
                    org::MSG_FORMAT,
                );
                store(&inner, &job_id, &record).await?;
                return present(&inner, &job_id, &record).await;
            }
            record.assignments.push(row);
        }
        if matches!(record.phase.as_str(), "paused" | "cancelled") {
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        if let Some(error) = error {
            let phase = if error.code == ErrorCode::StaleProposal {
                "invalid"
            } else if error.code == ErrorCode::Cancelled {
                "cancelled"
            } else {
                "failed"
            };
            org::fail(&mut record, phase, error.code, &error.message);
        } else if !same_basis(&inner, &record)? {
            org::fail(
                &mut record,
                "invalid",
                ErrorCode::StaleProposal,
                org::MSG_STALE,
            );
        } else if org::validate_coverage(&record.scope, &record.folders, &record.assignments)
            .is_ok()
        {
            record.phase = "ready".to_owned();
            record.failure = None;
            record.failure_message = None;
            org::rehash(&mut record);
        } else {
            org::fail(
                &mut record,
                "failed",
                ErrorCode::InvalidAiOutput,
                org::MSG_FORMAT,
            );
        }
        store(&inner, &job_id, &record).await?;
        present(&inner, &job_id, &record).await
    }

    pub async fn edit_organization(
        &self,
        job_id: Id,
        chrome_id: Id,
        target_folder_id: Id,
        rejected: bool,
    ) -> Result<OrganizationPlan> {
        let inner = self.inner.lock().await;
        let (_, mut record) = reload(&inner, &job_id).await?;
        if !same_basis(&inner, &record)? {
            org::fail(
                &mut record,
                "invalid",
                ErrorCode::StaleProposal,
                org::MSG_STALE,
            );
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        org::edit_assignment(
            &mut record,
            chrome_id.as_str(),
            target_folder_id.as_str(),
            rejected,
        )?;
        store(&inner, &job_id, &record).await?;
        present(&inner, &job_id, &record).await
    }

    pub async fn organization_plan(&self, job_id: Id) -> Result<OrganizationPlan> {
        let inner = self.inner.lock().await;
        let (_, record) = reload(&inner, &job_id).await?;
        present(&inner, &job_id, &record).await
    }

    pub async fn pause_organization(&self, job_id: Id) -> Result<OrganizationPlan> {
        self.ai_gate.cancel(&job_id).await;
        let mut inner = self.inner.lock().await;
        let (_, mut record) = reload(&inner, &job_id).await?;
        if matches!(record.phase.as_str(), "assigning" | "folders" | "applying") {
            if record.phase == "applying"
                && let Some(profile) = inner.profiles.get_mut(record.profile_id.as_str())
            {
                profile.busy = false;
            }
            record.phase = "paused".to_owned();
            record.failure = Some(org::code_name(ErrorCode::Cancelled));
            record.failure_message = Some(org::MSG_PAUSED.to_owned());
            store(&inner, &job_id, &record).await?;
        }
        present(&inner, &job_id, &record).await
    }

    pub async fn cancel_organization(&self, job_id: Id) -> Result<OrganizationPlan> {
        self.ai_gate.cancel(&job_id).await;
        let mut inner = self.inner.lock().await;
        let (_, mut record) = reload(&inner, &job_id).await?;
        if record.phase == "applying"
            && let Some(profile) = inner.profiles.get_mut(record.profile_id.as_str())
        {
            profile.busy = false;
        }
        if !matches!(record.phase.as_str(), "applied" | "cancelled") {
            record.phase = "cancelled".to_owned();
            record.failure = Some(org::code_name(ErrorCode::Cancelled));
            record.failure_message = Some(org::MSG_CANCELLED.to_owned());
            store(&inner, &job_id, &record).await?;
        }
        present(&inner, &job_id, &record).await
    }

    pub async fn apply_organization(&self, job_id: Id, plan_hash: Id) -> Result<OrganizationPlan> {
        let mut inner = self.inner.lock().await;
        let (_, mut record) = reload(&inner, &job_id).await?;
        let profile = inner
            .profiles
            .get(record.profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        let live = profile.view.connection == BridgeConnection::Live
            && profile.session.is_some()
            && profile.outbound.is_some();
        if !live {
            record.failure = Some(org::code_name(ErrorCode::ReadOnly));
            record.failure_message = Some(org::MSG_OFFLINE.to_owned());
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        if profile.busy || profile.writes_blocked || profile.batch_hold.is_some() {
            return Err(ErrorCode::Conflict);
        }
        if plan_hash.as_str() != record.plan_hash {
            record.failure = Some(org::code_name(ErrorCode::StaleProposal));
            record.failure_message = Some(org::MSG_HASH.to_owned());
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        if !same_basis(&inner, &record)? || record.phase != "ready" {
            org::fail(
                &mut record,
                "invalid",
                ErrorCode::StaleProposal,
                org::MSG_STALE,
            );
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        org::apply_gate(&record.phase, true, true, true)?;
        let accepted: Vec<&AssignRow> = record
            .assignments
            .iter()
            .filter(|row| !row.rejected)
            .collect();
        let targets: HashSet<String> = accepted
            .iter()
            .map(|row| row.target_folder_id.clone())
            .collect();
        let folders = org::needed_folders(&record.folders, &targets);
        if accepted.is_empty() || folders.is_empty() {
            record.phase = "applied".to_owned();
            record.failure = None;
            record.failure_message = None;
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        let profile_id = Id::new(&record.profile_id)?;
        let nodes = profile.nodes.clone();
        let session = profile.session.clone().ok_or(ErrorCode::ReadOnly)?;
        let sender = profile.outbound.clone().ok_or(ErrorCode::ReadOnly)?;
        let epoch = profile.identity.source_epoch;
        let revision = profile.view.revision;
        let anchor = Id::new(&record.anchor_id)?;
        let planned = build_plan(&nodes, &anchor, &folders, &accepted)?;
        let operation = editing::operation_id()?;
        record.phase = "applying".to_owned();
        record.operation_id = Some(operation.as_str().to_owned());
        record.dispatched = vec![planned.steps[0].request_id.as_str().to_owned()];
        record.backup_verified = false;
        record.failure = None;
        record.failure_message = None;
        store(&inner, &job_id, &record).await?;
        let sent = edit_commit(
            self,
            &mut inner,
            BatchCommit {
                profile_id: &profile_id,
                epoch,
                revision,
                nodes: &nodes,
                session: &session,
                sender,
                plan: planned,
                send_limit: Some(1),
                operation,
            },
        )
        .await;
        if let Err(error) = sent {
            record.phase = "ready".to_owned();
            record.operation_id = None;
            record.dispatched.clear();
            record.backup_verified = false;
            record.failure = Some(org::code_name(error));
            record.failure_message = Some(if error == ErrorCode::ReadOnly {
                org::MSG_OFFLINE.to_owned()
            } else if error == ErrorCode::Conflict {
                "已有未完成的批量写入。没有开始新的步骤。".to_owned()
            } else {
                "备份失败。这次浏览器变更已取消。".to_owned()
            });
            store(&inner, &job_id, &record).await?;
        } else {
            record.backup_verified = true;
            store(&inner, &job_id, &record).await?;
        }
        present(&inner, &job_id, &record).await
    }

    pub async fn cleanup_organization(
        &self,
        job_id: Id,
        confirm: bool,
        second_confirm: bool,
    ) -> Result<OrganizationPlan> {
        let mut inner = self.inner.lock().await;
        let (_, mut record) = reload(&inner, &job_id).await?;
        if !confirm {
            record.failure = Some(org::code_name(ErrorCode::Cancelled));
            record.failure_message = Some(org::MSG_NO_DELETE.to_owned());
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        let profile_id = Id::new(&record.profile_id)?;
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if profile.view.connection != BridgeConnection::Live
            || profile.session.is_none()
            || profile.outbound.is_none()
        {
            record.failure = Some(org::code_name(ErrorCode::ReadOnly));
            record.failure_message = Some(org::MSG_OFFLINE.to_owned());
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        if record.phase == "applying" || profile.busy || profile.writes_blocked {
            return Err(ErrorCode::Conflict);
        }
        let Some(operation_id) = record.operation_id.clone() else {
            record.failure_message = Some("没有可删除的空文件夹。".to_owned());
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        };
        let operation = inner.storage()?.operation(Id::new(&operation_id)?).await?;
        let ids = created_folders(&operation);
        let nodes = profile.nodes.clone();
        let session = profile.session.clone().ok_or(ErrorCode::ReadOnly)?;
        let sender = profile.outbound.clone().ok_or(ErrorCode::ReadOnly)?;
        let epoch = profile.identity.source_epoch;
        let revision = profile.view.revision;
        let holds_finished = profile.batch_hold.as_ref().map(|id| id.as_str())
            == Some(operation_id.as_str())
            && operation.state == OperationState::Applied;
        if holds_finished && let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
            profile.batch_hold = None;
        }
        let planned = match editing::plan_empty_cleanup(&nodes, &ids, true) {
            Ok(plan) => plan,
            Err(error) => {
                record.failure = Some(org::code_name(error));
                record.failure_message = Some(org::MSG_NO_DELETE.to_owned());
                store(&inner, &job_id, &record).await?;
                return present(&inner, &job_id, &record).await;
            }
        };
        if planned.steps.is_empty() {
            record.failure = None;
            record.failure_message = Some("没有可删除的空文件夹。".to_owned());
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        if planned.requires_second_confirm && !second_confirm {
            record.failure = Some(org::code_name(ErrorCode::Cancelled));
            record.failure_message = Some("删除超过 20 个空文件夹需要再次确认。".to_owned());
            store(&inner, &job_id, &record).await?;
            return present(&inner, &job_id, &record).await;
        }
        let operation = editing::operation_id()?;
        edit_commit(
            self,
            &mut inner,
            BatchCommit {
                profile_id: &profile_id,
                epoch,
                revision,
                nodes: &nodes,
                session: &session,
                sender,
                plan: planned,
                send_limit: None,
                operation,
            },
        )
        .await?;
        record.failure = None;
        record.failure_message = None;
        store(&inner, &job_id, &record).await?;
        present(&inner, &job_id, &record).await
    }
}

pub(super) async fn on_receipt(
    bridge: &Bridge,
    inner: &mut Inner,
    profile_id: &Id,
    operation_id: &Id,
) -> Result<()> {
    let Some(job) = inner
        .storage()?
        .organization_job_by_operation(operation_id.as_str().to_owned())
        .await?
    else {
        return Ok(());
    };
    let mut record: Record =
        serde_json::from_str(&job.proposal).map_err(|_| ErrorCode::StorageError)?;
    if record.phase != "applying" {
        let operation = inner.storage()?.operation(operation_id.clone()).await?;
        if !in_flight(&record, &facts(&operation)) {
            release_hold(inner, profile_id, operation_id);
        }
        return Ok(());
    }
    let operation = inner.storage()?.operation(operation_id.clone()).await?;
    if operation.state != OperationState::Applying {
        record.phase = match operation.state {
            OperationState::Applied => "applied",
            OperationState::Failed => "failed",
            _ => "partial",
        }
        .to_owned();
        release_hold(inner, profile_id, operation_id);
        store(inner, &job.id, &record).await?;
        let _ = bridge;
        return Ok(());
    }
    let facts = facts(&operation);
    let dispatched: HashSet<&str> = record.dispatched.iter().map(String::as_str).collect();
    let Some(next) = org::next_unsent(&facts, &dispatched) else {
        if facts
            .iter()
            .all(|step| step.receipt.as_deref() == Some("applied"))
        {
            record.phase = "applied".to_owned();
            release_hold(inner, profile_id, operation_id);
            store(inner, &job.id, &record).await?;
        }
        return Ok(());
    };
    let profile = inner
        .profiles
        .get(profile_id.as_str())
        .ok_or(ErrorCode::WrongProfile)?;
    if profile.view.connection != BridgeConnection::Live {
        return Ok(());
    }
    let Some(session) = profile.session.clone() else {
        return Ok(());
    };
    let Some(sender) = profile.outbound.clone() else {
        return Ok(());
    };
    let epoch = profile.identity.source_epoch;
    let nodes = profile.nodes.clone();
    let request_id = next.request_id.clone();
    let stored = operation
        .steps
        .iter()
        .find(|step| step.request_id.as_str() == request_id)
        .ok_or(ErrorCode::InvalidMessage)?;
    let step = substitute(stored, &operation.steps, &nodes);
    record.dispatched.push(request_id);
    store(inner, &job.id, &record).await?;
    let message = super::edit::one_step(
        profile_id,
        &session,
        operation_id,
        epoch,
        Counter::new(record.source_revision)?,
        &step,
    )?;
    if sender.send(message).is_err() {
        release_hold(inner, profile_id, operation_id);
    }
    Ok(())
}

fn substitute(
    stored: &StepRecord,
    steps: &[StepRecord],
    nodes: &[markbridge_protocol::BookmarkNode],
) -> markbridge_protocol::OperationStep {
    let mut step = markbridge_protocol::OperationStep {
        expected_subtree: None,
        request_id: stored.request_id.clone(),
        target: stored.target.clone(),
        expected_before: stored.expected_before.clone(),
        expected_child_ids: stored.expected_child_ids.clone(),
        payload: stored.payload.clone(),
    };
    // Title and parent stay at plan time. Only the sibling index moves when an earlier applied
    // step inserted or removed a child of the same parent. An external edit still mismatches.
    if let Some(before) = &mut step.expected_before
        && let Some(position) = shifted_position(before, steps)
        && let Ok(position) = markbridge_protocol::Position::new(position)
    {
        before.position = position;
    }
    let parent = match &step.payload {
        Mutation::Create { parent_id, .. } | Mutation::Move { parent_id, .. } => {
            Some(parent_id.clone())
        }
        _ => None,
    };
    let Some(parent) = parent else { return step };
    if nodes.iter().any(|node| node.chrome_id == parent) {
        return step;
    }
    let Some(mapped) = steps
        .iter()
        .find(|item| item.request_id == parent)
        .and_then(|item| item.receipt.as_ref())
        .and_then(|receipt| receipt.after.as_ref())
        .map(|after| after.chrome_id.clone())
    else {
        return step;
    };
    match &mut step.payload {
        Mutation::Create { parent_id, .. } | Mutation::Move { parent_id, .. } => {
            *parent_id = mapped
        }
        _ => {}
    }
    step
}

fn shifted_position(
    before: &markbridge_protocol::BookmarkNode,
    steps: &[StepRecord],
) -> Option<u64> {
    let parent = before.parent_id.clone()?;
    let original = before.position.get() as i64;
    let mut position = original;
    for prior in steps {
        let Some(receipt) = &prior.receipt else {
            continue;
        };
        if receipt.state != OperationState::Applied {
            continue;
        }
        match &prior.payload {
            Mutation::Create { position: at, .. } => {
                let created_parent = receipt
                    .after
                    .as_ref()
                    .and_then(|node| node.parent_id.clone());
                if created_parent.as_ref() == Some(&parent) && (at.get() as i64) <= original {
                    position += 1;
                }
            }
            Mutation::Move { .. } | Mutation::Delete {} => {
                let Some(source) = &prior.expected_before else {
                    continue;
                };
                if source.parent_id.as_ref() == Some(&parent)
                    && (source.position.get() as i64) < original
                    && source.chrome_id != before.chrome_id
                {
                    position -= 1;
                }
            }
            _ => {}
        }
    }
    u64::try_from(position).ok()
}

struct BatchCommit<'a> {
    profile_id: &'a Id,
    epoch: SourceEpoch,
    revision: Counter,
    nodes: &'a [markbridge_protocol::BookmarkNode],
    session: &'a Id,
    sender: mpsc::UnboundedSender<markbridge_protocol::WireMessage>,
    plan: editing::Plan,
    send_limit: Option<usize>,
    operation: Id,
}

async fn edit_commit(
    bridge: &Bridge,
    inner: &mut Inner,
    commit: BatchCommit<'_>,
) -> Result<markbridge_protocol::ApplyResult> {
    super::edit::commit_planned(
        bridge,
        inner,
        super::edit::PlannedCommit {
            batch: None,
            profile_id: commit.profile_id,
            epoch: commit.epoch,
            revision: commit.revision,
            nodes: commit.nodes,
            session: commit.session,
            sender: commit.sender,
            plan: commit.plan,
            encodings: Vec::new(),
            send_limit: commit.send_limit,
            operation_id: Some(commit.operation),
        },
    )
    .await
}

fn build_plan(
    nodes: &[markbridge_protocol::BookmarkNode],
    anchor: &Id,
    folders: &[FolderRow],
    moves: &[&AssignRow],
) -> Result<editing::Plan> {
    let folders = folders
        .iter()
        .map(|folder| {
            Ok(ReclassFolder {
                local_id: Id::new(&folder.folder_id)?,
                parent_local: folder
                    .parent_folder_id
                    .as_deref()
                    .map(Id::new)
                    .transpose()?,
                name: folder.name.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let moves = moves
        .iter()
        .map(|row| {
            Ok(ReclassMove {
                chrome_id: Id::new(&row.chrome_id)?,
                folder_local: Id::new(&row.target_folder_id)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    editing::plan_reclassify(nodes, anchor, &folders, &moves)
}

fn created_folders(operation: &OperationRecord) -> Vec<Id> {
    operation
        .steps
        .iter()
        .filter_map(|step| {
            let Mutation::Create { url: None, .. } = &step.payload else {
                return None;
            };
            let receipt = step.receipt.as_ref()?;
            if receipt.state != OperationState::Applied {
                return None;
            }
            let after = receipt.after.as_ref()?;
            if after.kind != NodeKind::Folder {
                return None;
            }
            Some(after.chrome_id.clone())
        })
        .collect()
}

fn release_hold(inner: &mut Inner, profile_id: &Id, operation_id: &Id) {
    if let Some(profile) = inner.profiles.get_mut(profile_id.as_str())
        && profile.batch_hold.as_ref() == Some(operation_id)
    {
        profile.batch_hold = None;
        profile.busy = false;
    }
}

fn in_flight(record: &Record, facts: &[StepFact]) -> bool {
    record.dispatched.iter().any(|id| {
        facts
            .iter()
            .find(|step| step.request_id == *id)
            .is_none_or(|step| step.receipt.is_none())
    })
}

fn facts(operation: &OperationRecord) -> Vec<StepFact> {
    operation
        .steps
        .iter()
        .map(|step| StepFact {
            request_id: step.request_id.as_str().to_owned(),
            receipt: step.receipt.as_ref().map(|receipt| {
                match receipt.state {
                    OperationState::Applied => "applied",
                    OperationState::Failed => "failed",
                    _ => "uncertain",
                }
                .to_owned()
            }),
        })
        .collect()
}

fn bookmark_ids(rows: &[crate::storage::CachedBookmark]) -> HashMap<String, Id> {
    rows.iter()
        .filter(|row| row.deleted_at.is_none())
        .map(|row| {
            (
                row.node.chrome_id.as_str().to_owned(),
                row.bookmark_id.clone(),
            )
        })
        .collect()
}

fn scope_rows(
    nodes: &[markbridge_protocol::BookmarkNode],
    selected: &[Id],
    bookmarks: &HashMap<String, Id>,
) -> Result<Vec<ScopeRow>> {
    let mut rows = Vec::new();
    for chrome in selected {
        let Some(node) = nodes.iter().find(|node| &node.chrome_id == chrome) else {
            continue;
        };
        if node.kind != NodeKind::Bookmark {
            continue;
        }
        let parent = node.parent_id.clone().ok_or(ErrorCode::InvalidTree)?;
        let bookmark = bookmarks
            .get(chrome.as_str())
            .ok_or(ErrorCode::InvalidTree)?;
        rows.push(ScopeRow {
            chrome_id: chrome.as_str().to_owned(),
            bookmark_id: bookmark.as_str().to_owned(),
            parent_id: parent.as_str().to_owned(),
            position: node.position.get(),
            title: node.title.as_str().to_owned(),
            url: node.url.as_ref().map(|url| url.as_str().to_owned()),
        });
    }
    if rows.is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    if rows.len() > org::SCOPE_LIMIT {
        return Err(ErrorCode::LimitExceeded);
    }
    Ok(org::sorted_scope(rows))
}

fn same_basis(inner: &Inner, record: &Record) -> Result<bool> {
    let profile = inner
        .profiles
        .get(&record.profile_id)
        .ok_or(ErrorCode::WrongProfile)?;
    if profile.identity.source_epoch.get() != record.source_epoch
        || profile.view.revision.get() != record.source_revision
    {
        return Ok(false);
    }
    let cached_nodes = &profile.nodes;
    let mut rows = Vec::new();
    for old in &record.scope {
        let Some(node) = cached_nodes
            .iter()
            .find(|node| node.chrome_id.as_str() == old.chrome_id)
        else {
            return Ok(false);
        };
        let Some(parent) = node.parent_id.as_ref() else {
            return Ok(false);
        };
        rows.push(ScopeRow {
            chrome_id: old.chrome_id.clone(),
            bookmark_id: old.bookmark_id.clone(),
            parent_id: parent.as_str().to_owned(),
            position: node.position.get(),
            title: node.title.as_str().to_owned(),
            url: node.url.as_ref().map(|url| url.as_str().to_owned()),
        });
    }
    Ok(org::input_fingerprint(
        &record.profile_id,
        record.source_epoch,
        record.source_revision,
        &rows,
    ) == record.fingerprint)
}

fn current_revision(
    states: &tokio::sync::watch::Sender<markbridge_protocol::BridgeState>,
    profile: &str,
) -> Option<u64> {
    states
        .borrow()
        .profiles
        .iter()
        .find(|item| item.profile_id.as_str() == profile)
        .map(|item| item.revision.get())
}

async fn reload(inner: &Inner, job_id: &Id) -> Result<(Id, Record)> {
    let job = inner
        .storage()?
        .organization_job(job_id.clone())
        .await?
        .ok_or(ErrorCode::InvalidMessage)?;
    let record = serde_json::from_str(&job.proposal).map_err(|_| ErrorCode::StorageError)?;
    Ok((job.id, record))
}

async fn save_new(storage: &crate::storage::Storage, id: &Id, record: &Record) -> Result<()> {
    let config = storage.ai_config().await?;
    storage
        .insert_organization_job(
            job_row(id, record)?,
            config.model.unwrap_or_else(|| "none".to_owned()),
            config.endpoint.unwrap_or_else(|| "none".to_owned()),
        )
        .await
}

async fn store(inner: &Inner, id: &Id, record: &Record) -> Result<()> {
    inner
        .storage()?
        .update_organization_job(job_row(id, record)?)
        .await
}

fn job_row(id: &Id, record: &Record) -> Result<OrganizationJob> {
    Ok(OrganizationJob {
        id: id.clone(),
        profile_id: Id::new(&record.profile_id)?,
        fingerprint: record.fingerprint.clone(),
        state: record.phase.clone(),
        proposal: serde_json::to_string(record).map_err(|_| ErrorCode::StorageError)?,
        error_code: record.failure.clone(),
        operation_id: record.operation_id.clone(),
    })
}

async fn present(inner: &Inner, job_id: &Id, record: &Record) -> Result<OrganizationPlan> {
    let (facts, state) = if let Some(operation_id) = &record.operation_id {
        match inner.storage()?.operation(Id::new(operation_id)?).await {
            Ok(operation) => (facts(&operation), Some(state_name(&operation.state))),
            Err(_) => (Vec::new(), None),
        }
    } else {
        (Vec::new(), None)
    };
    org::to_plan_with_job(record, job_id.as_str(), &facts, state)
}

fn state_name(state: &OperationState) -> &'static str {
    match state {
        OperationState::Applied => "applied",
        OperationState::Uncertain => "uncertain",
        OperationState::Partial => "partial",
        OperationState::RollbackConflict => "rollback_conflict",
        OperationState::Failed => "failed",
        OperationState::Applying => "applying",
        OperationState::Planned => "planned",
        OperationState::RollingBack => "rolling_back",
        OperationState::RolledBack => "rolled_back",
    }
}
