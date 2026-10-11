//! AI settings and job rows. Secrets are not stored in these tables.
use super::{Storage, storage_error};
use markbridge_protocol::{ErrorCode, Id};
use rusqlite::{OptionalExtension, params};

const ENABLED: &str = "ai.enabled";
const PROVIDER: &str = "ai.provider";
const ENDPOINT: &str = "ai.endpoint";
const MODEL: &str = "ai.model";
const CREDENTIAL: &str = "ai.credential_ref";
const SCHEMA: &str = "ai.schema";
pub(crate) const CREDENTIAL_REF: &str = "ai-model-key";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiConfig {
    pub enabled: bool,
    pub provider: Option<String>,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub credential_configured: bool,
    pub schema_supported: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiTarget {
    pub bookmark_id: Id,
    pub title: String,
    pub url: Option<String>,
    pub node_revision: u64,
    pub tree_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredJob {
    pub id: Id,
    pub profile_id: Id,
    pub fingerprint: String,
    pub model: String,
    pub endpoint: String,
    pub state: String,
    pub proposal: Option<String>,
    pub error_code: Option<String>,
}

impl Storage {
    pub(crate) async fn ai_config(&self) -> Result<AiConfig, ErrorCode> {
        self.call(|conn| {
            Ok(AiConfig {
                enabled: setting(conn, ENABLED)?.as_deref() == Some("on"),
                provider: setting(conn, PROVIDER)?,
                endpoint: setting(conn, ENDPOINT)?,
                model: setting(conn, MODEL)?,
                credential_configured: setting(conn, CREDENTIAL)?.is_some(),
                schema_supported: match setting(conn, SCHEMA)?.as_deref() {
                    Some("yes") => Some(true),
                    Some("no") => Some(false),
                    _ => None,
                },
            })
        })
        .await
    }

    pub(crate) async fn put_ai_config(
        &self,
        enabled: bool,
        provider: Option<String>,
        endpoint: Option<String>,
        model: Option<String>,
    ) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            put(
                conn,
                ENABLED,
                if enabled {
                    Some("on".to_owned())
                } else {
                    Some("off".to_owned())
                },
            )?;
            put(conn, PROVIDER, provider)?;
            put(conn, ENDPOINT, endpoint)?;
            put(conn, MODEL, model)?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn put_ai_schema(&self, supported: bool) -> Result<(), ErrorCode> {
        let value = if supported { "yes" } else { "no" };
        self.call(move |conn| put(conn, SCHEMA, Some(value.to_owned())))
            .await
    }

    pub(crate) async fn set_ai_credential_flag(&self, present: bool) -> Result<(), ErrorCode> {
        self.call(move |conn| put(conn, CREDENTIAL, present.then(|| CREDENTIAL_REF.to_owned())))
            .await
    }

    pub(crate) async fn ai_target(
        &self,
        profile_id: Id,
        chrome_id: Id,
    ) -> Result<Option<AiTarget>, ErrorCode> {
        self.call(move |conn| {
            let row = conn.query_row(
                "SELECT b.bookmark_id, b.title, b.url, b.revision, COALESCE(c.revision, 0) FROM bookmarks_cache b JOIN profiles p ON p.id=b.profile_id AND p.source_epoch=b.source_epoch LEFT JOIN source_cursors c ON c.profile_id=b.profile_id WHERE b.profile_id=?1 AND b.chrome_id=?2 AND b.deleted_at IS NULL AND b.node_kind='bookmark'",
                params![profile_id.as_str(), chrome_id.as_str()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, i64>(3)?, row.get::<_, i64>(4)?)),
            ).optional().map_err(storage_error)?;
            row.map(|(id, title, url, node_revision, tree_revision)| {
                Ok(AiTarget {
                    bookmark_id: Id::new(id)?,
                    title,
                    url,
                    node_revision: u64::try_from(node_revision).map_err(|_| ErrorCode::StorageError)?,
                    tree_revision: u64::try_from(tree_revision).map_err(|_| ErrorCode::StorageError)?,
                })
            }).transpose()
        }).await
    }

    pub(crate) async fn cached_text(
        &self,
        bookmark_id: Id,
        fingerprint: String,
    ) -> Result<Option<(String, u64)>, ErrorCode> {
        self.call(move |conn| {
            let row = conn.query_row(
                "SELECT text_excerpt, fetched_at FROM preview_cache WHERE bookmark_id=?1 AND url_fingerprint=?2 AND status='ready'",
                params![bookmark_id.as_str(), fingerprint],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<i64>>(1)?)),
            ).optional().map_err(storage_error)?;
            let Some((excerpt, fetched)) = row else { return Ok(None); };
            let Some(excerpt) = excerpt.filter(|value| !value.is_empty()) else { return Ok(None); };
            let Some(fetched) = fetched.filter(|value| *value >= 0) else { return Ok(None); };
            Ok(Some((excerpt, fetched as u64)))
        }).await
    }

    pub(crate) async fn insert_ai_job(&self, job: StoredJob) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            conn.execute(
                "INSERT INTO ai_jobs(id, kind, profile_id, input_fingerprint, model_reference, provider_reference, state, proposal, error_code) VALUES(?1,'single',?2,?3,?4,?5,?6,?7,?8)",
                params![job.id.as_str(), job.profile_id.as_str(), job.fingerprint, job.model, job.endpoint, job.state, job.proposal, job.error_code],
            ).map_err(storage_error)?;
            Ok(())
        }).await
    }

    pub(crate) async fn finish_ai_job(
        &self,
        id: Id,
        state: String,
        proposal: Option<String>,
        error_code: Option<String>,
    ) -> Result<bool, ErrorCode> {
        self.call(move |conn| {
            let changed = conn.execute(
                "UPDATE ai_jobs SET state=?2, proposal=?3, error_code=?4 WHERE id=?1 AND state='running'",
                params![id.as_str(), state, proposal, error_code],
            ).map_err(storage_error)?;
            Ok(changed == 1)
        }).await
    }

    pub(crate) async fn cancel_ai_job(&self, id: Id) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            conn.execute(
                "UPDATE ai_jobs SET state='cancelled', error_code='CANCELLED', proposal=NULL WHERE id=?1 AND state IN ('running','ready')",
                [id.as_str()],
            ).map_err(storage_error)?;
            Ok(())
        }).await
    }

    pub(crate) async fn ai_job(&self, id: Id) -> Result<Option<StoredJob>, ErrorCode> {
        self.call(move |conn| {
            let row = conn.query_row(
                "SELECT id, profile_id, input_fingerprint, model_reference, provider_reference, state, proposal, error_code FROM ai_jobs WHERE id=?1",
                [id.as_str()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, Option<String>>(6)?, row.get::<_, Option<String>>(7)?)),
            ).optional().map_err(storage_error)?;
            row.map(|(id, profile, fingerprint, model, endpoint, state, proposal, error_code)| {
                Ok(StoredJob {
                    id: Id::new(id)?,
                    profile_id: Id::new(profile)?,
                    fingerprint,
                    model,
                    endpoint,
                    state,
                    proposal,
                    error_code,
                })
            }).transpose()
        }).await
    }

    pub(crate) async fn claim_ai_job(&self, id: Id) -> Result<bool, ErrorCode> {
        self.call(move |conn| {
            let changed = conn
                .execute(
                    "UPDATE ai_jobs SET state='applying' WHERE id=?1 AND state='ready'",
                    [id.as_str()],
                )
                .map_err(storage_error)?;
            Ok(changed == 1)
        })
        .await
    }

    pub(crate) async fn release_ai_job(&self, id: Id) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            conn.execute(
                "UPDATE ai_jobs SET state='ready' WHERE id=?1 AND state='applying'",
                [id.as_str()],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn mark_ai_applied(&self, id: Id) -> Result<bool, ErrorCode> {
        self.call(move |conn| {
            let changed = conn
                .execute(
                    "UPDATE ai_jobs SET state='applied' WHERE id=?1 AND state='applying'",
                    [id.as_str()],
                )
                .map_err(storage_error)?;
            Ok(changed == 1)
        })
        .await
    }

    pub(crate) async fn set_summary(
        &self,
        bookmark_id: Id,
        summary: Option<String>,
    ) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| ErrorCode::StorageError)?.as_millis();
            let now = i64::try_from(now).map_err(|_| ErrorCode::StorageError)?;
            conn.execute(
                "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,updated_at) VALUES(?1,NULL,?2,'',?3) ON CONFLICT(bookmark_id) DO UPDATE SET summary=excluded.summary, updated_at=excluded.updated_at",
                params![bookmark_id.as_str(), summary, now],
            ).map_err(storage_error)?;
            Ok(())
        }).await
    }
}

fn setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, ErrorCode> {
    conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(storage_error)
}

fn put(conn: &rusqlite::Connection, key: &str, value: Option<String>) -> Result<(), ErrorCode> {
    if let Some(value) = value {
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        ).map_err(storage_error)?;
    } else {
        conn.execute("DELETE FROM settings WHERE key=?1", [key])
            .map_err(storage_error)?;
    }
    Ok(())
}
