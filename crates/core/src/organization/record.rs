//! Stored organization job. The plan hash and the input fingerprint are not write authorization.
use std::collections::{BTreeSet, HashSet};

use markbridge_protocol::{
    Counter, ErrorCode, Id, OrganizationAssignment, OrganizationFolder, OrganizationPhase,
    OrganizationPlan, OrganizationRange, OrganizationScopeItem, RequiredNullable, SourceEpoch,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::check::{accept_folders, validate_coverage};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScopeRow {
    pub chrome_id: String,
    pub bookmark_id: String,
    pub parent_id: String,
    pub position: u64,
    pub title: String,
    pub url: Option<String>,
}

impl ScopeRow {
    pub(crate) fn label(&self) -> String {
        self.title.chars().take(80).collect()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderRow {
    pub folder_id: String,
    pub name: String,
    pub parent_folder_id: Option<String>,
    pub reviewed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignRow {
    pub chrome_id: String,
    pub bookmark_id: String,
    pub source_parent_id: String,
    pub source_label: String,
    pub target_folder_id: String,
    pub cited_input_id: String,
    pub cited_folder_id: String,
    pub rejected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Record {
    pub profile_id: String,
    pub source_epoch: u64,
    pub source_revision: u64,
    pub fingerprint: String,
    pub anchor_id: String,
    pub scope: Vec<ScopeRow>,
    pub sampled: u64,
    pub folders: Vec<FolderRow>,
    pub assignments: Vec<AssignRow>,
    pub phase: String,
    pub plan_hash: String,
    pub operation_id: Option<String>,
    pub dispatched: Vec<String>,
    pub backup_verified: bool,
    pub failure: Option<String>,
    pub failure_message: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct StepFact {
    pub request_id: String,
    pub receipt: Option<String>,
}

pub(crate) fn input_fingerprint(
    profile: &str,
    epoch: u64,
    revision: u64,
    rows: &[ScopeRow],
) -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Item<'a> {
        chrome_id: &'a str,
        bookmark_id: &'a str,
        parent_id: &'a str,
        position: u64,
        title: &'a str,
        url: Option<&'a str>,
    }
    let mut ordered = rows.to_vec();
    ordered.sort_by(|left, right| left.chrome_id.cmp(&right.chrome_id));
    let items: Vec<Item<'_>> = ordered
        .iter()
        .map(|row| Item {
            chrome_id: &row.chrome_id,
            bookmark_id: &row.bookmark_id,
            parent_id: &row.parent_id,
            position: row.position,
            title: &row.title,
            url: row.url.as_deref(),
        })
        .collect();
    digest(&serde_json::json!({
        "profileId": profile,
        "sourceEpoch": epoch,
        "sourceRevision": revision,
        "items": items,
    }))
}

pub(crate) fn rehash(record: &mut Record) {
    record.plan_hash = plan_hash(record);
}

pub(crate) fn plan_hash(record: &Record) -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Folder<'a> {
        folder_id: &'a str,
        name: &'a str,
        parent_folder_id: Option<&'a str>,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Move<'a> {
        chrome_id: &'a str,
        folder_id: &'a str,
    }
    let mut folders: Vec<&FolderRow> = record.folders.iter().collect();
    folders.sort_by(|left, right| left.folder_id.cmp(&right.folder_id));
    let mut accepted: Vec<&AssignRow> = record
        .assignments
        .iter()
        .filter(|row| !row.rejected)
        .collect();
    accepted.sort_by(|left, right| left.chrome_id.cmp(&right.chrome_id));
    digest(&serde_json::json!({
        "profileId": record.profile_id,
        "sourceEpoch": record.source_epoch,
        "sourceRevision": record.source_revision,
        "fingerprint": record.fingerprint,
        "anchorId": record.anchor_id,
        "folders": folders.iter().map(|folder| Folder {
            folder_id: &folder.folder_id,
            name: &folder.name,
            parent_folder_id: folder.parent_folder_id.as_deref(),
        }).collect::<Vec<_>>(),
        "accepted": accepted.iter().map(|row| Move {
            chrome_id: &row.chrome_id,
            folder_id: &row.target_folder_id,
        }).collect::<Vec<_>>(),
    }))
}

pub(crate) fn apply_gate(
    phase: &str,
    hash_ok: bool,
    fresh: bool,
    live: bool,
) -> Result<(), ErrorCode> {
    if !live {
        return Err(ErrorCode::ReadOnly);
    }
    if !fresh || !hash_ok {
        return Err(ErrorCode::StaleProposal);
    }
    if phase != "ready" {
        return Err(ErrorCode::Conflict);
    }
    Ok(())
}

pub(crate) fn needed_folders(folders: &[FolderRow], targets: &HashSet<String>) -> Vec<FolderRow> {
    let mut keep = targets.clone();
    let mut changed = true;
    while changed {
        changed = false;
        for folder in folders {
            if keep.contains(&folder.folder_id)
                && let Some(parent) = &folder.parent_folder_id
                && keep.insert(parent.clone())
            {
                changed = true;
            }
        }
    }
    folders
        .iter()
        .filter(|folder| keep.contains(&folder.folder_id))
        .cloned()
        .collect()
}

pub(crate) fn review_folders(
    record: &mut Record,
    folders: Vec<FolderRow>,
    reserved: &HashSet<String>,
) -> Result<(), ErrorCode> {
    accept_folders(&folders, reserved, true)?;
    record.folders = folders;
    record.assignments.clear();
    record.phase = "reviewed".to_owned();
    record.failure = None;
    record.failure_message = None;
    rehash(record);
    Ok(())
}

pub(crate) fn edit_assignment(
    record: &mut Record,
    chrome_id: &str,
    target: &str,
    rejected: bool,
) -> Result<(), ErrorCode> {
    if record.phase != "ready" {
        return Err(ErrorCode::Conflict);
    }
    let reviewed = record
        .folders
        .iter()
        .any(|folder| folder.reviewed && folder.folder_id == target);
    if !reviewed {
        return Err(ErrorCode::InvalidTree);
    }
    let row = record
        .assignments
        .iter_mut()
        .find(|row| row.chrome_id == chrome_id)
        .ok_or(ErrorCode::InvalidMessage)?;
    row.target_folder_id = target.to_owned();
    row.cited_folder_id = target.to_owned();
    row.rejected = rejected;
    validate_coverage(&record.scope, &record.folders, &record.assignments)?;
    rehash(record);
    Ok(())
}

pub(crate) fn next_unsent<'a>(
    steps: &'a [StepFact],
    dispatched: &HashSet<&str>,
) -> Option<&'a StepFact> {
    for step in steps {
        match step.receipt.as_deref() {
            Some("applied") => continue,
            Some(_) => return None,
            None if dispatched.contains(step.request_id.as_str()) => return None,
            None => return Some(step),
        }
    }
    None
}

pub(crate) fn to_plan(
    record: &Record,
    steps: &[StepFact],
    operation_state: Option<&str>,
) -> Result<OrganizationPlan, ErrorCode> {
    let dispatched: HashSet<&str> = record.dispatched.iter().map(String::as_str).collect();
    let mut applied = Vec::new();
    let mut pending = Vec::new();
    let mut uncertain = Vec::new();
    let mut failed = Vec::new();
    for (ordinal, step) in steps.iter().enumerate() {
        let class = match step.receipt.as_deref() {
            Some("applied") => &mut applied,
            Some("failed") => &mut failed,
            Some(_) => &mut uncertain,
            None if dispatched.contains(step.request_id.as_str()) => &mut uncertain,
            None => &mut pending,
        };
        class.push(ordinal as u64);
    }
    let mut phase = phase_of(&record.phase)?;
    if record.phase == "applying"
        && matches!(
            operation_state,
            Some("uncertain" | "partial" | "rollback_conflict")
        )
    {
        phase = OrganizationPhase::Partial;
    }
    let impact = impact_of(record);
    Ok(OrganizationPlan {
        job_id: Id::new(record_id(&record.plan_hash))?,
        profile_id: Id::new(&record.profile_id)?,
        source_epoch: SourceEpoch::new(record.source_epoch)?,
        source_revision: Counter::new(record.source_revision)?,
        input_fingerprint: Id::new(&record.fingerprint)?,
        plan_hash: Id::new(&record.plan_hash)?,
        phase,
        sampled: Counter::new(record.sampled)?,
        scope_count: Counter::new(record.scope.len() as u64)?,
        anchor_id: Id::new(&record.anchor_id)?,
        folders: record
            .folders
            .iter()
            .map(|folder| {
                Ok(OrganizationFolder {
                    folder_id: Id::new(&folder.folder_id)?,
                    name: folder.name.clone(),
                    parent_folder_id: RequiredNullable(
                        folder
                            .parent_folder_id
                            .as_deref()
                            .map(Id::new)
                            .transpose()?,
                    ),
                    reviewed: folder.reviewed,
                })
            })
            .collect::<Result<Vec<_>, ErrorCode>>()?,
        scope: record
            .scope
            .iter()
            .map(|row| {
                Ok(OrganizationScopeItem {
                    chrome_id: Id::new(&row.chrome_id)?,
                    bookmark_id: Id::new(&row.bookmark_id)?,
                    source_parent_id: Id::new(&row.parent_id)?,
                    source_label: row.label(),
                })
            })
            .collect::<Result<Vec<_>, ErrorCode>>()?,
        assignments: record
            .assignments
            .iter()
            .map(|row| {
                Ok(OrganizationAssignment {
                    chrome_id: Id::new(&row.chrome_id)?,
                    bookmark_id: Id::new(&row.bookmark_id)?,
                    source_parent_id: Id::new(&row.source_parent_id)?,
                    source_label: row.source_label.chars().take(80).collect(),
                    target_folder_id: Id::new(&row.target_folder_id)?,
                    cited_input_id: Id::new(&row.cited_input_id)?,
                    cited_folder_id: Id::new(&row.cited_folder_id)?,
                    rejected: row.rejected,
                })
            })
            .collect::<Result<Vec<_>, ErrorCode>>()?,
        impact: Counter::new(impact)?,
        failure: RequiredNullable(record.failure.as_deref().and_then(parse_code)),
        failure_message: RequiredNullable(record.failure_message.clone()),
        operation_id: RequiredNullable(record.operation_id.as_deref().map(Id::new).transpose()?),
        backup_verified: record.backup_verified,
        applied: ranges(&applied)?,
        pending: ranges(&pending)?,
        uncertain: ranges(&uncertain)?,
        failed: ranges(&failed)?,
    })
}

pub(crate) fn to_plan_with_job(
    record: &Record,
    job_id: &str,
    steps: &[StepFact],
    operation_state: Option<&str>,
) -> Result<OrganizationPlan, ErrorCode> {
    let mut plan = to_plan(record, steps, operation_state)?;
    plan.job_id = Id::new(job_id)?;
    Ok(plan)
}

fn record_id(hash: &str) -> String {
    hash.to_owned()
}

fn impact_of(record: &Record) -> u64 {
    let targets: HashSet<String> = record
        .assignments
        .iter()
        .filter(|row| !row.rejected)
        .map(|row| row.target_folder_id.clone())
        .collect();
    let creates = needed_folders(&record.folders, &targets).len() as u64;
    let moves = record
        .assignments
        .iter()
        .filter(|row| !row.rejected)
        .count() as u64;
    creates + moves
}

fn ranges(ordinals: &[u64]) -> Result<Vec<OrganizationRange>, ErrorCode> {
    let mut ordered = ordinals.to_vec();
    ordered.sort_unstable();
    ordered.dedup();
    let mut out = Vec::new();
    let mut cursor = ordered.iter().copied();
    let Some(mut start) = cursor.next() else {
        return Ok(out);
    };
    let mut end = start + 1;
    for ordinal in cursor {
        if ordinal == end {
            end += 1;
        } else {
            out.push(OrganizationRange {
                start: Counter::new(start)?,
                end: Counter::new(end)?,
            });
            start = ordinal;
            end = ordinal + 1;
        }
    }
    out.push(OrganizationRange {
        start: Counter::new(start)?,
        end: Counter::new(end)?,
    });
    Ok(out)
}

fn phase_of(value: &str) -> Result<OrganizationPhase, ErrorCode> {
    Ok(match value {
        "folders" => OrganizationPhase::Folders,
        "reviewed" => OrganizationPhase::Reviewed,
        "assigning" => OrganizationPhase::Assigning,
        "ready" => OrganizationPhase::Ready,
        "invalid" => OrganizationPhase::Invalid,
        "applying" => OrganizationPhase::Applying,
        "paused" => OrganizationPhase::Paused,
        "partial" => OrganizationPhase::Partial,
        "applied" => OrganizationPhase::Applied,
        "cancelled" => OrganizationPhase::Cancelled,
        "failed" => OrganizationPhase::Failed,
        _ => return Err(ErrorCode::StorageError),
    })
}

fn parse_code(value: &str) -> Option<ErrorCode> {
    serde_json::from_value(serde_json::Value::String(value.to_owned())).ok()
}

fn digest(value: &serde_json::Value) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn code_name(code: ErrorCode) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "STORAGE_ERROR".to_owned())
}

pub(crate) fn fail(record: &mut Record, phase: &str, code: ErrorCode, message: &str) {
    record.phase = phase.to_owned();
    record.failure = Some(code_name(code));
    record.failure_message = Some(clip_message(message));
}

pub(crate) fn clip_message(message: &str) -> String {
    message.chars().take(80).collect()
}

pub(crate) fn reserved_ids(rows: &[ScopeRow], anchor: &str) -> HashSet<String> {
    let mut ids: HashSet<String> = rows.iter().map(|row| row.chrome_id.clone()).collect();
    ids.insert(anchor.to_owned());
    ids
}

pub(crate) fn sorted_scope(mut rows: Vec<ScopeRow>) -> Vec<ScopeRow> {
    rows.sort_by(|left, right| left.chrome_id.cmp(&right.chrome_id));
    rows
}

#[allow(dead_code)]
pub(crate) fn dispatched_set(record: &Record) -> BTreeSet<String> {
    record.dispatched.iter().cloned().collect()
}
