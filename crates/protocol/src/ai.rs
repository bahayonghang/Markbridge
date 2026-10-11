//! Single-bookmark AI suggestion DTOs. Model output is data, not an instruction.
use crate::{ApplyResult, Counter, Id, RequiredNullable};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderKind {
    Ollama,
    Compatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AiJobState {
    Ready,
    Failed,
    Cancelled,
    Applied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiFailure {
    Disabled,
    EndpointDenied,
    MissingModel,
    InvalidOutput,
    TimedOut,
    RateLimited,
    Cancelled,
    StaleTarget,
    Unreachable,
}

impl AiFailure {
    pub fn message(self, retry_after: Option<u64>) -> String {
        match self {
            Self::Disabled => "AI 未启用。".to_owned(),
            Self::EndpointDenied => {
                "端点不被允许。本地只能使用 loopback HTTP，远程必须使用 HTTPS。".to_owned()
            }
            Self::MissingModel => "缺少本地模型或端点。".to_owned(),
            Self::InvalidOutput => "模型输出不符合建议格式。没有写入书签。".to_owned(),
            Self::TimedOut => "模型请求超过 15 秒。没有写入书签。".to_owned(),
            Self::RateLimited => {
                match retry_after.filter(|seconds| (1..=3_600).contains(seconds)) {
                    Some(seconds) => format!("请求被限流。建议等待 {seconds} 秒。没有写入书签。"),
                    None => "请求被限流。没有写入书签。".to_owned(),
                }
            }
            Self::Cancelled => "已取消。结果不会写入书签。".to_owned(),
            Self::StaleTarget => "资料或网址已变化。这条建议不能应用到新目标。".to_owned(),
            Self::Unreachable => "无法连接模型端点。没有写入书签。".to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSettings {
    pub enabled: bool,
    pub provider: RequiredNullable<AiProviderKind>,
    #[schemars(schema_with = "endpoint_schema")]
    pub endpoint_label: RequiredNullable<String>,
    #[schemars(schema_with = "model_schema")]
    pub model: RequiredNullable<String>,
    pub credential_configured: bool,
    pub schema_supported: RequiredNullable<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiConnection {
    pub ok: bool,
    pub schema_supported: RequiredNullable<bool>,
    pub failure: RequiredNullable<AiFailure>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
    pub settings: AiSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiScope {
    pub includes_title: bool,
    pub includes_url: bool,
    pub includes_cached_text: bool,
    pub excerpt_chars: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiSuggestion {
    pub job_id: Id,
    pub profile_id: Id,
    pub bookmark_id: Id,
    pub chrome_id: Id,
    pub input_fingerprint: Id,
    pub endpoint_label: RequiredNullable<String>,
    pub model: RequiredNullable<String>,
    pub scope: AiScope,
    pub state: AiJobState,
    #[schemars(schema_with = "nullable_title_schema")]
    pub title: RequiredNullable<String>,
    #[schemars(length(max = 3))]
    pub tags: Vec<String>,
    #[schemars(schema_with = "summary_schema")]
    pub summary: RequiredNullable<String>,
    #[schemars(schema_with = "folder_schema")]
    pub suggested_folder: RequiredNullable<String>,
    #[schemars(schema_with = "evidence_schema")]
    pub evidence: RequiredNullable<String>,
    pub source_time: RequiredNullable<Counter>,
    pub failure: RequiredNullable<AiFailure>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
}

/// A confirmed draft. Folder text is not a move. The server recomputes the fingerprint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiDraft {
    pub job_id: Id,
    pub profile_id: Id,
    pub chrome_id: Id,
    pub input_fingerprint: Id,
    #[schemars(schema_with = "required_title_schema")]
    pub title: String,
    #[schemars(length(max = 3))]
    pub tags: Vec<String>,
    #[schemars(schema_with = "summary_schema")]
    pub summary: RequiredNullable<String>,
    pub apply_title: bool,
    pub apply_tags: bool,
    pub apply_summary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiApplyResult {
    pub job_id: Id,
    pub browser: RequiredNullable<ApplyResult>,
    pub tags_applied: bool,
    pub summary_applied: bool,
    pub failure: RequiredNullable<AiFailure>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
}

fn nullable_text(max: usize) -> schemars::Schema {
    schemars::Schema::try_from(serde_json::json!({
        "description": "A required JSON field whose value can be null. Unlike Option, absence is rejected.",
        "type": ["string", "null"],
        "maxLength": max
    }))
    .expect("nullable text schema")
}

fn endpoint_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(512)
}
fn model_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(128)
}
fn message_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(80)
}
fn nullable_title_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::Schema::try_from(serde_json::json!({"type": ["string", "null"], "maxLength": 60}))
        .expect("title")
}
fn required_title_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::Schema::try_from(
        serde_json::json!({"type": "string", "minLength": 0, "maxLength": 60}),
    )
    .expect("title")
}
fn summary_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(1000)
}
fn folder_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(60)
}
fn evidence_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(200)
}
