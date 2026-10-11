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
}

#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingOffer {
    pub profile_id: Id,
    pub pairing_code: String,
    pub expires_at: Counter,
}
