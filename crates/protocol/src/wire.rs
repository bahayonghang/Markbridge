//! Protocol v1 DTOs and validation for untrusted transport frames.
use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_NODES: usize = 100_000;
pub const MAX_DEPTH: usize = 256;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidMessage,
    UnsupportedVersion,
    FrameTooLarge,
    LimitExceeded,
    InvalidTree,
    Unpaired,
    ReadOnly,
    WrongProfile,
    StaleProposal,
    ProtectedNode,
    UncertainWrite,
    FetchDenied,
    InvalidAiOutput,
    StorageError,
    StorageNewerSchema,
    MigrationFailed,
    Conflict,
    Cancelled,
}
impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = serde_json::to_value(self).map_err(|_| std::fmt::Error)?;
        f.write_str(value.as_str().ok_or(std::fmt::Error)?)
    }
}
impl std::error::Error for ErrorCode {}

macro_rules! bounded_string {
    ($name:ident, $min:expr, $max:expr, $id:expr) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
        #[serde(transparent)]
        pub struct $name(String);
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, ErrorCode> {
                let value = value.into();
                let length = value.chars().count();
                if !($min..=$max).contains(&length)
                    || ($id && (!value.as_bytes()[0].is_ascii_alphanumeric()
                        || !value.bytes().all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c)))) {
                    return Err(ErrorCode::InvalidMessage);
                }
                Ok(Self(value))
            }
            pub fn as_str(&self) -> &str { &self.0 }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
            }
        }
        impl JsonSchema for $name {
            fn schema_name() -> std::borrow::Cow<'static, str> { stringify!($name).into() }
            fn json_schema(_: &mut SchemaGenerator) -> Schema {
                let mut value = serde_json::json!({"type":"string","minLength":$min,"maxLength":$max});
                if $id { value["pattern"] = serde_json::json!("^[A-Za-z0-9][A-Za-z0-9._:-]*(?![\\s\\S])"); }
                Schema::try_from(value).expect("valid string schema")
            }
        }
    };
}
bounded_string!(Id, 1, 128, true);
bounded_string!(Title, 0, 4096, false);
bounded_string!(Url, 1, 16384, false);
bounded_string!(DisplayName, 1, 128, false);
bounded_string!(Credential, 32, 1024, false);

macro_rules! bounded_number {
    ($name:ident, $min:expr, $max:expr) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
        #[serde(transparent)]
        pub struct $name(u64);
        impl $name {
            pub fn new(value: u64) -> Result<Self, ErrorCode> {
                if !($min..=$max).contains(&value) { return Err(ErrorCode::InvalidMessage); }
                Ok(Self(value))
            }
            pub fn get(&self) -> u64 { self.0 }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                struct NumberVisitor;
                impl<'de> serde::de::Visitor<'de> for NumberVisitor {
                    type Value = $name;
                    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        formatter.write_str("a bounded nonnegative integer")
                    }
                    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
                        $name::new(value).map_err(E::custom)
                    }
                    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
                        self.visit_u64(u64::try_from(value).map_err(E::custom)?)
                    }
                    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
                        // JSON Schema integers include 1.0 and 1e0. Match JavaScript parsing.
                        if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > MAX_SAFE_INTEGER as f64 {
                            return Err(E::custom(ErrorCode::InvalidMessage));
                        }
                        self.visit_u64(value as u64)
                    }
                }
                deserializer.deserialize_any(NumberVisitor)
            }
        }
        impl JsonSchema for $name {
            fn schema_name() -> std::borrow::Cow<'static, str> { stringify!($name).into() }
            fn json_schema(_: &mut SchemaGenerator) -> Schema {
                Schema::try_from(serde_json::json!({"type":"integer","format":"uint64","minimum":$min,"maximum":$max})).expect("valid integer schema")
            }
        }
    };
}
bounded_number!(Version, 1, 1);
bounded_number!(Counter, 0, MAX_SAFE_INTEGER);
bounded_number!(SourceEpoch, 1, MAX_SAFE_INTEGER);
bounded_number!(Position, 0, 100_000);

