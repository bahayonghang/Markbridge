use crate::{
    Counter, EditFieldChange, ErrorCode, Id, OperationState, RequiredNullable, SourceEpoch, Title,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BatchEditAction {
    Move { parent_id: Id },
    Delete {},
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchEditItem {
    pub chrome_id: Id,
    pub title: Title,
    pub path: String,
    pub affected: Counter,
    #[schemars(length(max = 50))]
    pub changes: Vec<EditFieldChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchEditPreview {
    pub plan_id: Id,
    pub plan_hash: Id,
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub expected_revision: Counter,
    pub selected_count: Counter,
    pub affected: Counter,
    pub requires_second_confirm: bool,
    pub destination_path: RequiredNullable<String>,
    pub writable: bool,
    #[schemars(length(min = 1, max = 1000))]
    pub items: Vec<BatchEditItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BatchItemState {
    Applied,
    NotExecuted,
    InFlight,
    Conflict,
    Uncertain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchItemResult {
    pub chrome_id: Id,
    pub title: Title,
    pub state: BatchItemState,
    pub error_code: RequiredNullable<ErrorCode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchEditStatus {
    pub operation_id: Id,
    pub profile_id: Id,
    pub state: OperationState,
    pub stopped: bool,
    #[schemars(length(min = 1, max = 1000))]
    pub items: Vec<BatchItemResult>,
    pub error_code: RequiredNullable<ErrorCode>,
}
