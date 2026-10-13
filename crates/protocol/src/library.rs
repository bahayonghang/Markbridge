//! Local cache query contracts. These are not Chrome wire commands.
use crate::{BookmarkNode, Counter, ErrorCode, Id, RequiredNullable, SourceEpoch, Title};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FolderScope {
    Children,
    Subtree,
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryQuery {
    pub folder_id: RequiredNullable<Id>,
    pub folder_scope: FolderScope,
    pub query: Title,
    #[schemars(length(max = 64))]
    pub tag_ids: Vec<Id>,
    pub include_summary: bool,
    pub include_note: bool,
    pub offset: Counter,
    pub limit: Counter,
    pub expected_revision: RequiredNullable<Counter>,
    pub expected_source_epoch: RequiredNullable<SourceEpoch>,
}

impl LibraryQuery {
    pub fn validate(&self) -> Result<(), ErrorCode> {
        if !(1..=200).contains(&self.limit.get())
            || self.offset.get() > 100_000
            || self.tag_ids.len() > 64
            || self
                .tag_ids
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.tag_ids.len()
            || (self.folder_scope != FolderScope::All && self.folder_id.0.is_none())
            || (self.offset.get() > 0
                && (self.expected_revision.0.is_none() || self.expected_source_epoch.0.is_none()))
        {
            return Err(ErrorCode::InvalidMessage);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryQueryPage {
    #[schemars(length(max = 200))]
    pub items: Vec<BookmarkNode>,
    pub source_epoch: SourceEpoch,
    pub revision: Counter,
    pub total: Counter,
    pub offset: Counter,
    pub next_offset: RequiredNullable<Counter>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn query_boundaries_reject_invalid_limits_and_unbound_continuations() {
        let base = serde_json::json!({"folderId":"1","folderScope":"children","query":"","tagIds":[],"includeSummary":false,"includeNote":false,"offset":0,"limit":200,"expectedRevision":null,"expectedSourceEpoch":null});
        let valid: LibraryQuery = serde_json::from_value(base.clone()).unwrap();
        assert!(valid.validate().is_ok());
        for (key, value) in [
            ("limit", serde_json::json!(201)),
            ("limit", serde_json::json!(0)),
            ("offset", serde_json::json!(200)),
            ("folderId", serde_json::Value::Null),
            ("tagIds", serde_json::json!(["same", "same"])),
        ] {
            let mut invalid = base.clone();
            invalid[key] = value;
            let query: LibraryQuery = serde_json::from_value(invalid).unwrap();
            assert_eq!(query.validate(), Err(ErrorCode::InvalidMessage));
        }
        let mut unknown = base;
        unknown["browserWrite"] = serde_json::json!(true);
        assert!(serde_json::from_value::<LibraryQuery>(unknown).is_err());
    }
}
