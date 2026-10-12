//! Library maintenance DTOs. A report is not a browser write.
use crate::{Counter, ErrorCode, Id, OperationState, RequiredNullable, SourceEpoch};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LinkVerdict {
    Unknown,
    Alive,
    Pending,
    Candidate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryMember {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    #[schemars(schema_with = "title_schema")]
    pub title: String,
    #[schemars(schema_with = "url_schema")]
    pub url: String,
    #[schemars(length(max = 32))]
    pub tags: Vec<String>,
    #[schemars(schema_with = "note_schema")]
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DuplicateGroup {
    #[schemars(schema_with = "url_schema")]
    pub normalized_url: String,
    #[schemars(length(max = 1000))]
    pub members: Vec<LibraryMember>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteConflict {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    #[schemars(schema_with = "note_schema")]
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataHandling {
    #[schemars(length(max = 64))]
    pub tag_union: Vec<String>,
    #[schemars(length(max = 1000))]
    pub note_conflicts: Vec<NoteConflict>,
    #[schemars(schema_with = "note_schema")]
    pub keeper_note: String,
    #[schemars(schema_with = "handling_schema")]
    pub handling: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupView {
    pub keeper: LibraryMember,
    #[schemars(length(max = 1000))]
    pub removals: Vec<LibraryMember>,
    pub metadata: MetadataHandling,
    pub operation_id: RequiredNullable<Id>,
    pub operation_state: RequiredNullable<OperationState>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkRow {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    #[schemars(schema_with = "url_schema")]
    pub url: String,
    pub verdict: LinkVerdict,
    pub http_status: RequiredNullable<u16>,
    pub checks: Counter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaintenanceReport {
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub revision: Counter,
    pub request_id: Id,
    #[schemars(length(max = 1000))]
    pub duplicates: Vec<DuplicateGroup>,
    #[schemars(length(max = 1000))]
    pub links: Vec<LinkRow>,
    pub cleanup: RequiredNullable<CleanupView>,
    pub running: bool,
    pub failure: RequiredNullable<ErrorCode>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextHit {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    #[schemars(schema_with = "title_schema")]
    pub title: String,
    #[schemars(schema_with = "note_schema")]
    pub summary: String,
    #[schemars(schema_with = "note_schema")]
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextSearchPage {
    pub profile_id: Id,
    #[schemars(schema_with = "query_schema")]
    pub query: String,
    #[schemars(length(max = 50))]
    pub hits: Vec<TextHit>,
}

fn text_schema(max: usize, nullable: bool) -> schemars::Schema {
    let kind = if nullable {
        serde_json::json!(["string", "null"])
    } else {
        serde_json::json!("string")
    };
    schemars::Schema::try_from(serde_json::json!({"type": kind, "maxLength": max}))
        .expect("text schema")
}

fn title_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(4096, false)
}

fn url_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(16_384, false)
}

fn note_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(4096, false)
}

fn handling_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(80, false)
}

fn query_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(200, false)
}

fn message_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    text_schema(80, true)
}
