//! Fixed diagnostic allowlist. No identity, content, path, log or credential fields.
use crate::{Counter, ErrorCode, ExportSaveStatus, RequiredNullable, Version};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticPlatform {
    Windows,
    Macos,
    Linux,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticArchitecture {
    X86_64,
    Aarch64,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticConnections {
    pub unpaired: Counter,
    pub connecting: Counter,
    pub reconciling: Counter,
    pub live: Counter,
    pub cached_read_only: Counter,
    pub error: Counter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticMirrors {
    pub current: Counter,
    pub stale: Counter,
    pub unavailable: Counter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticReport {
    pub format_version: Version,
    #[schemars(length(min = 1, max = 32))]
    pub app_version: String,
    pub protocol_version: Version,
    pub schema_version: Counter,
    pub platform: DiagnosticPlatform,
    pub architecture: DiagnosticArchitecture,
    pub bridge_listening: bool,
    pub bridge_error_code: RequiredNullable<ErrorCode>,
    pub connections: DiagnosticConnections,
    pub mirrors: DiagnosticMirrors,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticSaveResult {
    pub status: ExportSaveStatus,
    pub error_code: RequiredNullable<ErrorCode>,
}
