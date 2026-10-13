//! Read-only history and Rust-owned file saving. No caller-controlled output path.
use crate::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HistoryKind {
    Create,
    Update,
    Move,
    Delete,
    Reorder,
    Mixed,
    Undo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryStep {
    pub request_id: Id,
    pub mutation: Mutation,
    pub before: RequiredNullable<BookmarkNode>,
    pub receipt: RequiredNullable<Receipt>,
    #[serde(default)]
    #[schemars(length(max = 100000))]
    pub deleted_descendants: Vec<BookmarkNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoredIdentity {
    pub old_chrome_id: Id,
    pub new_chrome_id: Id,
    pub bookmark_id: Id,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationDetail {
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub summary: OperationSummary,
    pub undo_of: RequiredNullable<Id>,
    #[schemars(length(max = 1000))]
    pub steps: Vec<HistoryStep>,
    #[schemars(length(max = 1000))]
    pub restored: Vec<RestoredIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoPreview {
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub operation_id: Id,
    pub expected_revision: Counter,
    pub writable: bool,
    pub affected: Counter,
    pub error_code: RequiredNullable<ErrorCode>,
    #[schemars(length(max = 1000))]
    pub steps: Vec<OperationStep>,
    #[schemars(length(max = 1000))]
    pub conflicts: Vec<OperationConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExportSource {
    Profile { id: Id },
    Mirror { id: Id },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportMetadata {
    pub source: ExportSource,
    pub display_name: DisplayName,
    pub format: EditDocumentKind,
    pub source_epoch: RequiredNullable<SourceEpoch>,
    pub revision: Counter,
    pub cached_at: RequiredNullable<Counter>,
    pub exported_at: Counter,
    pub node_count: Counter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExportSaveStatus {
    Saved,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportSaveResult {
    pub status: ExportSaveStatus,
    pub metadata: RequiredNullable<ExportMetadata>,
    pub error_code: RequiredNullable<ErrorCode>,
}