/// A required JSON field whose value can be null. Unlike Option, absence is rejected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(transparent)]
#[schemars(transparent)]
pub struct RequiredNullable<T>(pub Option<T>);
impl<'de, T: serde::de::DeserializeOwned> Deserialize<'de> for RequiredNullable<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        serde_json::from_value(value)
            .map(Self)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TimeSource {
    ChromeApi,
    ChromeFile,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceTime {
    pub source: TimeSource,
    pub unix_millis: Counter,
}
pub fn chrome_time(value: u64) -> Result<SourceTime, ErrorCode> {
    Ok(SourceTime {
        source: TimeSource::ChromeApi,
        unix_millis: Counter::new(value)?,
    })
}
pub fn file_time(value: u64) -> Result<SourceTime, ErrorCode> {
    let unix_micros = value
        .checked_sub(11_644_473_600_000_000)
        .ok_or(ErrorCode::InvalidMessage)?;
    Ok(SourceTime {
        source: TimeSource::ChromeFile,
        unix_millis: Counter::new(unix_micros / 1000)?,
    })
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FolderType {
    BookmarksBar,
    Other,
    Mobile,
    Managed,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Folder,
    Bookmark,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Unmodifiable {
    Managed,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookmarkNode {
    pub chrome_id: Id,
    pub parent_id: Option<Id>,
    pub position: Position,
    pub kind: NodeKind,
    pub title: Title,
    pub url: Option<Url>,
    pub folder_type: Option<FolderType>,
    pub unmodifiable: Option<Unmodifiable>,
    pub date_added: Option<SourceTime>,
    pub date_last_used: Option<SourceTime>,
}
impl BookmarkNode {
    pub fn validate(&self) -> Result<(), ErrorCode> {
        if match self.kind {
            NodeKind::Folder => self.url.is_some(),
            NodeKind::Bookmark => self.url.is_none() || self.folder_type.is_some(),
        } {
            return Err(ErrorCode::InvalidTree);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TreeSnapshot {
    pub source_epoch: SourceEpoch,
    pub revision: Counter,
    pub barrier_seq: Counter,
    #[schemars(length(max = 100000))]
    pub nodes: Vec<BookmarkNode>,
}
impl TreeSnapshot {
    pub fn validate(&self) -> Result<(), ErrorCode> {
        if self.nodes.len() > MAX_NODES {
            return Err(ErrorCode::LimitExceeded);
        }
        let mut nodes = HashMap::new();
        let mut positions = HashSet::new();
        for node in &self.nodes {
            node.validate()?;
            if nodes.insert(node.chrome_id.as_str(), node).is_some()
                || !positions.insert((node.parent_id.as_ref().map(Id::as_str), node.position.get()))
            {
                return Err(ErrorCode::InvalidTree);
            }
        }
        let mut depths = HashMap::new();
        for node in &self.nodes {
            let mut chain = Vec::new();
            let mut seen = HashSet::new();
            let mut current = node;
            let mut base = 0;
            loop {
                if let Some(depth) = depths.get(current.chrome_id.as_str()) {
                    base = *depth;
                    break;
                }
                if !seen.insert(current.chrome_id.as_str()) {
                    return Err(ErrorCode::InvalidTree);
                }
                chain.push(current.chrome_id.as_str());
                if chain.len() > MAX_DEPTH {
                    return Err(ErrorCode::LimitExceeded);
                }
                let Some(parent_id) = &current.parent_id else {
                    break;
                };
                current = nodes
                    .get(parent_id.as_str())
                    .ok_or(ErrorCode::InvalidTree)?;
                if current.kind != NodeKind::Folder {
                    return Err(ErrorCode::InvalidTree);
                }
            }
            if base + chain.len() > MAX_DEPTH {
                return Err(ErrorCode::LimitExceeded);
            }
            for (index, id) in chain.into_iter().rev().enumerate() {
                depths.insert(id, base + index + 1);
            }
        }
        Ok(())
    }
    pub fn protected_ids(&self) -> Result<HashSet<String>, ErrorCode> {
        self.validate()?;
        let nodes: HashMap<_, _> = self
            .nodes
            .iter()
            .map(|node| (node.chrome_id.as_str(), node))
            .collect();
        let mut protected = HashSet::new();
        for node in &self.nodes {
            if node.parent_id.is_none() || node.folder_type.is_some() {
                protected.insert(node.chrome_id.as_str().to_owned());
            }
            let mut current = node;
            loop {
                if current.unmodifiable.is_some() {
                    protected.insert(node.chrome_id.as_str().to_owned());
                    break;
                }
                let Some(parent_id) = &current.parent_id else {
                    break;
                };
                current = nodes[parent_id.as_str()];
            }
        }
        Ok(protected)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BookmarkEvent {
    Created {
        node: BookmarkNode,
    },
    Changed {
        chrome_id: Id,
        title: Title,
        url: Option<Url>,
    },
    Moved {
        chrome_id: Id,
        old_parent_id: Id,
        old_position: Position,
        parent_id: Id,
        position: Position,
    },
    Removed {
        chrome_id: Id,
        parent_id: Id,
        position: Position,
        #[schemars(length(max = 100000))]
        subtree: Vec<BookmarkNode>,
    },
    Reordered {
        parent_id: Id,
        #[schemars(length(max = 100000))]
        child_ids: Vec<Id>,
    },
    ImportBegan {},
    ImportEnded {},
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Mutation {
    Create {
        parent_id: Id,
        position: Position,
        title: Title,
        url: Option<Url>,
    },
    Update {
        title: Option<Title>,
        url: Option<Url>,
    },
    Move {
        parent_id: Id,
        position: Position,
    },
    Reorder {
        #[schemars(length(max = 100000))]
        child_ids: Vec<Id>,
    },
    Delete {},
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OperationState {
    Planned,
    Applying,
    Applied,
    Uncertain,
    Partial,
    Failed,
    RollingBack,
    RolledBack,
    RollbackConflict,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationStep {
    pub request_id: Id,
    pub target: Option<Id>,
    pub expected_before: Option<BookmarkNode>,
    #[schemars(length(max = 100000))]
    pub expected_child_ids: Option<Vec<Id>>,
    pub payload: Mutation,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairPayload {
    pub instance_id: Id,
    pub credential: Credential,
    pub display_name: DisplayName,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairResultPayload {
    pub accepted: bool,
    pub credential: Option<Credential>,
    pub error_code: Option<ErrorCode>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelloPayload {
    pub instance_id: Id,
    pub credential: Credential,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelloResultPayload {
    pub accepted: bool,
    pub source_epoch: SourceEpoch,
    pub error_code: Option<ErrorCode>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EmptyPayload {}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventPayload {
    pub source_epoch: SourceEpoch,
    pub event: BookmarkEvent,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResyncPayload {
    pub reason: ErrorCode,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyPayload {
    pub operation_id: Id,
    pub source_epoch: SourceEpoch,
    pub expected_revision: Counter,
    #[schemars(length(min = 1, max = 1000))]
    pub steps: Vec<OperationStep>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub operation_id: Id,
    pub request_id: Id,
    pub state: OperationState,
    pub before: Option<BookmarkNode>,
    pub after: Option<BookmarkNode>,
    #[schemars(length(max = 100000))]
    pub before_child_ids: Option<Vec<Id>>,
    #[schemars(length(max = 100000))]
    pub after_child_ids: Option<Vec<Id>>,
    pub error_code: Option<ErrorCode>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusPayload {
    pub operation_id: Id,
}

macro_rules! wire_message {
    ($($variant:ident($payload:ty)),* $(,)?) => {
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
        #[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
        pub enum WireMessage {
            $($variant {
                protocol_version: Version,
                profile_id: Id,
                session_id: Id,
                request_id: RequiredNullable<Id>,
                seq: RequiredNullable<Counter>,
                payload: $payload,
            }),*
        }
        impl WireMessage {
            pub fn identity(&self) -> (&Id, &Id) {
                match self { $(Self::$variant { profile_id, session_id, .. } => (profile_id, session_id)),* }
            }
            pub fn validate(&self) -> Result<(), ErrorCode> {
                match self {
                    $(Self::$variant { request_id, seq, .. } => {
                        let event = matches!(self, Self::Event { .. });
                        let command = !event && !matches!(self, Self::ResyncRequired { .. });
                        if request_id.0.is_some() != command || seq.0.is_some() != event {
                            return Err(ErrorCode::InvalidMessage);
                        }
                    }),*
                }
                self.validate_payload()
            }
        }
    };
}
wire_message! {
    Pair(PairPayload), PairResult(PairResultPayload), Hello(HelloPayload), HelloResult(HelloResultPayload),
    Ping(EmptyPayload), Pong(EmptyPayload), GetTree(EmptyPayload), TreeFull(TreeSnapshot), Event(EventPayload),
    ResyncRequired(ResyncPayload), ApplyOperation(ApplyPayload), OperationReceipt(Box<Receipt>), GetOperationStatus(StatusPayload),
}
fn validate_ids(ids: &[Id]) -> Result<(), ErrorCode> {
    if ids.len() > MAX_NODES || ids.iter().collect::<HashSet<_>>().len() != ids.len() {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(())
}
impl WireMessage {
    fn validate_payload(&self) -> Result<(), ErrorCode> {
        match self {
            Self::TreeFull { payload, .. } => payload.validate()?,
            Self::Event { payload, .. } => match &payload.event {
                BookmarkEvent::Created { node } => node.validate()?,
                BookmarkEvent::Removed { subtree, .. } => {
                    if subtree.len() > MAX_NODES {
                        return Err(ErrorCode::LimitExceeded);
                    }
                    for node in subtree {
                        node.validate()?;
                    }
                }
                BookmarkEvent::Reordered { child_ids, .. } => validate_ids(child_ids)?,
                _ => {}
            },
            Self::OperationReceipt { payload, .. } => {
                for node in [&payload.before, &payload.after].into_iter().flatten() {
                    node.validate()?;
                }
                for (ids, node) in [
                    (&payload.before_child_ids, &payload.before),
                    (&payload.after_child_ids, &payload.after),
                ] {
                    if let Some(ids) = ids {
                        validate_ids(ids)?;
                        if node
                            .as_ref()
                            .is_none_or(|node| node.kind != NodeKind::Folder)
                        {
                            return Err(ErrorCode::InvalidMessage);
                        }
                    }
                }
            }
            Self::ApplyOperation { payload, .. } => {
                if payload.steps.is_empty() || payload.steps.len() > 1000 {
                    return Err(ErrorCode::LimitExceeded);
                }
                let mut requests = HashSet::new();
                for step in &payload.steps {
                    if !requests.insert(&step.request_id) {
                        return Err(ErrorCode::InvalidMessage);
                    }
                    if let Some(before) = &step.expected_before {
                        before.validate()?;
                    }
                    if matches!(step.payload, Mutation::Create { .. }) {
                        if step.target.is_some() || step.expected_before.is_some() {
                            return Err(ErrorCode::InvalidMessage);
                        }
                    } else if step.target.is_none()
                        || step.expected_before.as_ref().map(|node| &node.chrome_id)
                            != step.target.as_ref()
                    {
                        return Err(ErrorCode::InvalidMessage);
                    }
                    if let Mutation::Reorder { child_ids } = &step.payload {
                        validate_ids(child_ids)?;
                        let expected = step
                            .expected_child_ids
                            .as_ref()
                            .ok_or(ErrorCode::InvalidMessage)?;
                        validate_ids(expected)?;
                        if step
                            .expected_before
                            .as_ref()
                            .is_none_or(|node| node.kind != NodeKind::Folder)
                            || expected.len() != child_ids.len()
                            || expected.iter().collect::<HashSet<_>>()
                                != child_ids.iter().collect::<HashSet<_>>()
                        {
                            return Err(ErrorCode::InvalidMessage);
                        }
                    } else if step.expected_child_ids.is_some() {
                        return Err(ErrorCode::InvalidMessage);
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
}
pub fn parse_frame(frame: &[u8]) -> Result<WireMessage, ErrorCode> {
    if frame.len() > MAX_FRAME_BYTES {
        return Err(ErrorCode::FrameTooLarge);
    }
    let message: WireMessage =
        serde_json::from_slice(frame).map_err(|_| ErrorCode::InvalidMessage)?;
    message.validate()?;
    Ok(message)
}
pub fn encode_frame(message: &WireMessage) -> Result<Vec<u8>, ErrorCode> {
    message.validate()?;
    let frame = serde_json::to_vec(message).map_err(|_| ErrorCode::InvalidMessage)?;
    if frame.len() > MAX_FRAME_BYTES {
        return Err(ErrorCode::FrameTooLarge);
    }
    Ok(frame)
}
