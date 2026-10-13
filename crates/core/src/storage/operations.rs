use super::{Result, Storage, storage_error};
use markbridge_protocol::{
    BookmarkNode, ErrorCode, Id, Mutation, OperationState, Receipt, SourceEpoch,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct SidecarRow {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    pub note: String,
    pub summary: Option<String>,
    pub display_title: Option<String>,
}

#[derive(Clone, Debug)]
pub struct StepRecord {
    pub ordinal: u64,
    pub request_id: Id,
    pub target: Option<Id>,
    pub payload: Mutation,
    pub expected_before: Option<BookmarkNode>,
    pub expected_child_ids: Option<Vec<Id>>,
    pub receipt: Option<Receipt>,
}

#[derive(Clone, Debug)]
pub struct OperationRecord {
    pub operation_id: Id,
    pub created_at: u64,
    pub profile_id: Id,
    pub source_epoch: SourceEpoch,
    pub state: OperationState,
    pub before_json: String,
    pub after_json: Option<String>,
    pub steps: Vec<StepRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodingBody {
    pub request_id: Id,
    pub bookmark_id: Id,
    pub raw_title: String,
    pub encoded_title: String,
    pub restore: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeforeBody {
    #[serde(default)]
    pub batch: Option<markbridge_protocol::BatchEditPreview>,
    pub nodes: Vec<BookmarkNode>,
    pub orders: Vec<OrderBody>,
    pub restores: Vec<RestoreBody>,
    pub undo_of: Option<Id>,
    pub conflicts: Vec<markbridge_protocol::OperationConflict>,
    #[serde(default)]
    pub encodings: Vec<EncodingBody>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderBody {
    pub parent_id: Id,
    pub child_ids: Vec<Id>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBody {
    pub request_id: Id,
    pub old_chrome_id: Id,
    pub old_bookmark_id: Id,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AfterBody {
    #[serde(default)]
    pub batch: Option<BatchProgress>,
    pub maps: Vec<IdMapBody>,
    pub reviewed: bool,
    #[serde(default)]
    pub conflicts: Vec<markbridge_protocol::OperationConflict>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchProgress {
    pub dispatched: usize,
    pub dispatched_at: u64,
    pub stopped: bool,
    pub error: Option<ErrorCode>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdMapBody {
    pub request_id: Id,
    pub old_chrome_id: Id,
    pub new_chrome_id: Id,
    pub old_bookmark_id: Id,
}

impl Storage {
    pub async fn export_sidecar_entries(
        &self,
        profile_id: Id,
        epoch: SourceEpoch,
    ) -> Result<serde_json::Value> {
        self.call(move |conn| {
            let mut statement = conn.prepare("SELECT c.bookmark_id,c.chrome_id,m.display_title,m.summary,COALESCE(m.note,''),m.raw_title,m.last_encoded_title FROM bookmarks_cache c LEFT JOIN bookmark_metadata m ON m.bookmark_id=c.bookmark_id WHERE c.profile_id=?1 AND c.source_epoch=?2 AND c.deleted_at IS NULL ORDER BY c.chrome_id").map_err(storage_error)?;
            let mut tags = conn.prepare("SELECT t.id,t.name FROM bookmark_tags b JOIN tags t ON t.id=b.tag_id WHERE b.bookmark_id=?1 ORDER BY t.normalized_name,t.id").map_err(storage_error)?;
            let rows = statement.query_map(params![profile_id.as_str(), epoch.get() as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, String>(4)?, row.get::<_, Option<String>>(5)?, row.get::<_, Option<String>>(6)?))
            }).map_err(storage_error)?;
            let mut entries = Vec::new();
            for row in rows {
                let (bookmark, chrome, display, summary, note, raw_title, encoded_title) = row.map_err(storage_error)?;
                let labels = tags.query_map([&bookmark], |row| Ok(serde_json::json!({"tagId": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?})))
                    .map_err(storage_error)?.collect::<std::result::Result<Vec<_>, _>>().map_err(storage_error)?;
                entries.push(serde_json::json!({"bookmarkId": bookmark, "chromeId": chrome, "displayTitle": display, "summary": summary, "note": note, "rawTitle": raw_title, "lastEncodedTitle": encoded_title, "tags": labels}));
            }
            Ok(serde_json::Value::Array(entries))
        }).await
    }

    pub async fn sidecar_rows(
        &self,
        profile_id: Id,
        epoch: SourceEpoch,
    ) -> Result<Vec<SidecarRow>> {
        self.call(move |conn| {
            let mut statement = conn.prepare("SELECT c.bookmark_id,c.chrome_id,m.display_title,m.summary,COALESCE(m.note,'') FROM bookmarks_cache c LEFT JOIN bookmark_metadata m ON m.bookmark_id=c.bookmark_id WHERE c.profile_id=?1 AND c.source_epoch=?2 ORDER BY c.chrome_id").map_err(storage_error)?;
            let rows = statement.query_map(params![profile_id.as_str(), epoch.get() as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, String>(4)?))
            }).map_err(storage_error)?;
            rows.map(|row| {
                let (bookmark, chrome, display, summary, note) = row.map_err(storage_error)?;
                Ok(SidecarRow { bookmark_id: Id::new(bookmark)?, chrome_id: Id::new(chrome)?, note, summary, display_title: display })
            }).collect()
        }).await
    }

    pub async fn insert_operation(
        &self,
        record: OperationRecord,
        tree_before: String,
        metadata_before: String,
        html_path: String,
        sidecar_path: String,
        created_at: u64,
    ) -> Result<()> {
        self.call(move |conn| {
            let transaction = conn.transaction().map_err(storage_error)?;
            transaction.execute(
                "INSERT INTO operations(operation_id,profile_id,source_epoch,state,before_json,after_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![record.operation_id.as_str(), record.profile_id.as_str(), record.source_epoch.get() as i64, state_name(&record.state), record.before_json, record.after_json, created_at as i64],
            ).map_err(storage_error)?;
            for step in &record.steps {
                transaction.execute(
                    "INSERT INTO operation_steps(operation_id,ordinal,request_id,target,kind,expected_before,expected_child_ids,payload,receipt) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![
                        record.operation_id.as_str(),
                        step.ordinal as i64,
                        step.request_id.as_str(),
                        step.target.as_ref().map(Id::as_str),
                        kind_name(&step.payload),
                        step.expected_before.as_ref().map(serde_json::to_string).transpose().map_err(|_| ErrorCode::StorageError)?,
                        step.expected_child_ids.as_ref().map(serde_json::to_string).transpose().map_err(|_| ErrorCode::StorageError)?,
                        serde_json::to_string(&step.payload).map_err(|_| ErrorCode::StorageError)?,
                        step.receipt.as_ref().map(serde_json::to_string).transpose().map_err(|_| ErrorCode::StorageError)?,
                    ],
                ).map_err(storage_error)?;
            }
            transaction.execute(
                "INSERT INTO snapshots(operation_id,schema_version,tree_before,metadata_before,created_at,html_backup_path,sidecar_backup_path) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![record.operation_id.as_str(), super::SCHEMA_VERSION as i64, tree_before, metadata_before, created_at as i64, html_path, sidecar_path],
            ).map_err(storage_error)?;
            transaction.commit().map_err(storage_error)
        }).await
    }

    pub async fn set_operation_state(
        &self,
        operation_id: Id,
        state: OperationState,
        after_json: Option<String>,
    ) -> Result<()> {
        self.call(move |conn| {
            let changed = if let Some(after_json) = after_json {
                conn.execute(
                    "UPDATE operations SET state=?2,after_json=?3 WHERE operation_id=?1",
                    params![operation_id.as_str(), state_name(&state), after_json],
                )
            } else {
                conn.execute(
                    "UPDATE operations SET state=?2 WHERE operation_id=?1",
                    params![operation_id.as_str(), state_name(&state)],
                )
            }
            .map_err(storage_error)?;
            if changed != 1 {
                return Err(ErrorCode::StorageError);
            }
            Ok(())
        })
        .await
    }

    pub async fn save_receipt(&self, receipt: Receipt) -> Result<()> {
        self.call(move |conn| {
            let json = serde_json::to_string(&receipt).map_err(|_| ErrorCode::StorageError)?;
            let changed = conn
                .execute(
                    "UPDATE operation_steps SET receipt=?2 WHERE request_id=?1",
                    params![receipt.request_id.as_str(), json],
                )
                .map_err(storage_error)?;
            if changed != 1 {
                return Err(ErrorCode::InvalidMessage);
            }
            Ok(())
        })
        .await
    }

    pub async fn operation(&self, operation_id: Id) -> Result<OperationRecord> {
        self.call(move |conn| load_operation(conn, operation_id.as_str()))
            .await
    }

    pub async fn snapshot_tree(&self, operation_id: Id) -> Result<Vec<BookmarkNode>> {
        self.call(move |conn| {
            let json: String = conn
                .query_row(
                    "SELECT tree_before FROM snapshots WHERE operation_id=?1",
                    [operation_id.as_str()],
                    |row| row.get(0),
                )
                .map_err(|_| ErrorCode::StorageError)?;
            serde_json::from_str(&json).map_err(|_| ErrorCode::StorageError)
        })
        .await
    }

    pub async fn operations_for(&self, profile_id: Id) -> Result<Vec<OperationRecord>> {
        self.call(move |conn| {
            let mut statement = conn.prepare("SELECT operation_id FROM operations WHERE profile_id=?1 ORDER BY created_at DESC, operation_id DESC").map_err(storage_error)?;
            let ids: Vec<String> = statement.query_map([profile_id.as_str()], |row| row.get(0)).map_err(storage_error)?.collect::<std::result::Result<_, _>>().map_err(storage_error)?;
            drop(statement);
            ids.iter().map(|id| load_operation(conn, id)).collect()
        }).await
    }

    pub async fn freeze_inflight(&self) -> Result<usize> {
        self.call(|conn| {
            let changed = conn.execute("UPDATE operations SET state='uncertain' WHERE state IN ('applying','rolling_back')", []).map_err(storage_error)?;
            Ok(changed)
        }).await
    }

    pub async fn freeze_profile(&self, profile_id: Id) -> Result<usize> {
        self.call(move |conn| {
            let changed = conn.execute("UPDATE operations SET state='uncertain' WHERE profile_id=?1 AND state IN ('applying','rolling_back')", [profile_id.as_str()]).map_err(storage_error)?;
            Ok(changed)
        }).await
    }

    pub async fn blocked_profiles(&self) -> Result<Vec<Id>> {
        self.call(|conn| {
            let mut statement = conn.prepare("SELECT profile_id,after_json,state FROM operations WHERE state IN ('uncertain','partial','rollback_conflict')").map_err(storage_error)?;
            let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?))).map_err(storage_error)?;
            let mut ids = Vec::new();
            for row in rows {
                let (profile, after, _state) = row.map_err(storage_error)?;
                if !reviewed(after.as_deref()) {
                    let id = Id::new(profile)?;
                    if !ids.contains(&id) { ids.push(id); }
                }
            }
            Ok(ids)
        }).await
    }

    pub async fn copy_mapped_metadata(
        &self,
        profile_id: Id,
        epoch: SourceEpoch,
        now: u64,
    ) -> Result<()> {
        self.call(move |conn| {
            let mut statement = conn.prepare("SELECT operation_id,after_json FROM operations WHERE profile_id=?1 AND source_epoch=?2 AND after_json IS NOT NULL").map_err(storage_error)?;
            let rows = statement.query_map(params![profile_id.as_str(), epoch.get() as i64], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(storage_error)?;
            let pending: Vec<(String, AfterBody)> = rows.filter_map(|row| {
                let (id, json) = row.ok()?;
                let body: AfterBody = serde_json::from_str(&json).ok()?;
                if body.maps.is_empty() { None } else { Some((id, body)) }
            }).collect();
            for (operation_id, mut body) in pending {
                let mut remaining = Vec::new();
                for map in body.maps {
                    let new_id = conn.query_row(
                        "SELECT bookmark_id FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND chrome_id=?3 AND deleted_at IS NULL",
                        params![profile_id.as_str(), epoch.get() as i64, map.new_chrome_id.as_str()],
                        |row| row.get::<_, String>(0),
                    ).optional().map_err(storage_error)?;
                    let Some(new_id) = new_id else { remaining.push(map); continue };
                    conn.execute(
                        "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,raw_title,last_encoded_title,updated_at) SELECT ?2,display_title,summary,note,raw_title,last_encoded_title,?3 FROM bookmark_metadata WHERE bookmark_id=?1 ON CONFLICT(bookmark_id) DO UPDATE SET display_title=excluded.display_title,summary=excluded.summary,note=excluded.note,raw_title=excluded.raw_title,last_encoded_title=excluded.last_encoded_title,updated_at=excluded.updated_at",
                        params![map.old_bookmark_id.as_str(), new_id, now as i64],
                    ).map_err(storage_error)?;
                    conn.execute(
                        "INSERT INTO bookmark_tags(bookmark_id,tag_id) SELECT ?2,tag_id FROM bookmark_tags WHERE bookmark_id=?1 ON CONFLICT(bookmark_id,tag_id) DO NOTHING",
                        params![map.old_bookmark_id.as_str(), new_id],
                    ).map_err(storage_error)?;
                    super::maintenance::sync_metadata_fts(conn, &new_id)?;
                }
                body.maps = remaining;
                let json = serde_json::to_string(&body).map_err(|_| ErrorCode::StorageError)?;
                conn.execute("UPDATE operations SET after_json=?2 WHERE operation_id=?1", params![operation_id, json]).map_err(storage_error)?;
            }
            Ok(())
        }).await
    }
}

fn reviewed(after_json: Option<&str>) -> bool {
    after_json
        .and_then(|text| serde_json::from_str::<AfterBody>(text).ok())
        .is_some_and(|body| body.reviewed)
}

fn load_operation(conn: &rusqlite::Connection, operation_id: &str) -> Result<OperationRecord> {
    let (profile, epoch, state, before_json, after_json, created_at) = conn.query_row(
        "SELECT profile_id,source_epoch,state,before_json,after_json,created_at FROM operations WHERE operation_id=?1",
        [operation_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, i64>(5)?)),
    ).map_err(|_| ErrorCode::InvalidMessage)?;
    let mut statement = conn.prepare("SELECT ordinal,request_id,target,payload,expected_before,expected_child_ids,receipt FROM operation_steps WHERE operation_id=?1 ORDER BY ordinal").map_err(storage_error)?;
    let rows = statement
        .query_map([operation_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(storage_error)?;
    let mut steps = Vec::new();
    for row in rows {
        let (ordinal, request, target, payload, before, children, receipt) =
            row.map_err(storage_error)?;
        steps.push(StepRecord {
            ordinal: ordinal as u64,
            request_id: Id::new(request)?,
            target: target.map(Id::new).transpose()?,
            payload: serde_json::from_str(&payload).map_err(|_| ErrorCode::StorageError)?,
            expected_before: before
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|_| ErrorCode::StorageError)?,
            expected_child_ids: children
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|_| ErrorCode::StorageError)?,
            receipt: receipt
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|_| ErrorCode::StorageError)?,
        });
    }
    Ok(OperationRecord {
        operation_id: Id::new(operation_id)?,
        created_at: created_at as u64,
        profile_id: Id::new(profile)?,
        source_epoch: SourceEpoch::new(epoch as u64)?,
        state: parse_state(&state)?,
        before_json,
        after_json,
        steps,
    })
}

fn parse_state(value: &str) -> Result<OperationState> {
    serde_json::from_value(serde_json::Value::String(value.to_owned()))
        .map_err(|_| ErrorCode::StorageError)
}

fn state_name(state: &OperationState) -> String {
    serde_json::to_value(state)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "uncertain".into())
}

fn kind_name(payload: &Mutation) -> &'static str {
    match payload {
        Mutation::Create { .. } => "create",
        Mutation::Update { .. } => "update",
        Mutation::Move { .. } => "move",
        Mutation::Reorder { .. } => "reorder",
        Mutation::Delete {} => "delete",
    }
}
