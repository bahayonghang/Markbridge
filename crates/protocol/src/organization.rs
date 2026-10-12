//! Batch organization DTOs. Model output is data. These types do not authorize a write.
use crate::{Counter, ErrorCode, Id, RequiredNullable, SourceEpoch};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrganizationPhase {
    Folders,
    Reviewed,
    Assigning,
    Ready,
    Invalid,
    Applying,
    Paused,
    Partial,
    Applied,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationFolder {
    pub folder_id: Id,
    #[schemars(schema_with = "name_schema")]
    pub name: String,
    pub parent_folder_id: RequiredNullable<Id>,
    pub reviewed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationScopeItem {
    pub chrome_id: Id,
    pub bookmark_id: Id,
    pub source_parent_id: Id,
    #[schemars(schema_with = "label_schema")]
    pub source_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationAssignment {
    pub chrome_id: Id,
    pub bookmark_id: Id,
    pub source_parent_id: Id,
    #[schemars(schema_with = "label_schema")]
    pub source_label: String,
    pub target_folder_id: Id,
    pub cited_input_id: Id,
    pub cited_folder_id: Id,
    pub rejected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationRange {
    pub start: Counter,
    pub end: Counter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrganizationPlan {
    pub job_id: Id,
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub source_revision: Counter,
    pub input_fingerprint: Id,
    pub plan_hash: Id,
    pub phase: OrganizationPhase,
    pub sampled: Counter,
    pub scope_count: Counter,
    pub anchor_id: Id,
    #[schemars(length(max = 12))]
    pub folders: Vec<OrganizationFolder>,
    #[schemars(length(max = 900))]
    pub scope: Vec<OrganizationScopeItem>,
    #[schemars(length(max = 900))]
    pub assignments: Vec<OrganizationAssignment>,
    pub impact: Counter,
    pub failure: RequiredNullable<ErrorCode>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
    pub operation_id: RequiredNullable<Id>,
    pub backup_verified: bool,
    #[schemars(length(max = 1000))]
    pub applied: Vec<OrganizationRange>,
    #[schemars(length(max = 1000))]
    pub pending: Vec<OrganizationRange>,
    #[schemars(length(max = 1000))]
    pub uncertain: Vec<OrganizationRange>,
    #[schemars(length(max = 1000))]
    pub failed: Vec<OrganizationRange>,
}

fn text_schema(max: usize, nullable: bool) -> schemars::Schema {
    let kind = if nullable {
        serde_json::json!(["string", "null"])
    } else {
        serde_json::json!("string")
    };
    schemars::Schema::try_from(serde_json::json!({
        "type": kind,
        "maxLength": max
    }))
    .expect("text schema")
}

fn name_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::Schema::try_from(
        serde_json::json!({"type": "string", "minLength": 1, "maxLength": 60}),
    )
    .expect("folder name")
}

fn label_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(80, false)
}

fn message_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(80, true)
}
