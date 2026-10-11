//! Trusted desktop IPC. Credentials are present only in an explicit pairing offer.
use crate::{
    BookmarkNode, Counter, DisplayName, ErrorCode, Id, OperationState, Position, RequiredNullable,
    Title, Url, Version,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BridgeConnection {
    Unpaired,
    Connecting,
    Reconciling,
    Live,
    CachedReadOnly,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeProfile {
    pub profile_id: Id,
    pub instance_id: Id,
    pub display_name: DisplayName,
    pub connection: BridgeConnection,
    pub node_count: Counter,
    pub revision: Counter,
    pub last_synced_at: RequiredNullable<Counter>,
    pub error_code: RequiredNullable<ErrorCode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingPairing {
    pub profile_id: Id,
    pub display_name: DisplayName,
    pub instance_id: RequiredNullable<Id>,
    pub origin: RequiredNullable<String>,
    pub expires_at: Counter,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeState {
    pub protocol_version: Version,
    pub revision: Counter,
    pub port: RequiredNullable<u16>,
    pub error_code: RequiredNullable<ErrorCode>,
    pub profiles: Vec<BridgeProfile>,
    pub pending: Vec<PendingPairing>,
    pub mirrors: Vec<MirrorSourceState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MirrorFileStatus {
    Current,
    Stale,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MirrorAssociation {
    Independent,
    Confirmed,
}

fn write_denied_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::Schema::try_from(serde_json::json!({"type":"boolean","const":false}))
        .expect("boolean const schema")
}

fn deny_browser_write<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<bool, D::Error> {
    if bool::deserialize(deserializer)? {
        return Err(serde::de::Error::custom(ErrorCode::ReadOnly));
    }
    Ok(false)
}

/// File-mirror status. `can_write_browser` is always false: a file source is not a write path.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MirrorSourceState {
    pub mirror_source_id: Id,
    pub display_name: DisplayName,
    pub association: MirrorAssociation,
    pub paired_profile_id: RequiredNullable<Id>,
    pub file_status: MirrorFileStatus,
    pub watching: bool,
    pub node_count: Counter,
    pub revision: Counter,
    pub last_synced_at: RequiredNullable<Counter>,
    pub error_code: RequiredNullable<ErrorCode>,
    #[serde(deserialize_with = "deny_browser_write")]
    #[schemars(schema_with = "write_denied_schema")]
    pub can_write_browser: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChromeProfileChoice {
    pub directory_key: String,
    pub display_name: DisplayName,
    pub bookmarks_present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChromeProfileList {
    pub profiles: Vec<ChromeProfileChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MirrorTree {
    pub mirror_source_id: Id,
    pub display_name: DisplayName,
    pub file_status: MirrorFileStatus,
    pub association: MirrorAssociation,
    pub revision: Counter,
    pub last_synced_at: RequiredNullable<Counter>,
    pub error_code: RequiredNullable<ErrorCode>,
    #[serde(deserialize_with = "deny_browser_write")]
    #[schemars(schema_with = "write_denied_schema")]
    pub can_write_browser: bool,
    #[schemars(length(max = 100000))]
    pub nodes: Vec<crate::BookmarkNode>,
}

/// Flat nodes from a cache `tree` read. `chromeId` and `parentId` are unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryNodes {
    #[schemars(length(max = 100000))]
    pub nodes: Vec<BookmarkNode>,
}

/// One page from a cache `list` read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryPage {
    #[schemars(length(max = 100000))]
    pub items: Vec<BookmarkNode>,
    pub total: Counter,
}

/// Hits from a cache `search` read. Matching is the core substring rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibrarySearch {
    #[schemars(length(max = 100000))]
    pub items: Vec<BookmarkNode>,
}

/// One node from a cache `get` read, with ancestor titles nearest-root first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryDetail {
    pub node: BookmarkNode,
    #[schemars(length(max = 256))]
    pub ancestors: Vec<Title>,
}

/// Folder and bookmark totals from a cache `count` read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryCount {
    pub folders: Counter,
    pub bookmarks: Counter,
}

/// A draft is not write authorization. `apply_edit` is the confirmed command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EditAction {
    Create {
        parent_id: Id,
        position: Position,
        title: Title,
        url: Option<Url>,
    },
    Update {
        chrome_id: Id,
        title: Option<Title>,
        url: Option<Url>,
    },
    Move {
        chrome_id: Id,
        parent_id: Id,
        position: Position,
    },
    Reorder {
        parent_id: Id,
        #[schemars(length(max = 100000))]
        child_ids: Vec<Id>,
    },
    Delete {
        chrome_id: Id,
    },
    Undo {
        operation_id: Id,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditField {
    Title,
    Url,
    Parent,
    Position,
    Order,
    Existence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditFieldChange {
    pub field: EditField,
    pub before: RequiredNullable<String>,
    pub after: RequiredNullable<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditPreview {
    pub profile_id: Id,
    pub expected_revision: Counter,
    pub affected: Counter,
    pub requires_second_confirm: bool,
    pub writable: bool,
    pub error_code: RequiredNullable<ErrorCode>,
    #[schemars(length(max = 50))]
    pub changes: Vec<EditFieldChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationConflict {
    pub request_id: Id,
    pub chrome_id: RequiredNullable<Id>,
    pub field: EditField,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyResult {
    pub operation_id: Id,
    pub state: OperationState,
    pub error_code: RequiredNullable<ErrorCode>,
    #[schemars(length(max = 50))]
    pub conflicts: Vec<OperationConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationSummary {
    pub operation_id: Id,
    pub state: OperationState,
    pub affected: Counter,
    pub error_code: RequiredNullable<ErrorCode>,
    #[schemars(length(max = 50))]
    pub conflicts: Vec<OperationConflict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationList {
    #[schemars(length(max = 200))]
    pub operations: Vec<OperationSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditDocumentKind {
    Html,
    Sidecar,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditDocument {
    pub kind: EditDocumentKind,
    #[schemars(length(max = 8000000))]
    pub body: String,
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingOffer {
    pub profile_id: Id,
    pub pairing_code: String,
    pub expires_at: Counter,
}
