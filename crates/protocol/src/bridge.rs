//! Trusted desktop IPC. Credentials are present only in an explicit pairing offer.
use crate::{Counter, DisplayName, ErrorCode, Id, RequiredNullable, Version};
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

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingOffer {
    pub profile_id: Id,
    pub pairing_code: String,
    pub expires_at: Counter,
}
