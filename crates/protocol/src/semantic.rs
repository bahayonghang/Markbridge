//! Optional local embedding search. No vectors or credentials cross this boundary.
use crate::{Counter, Id, RequiredNullable, SourceEpoch};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticConfig {
    pub enabled: bool,
    #[schemars(schema_with = "endpoint_schema")]
    pub endpoint: RequiredNullable<String>,
    #[schemars(schema_with = "model_schema")]
    pub model: RequiredNullable<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticSettings {
    pub enabled: bool,
    #[schemars(schema_with = "endpoint_schema")]
    pub endpoint_label: RequiredNullable<String>,
    #[schemars(schema_with = "model_schema")]
    pub model: RequiredNullable<String>,
    pub input_recipe_version: u8,
    pub max_input_chars: u16,
    pub max_input_bytes: u16,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SemanticPhase {
    Running,
    Paused,
    Ready,
    Failed,
    Stale,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SemanticFailure {
    Disabled,
    EndpointDenied,
    MissingModel,
    RemoteModel,
    DimensionMismatch,
    InvalidVector,
    ModelChanged,
    StaleIndex,
    Cancelled,
    TimedOut,
    Unreachable,
    InvalidResponse,
    LimitExceeded,
    StorageError,
}
impl SemanticFailure {
    pub fn message(self) -> String {
        match self {
            Self::Disabled => "语义检索未启用。",
            Self::EndpointDenied => "只允许本机 loopback Ollama 端点。",
            Self::MissingModel => "本机模型不存在或不支持 embedding。",
            Self::RemoteModel => "该模型使用远程服务，不能用于本地语义检索。",
            Self::DimensionMismatch => "模型向量维度变化，请重新建立索引。",
            Self::InvalidVector => "模型返回了无效向量。",
            Self::ModelChanged => "模型版本已变化，请重新建立索引。",
            Self::StaleIndex => "索引或资料已变化，请重新提交。",
            Self::Cancelled => "语义请求已取消。",
            Self::TimedOut => "本地模型请求超过 15 秒。",
            Self::Unreachable => "无法连接本地模型。",
            Self::InvalidResponse => "本地模型响应格式无效。",
            Self::LimitExceeded => "范围或输入超过允许上限。",
            Self::StorageError => "本地索引无法读写。",
        }
        .to_owned()
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticModelCheck {
    pub available: bool,
    #[schemars(schema_with = "model_schema")]
    pub model: RequiredNullable<String>,
    pub digest: RequiredNullable<Id>,
    #[schemars(schema_with = "dimension_schema")]
    pub dimension: RequiredNullable<u16>,
    pub failure: RequiredNullable<SemanticFailure>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticScope {
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub expected_revision: Counter,
    #[schemars(length(max = 10_000))]
    pub selected_chrome_ids: Vec<Id>,
    pub folder_id: RequiredNullable<Id>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticScopeReview {
    pub review_id: Id,
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub expected_revision: Counter,
    #[schemars(range(min = 1, max = 10000))]
    pub count: u16,
    #[schemars(range(min = 0, max = 10000))]
    pub clipped_count: u16,
    pub upper_bytes: Counter,
    #[schemars(length(min = 1, max = 128))]
    pub model: String,
    pub input_recipe_version: u8,
    pub max_input_chars: u16,
    pub max_input_bytes: u16,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticIndex {
    pub index_id: Id,
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub generation: Counter,
    pub phase: SemanticPhase,
    #[schemars(length(min = 1, max = 128))]
    pub model: String,
    pub digest: RequiredNullable<Id>,
    #[schemars(schema_with = "dimension_schema")]
    pub dimension: RequiredNullable<u16>,
    #[schemars(range(min = 0, max = 10000))]
    pub total: u16,
    #[schemars(range(min = 0, max = 10000))]
    pub ready: u16,
    #[schemars(range(min = 0, max = 10000))]
    pub pending: u16,
    pub stored_bytes: Counter,
    pub failure: RequiredNullable<SemanticFailure>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticStatus {
    pub settings: SemanticSettings,
    pub index: RequiredNullable<SemanticIndex>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticQuery {
    pub request_id: Id,
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub index_id: Id,
    pub generation: Counter,
    #[schemars(length(min = 1, max = 4096))]
    pub text: String,
    #[schemars(range(min = 1, max = 50))]
    pub top_k: u8,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticHit {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    #[schemars(length(max = 4096))]
    pub title: String,
    #[schemars(schema_with = "score_schema")]
    pub score: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticQueryResult {
    pub request_id: Id,
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub index_id: Id,
    pub generation: Counter,
    #[schemars(length(max = 50))]
    pub hits: Vec<SemanticHit>,
    pub failure: RequiredNullable<SemanticFailure>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
}
fn nullable_text(max: usize) -> schemars::Schema {
    schemars::Schema::try_from(serde_json::json!({"type":["string","null"],"maxLength":max}))
        .expect("text schema")
}
fn endpoint_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(512)
}
fn model_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(128)
}
fn message_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(120)
}

fn score_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::Schema::try_from(serde_json::json!({"type":"number","minimum":-1,"maximum":1}))
        .expect("score schema")
}

fn dimension_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::Schema::try_from(
        serde_json::json!({"type":["integer","null"],"minimum":1,"maximum":4096}),
    )
    .expect("dimension schema")
}
