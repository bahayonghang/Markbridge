use super::{Storage, storage_error};
use markbridge_protocol::{ErrorCode, Id};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

const READY: &str = "ready";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LiveBookmark {
    pub bookmark_id: Id,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct SafeMeta {
    title: Option<String>,
    summary_source: Option<String>,
    image_media_type: Option<String>,
    image_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredPreview {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub summary_source: Option<String>,
    pub image_base64: Option<String>,
    pub image_media_type: Option<String>,
    pub image_label: Option<String>,
    pub fetched_at: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct NewPreview {
    pub bookmark_id: Id,
    pub fingerprint: String,
    pub stored: StoredPreview,
    pub size: i64,
}

impl Storage {
    pub(crate) async fn live_bookmark(
        &self,
        profile_id: Id,
        chrome_id: Id,
    ) -> Result<Option<LiveBookmark>, ErrorCode> {
        self.call(move |conn| {
            let row = conn
                .query_row(
                    "SELECT b.bookmark_id, b.url FROM bookmarks_cache b JOIN profiles p ON p.id=b.profile_id AND p.source_epoch=b.source_epoch WHERE b.profile_id=?1 AND b.chrome_id=?2 AND b.deleted_at IS NULL",
                    params![profile_id.as_str(), chrome_id.as_str()],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(storage_error)?;
            row.map(|(id, url)| Ok(LiveBookmark { bookmark_id: Id::new(id)?, url }))
                .transpose()
        })
        .await
    }

    pub(crate) async fn read_preview(
        &self,
        bookmark_id: Id,
        fingerprint: String,
        now: i64,
    ) -> Result<Option<StoredPreview>, ErrorCode> {
        self.call(move |conn| {
            let row = conn
                .query_row(
                    "SELECT status, safe_metadata, text_excerpt, image_reference, fetched_at FROM preview_cache WHERE bookmark_id=?1 AND url_fingerprint=?2",
                    params![bookmark_id.as_str(), fingerprint],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<i64>>(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(storage_error)?;
            let Some((status, meta, excerpt, image, fetched)) = row else {
                return Ok(None);
            };
            if status != READY {
                return Ok(None);
            }
            let Some(fetched_at) = fetched.filter(|value| *value >= 0) else {
                return Ok(None);
            };
            conn.execute(
                "UPDATE preview_cache SET last_used=?2 WHERE bookmark_id=?1",
                params![bookmark_id.as_str(), now],
            )
            .map_err(storage_error)?;
            Ok(Some(decode_row(meta, excerpt, image, fetched_at as u64)?))
        })
        .await
    }

    pub(crate) async fn write_preview(&self, row: NewPreview, limit: i64) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            let meta = serde_json::to_string(&SafeMeta {
                title: row.stored.title,
                summary_source: row.stored.summary_source,
                image_media_type: row.stored.image_media_type,
                image_label: row.stored.image_label,
            })
            .map_err(|_| ErrorCode::StorageError)?;
            let image = row.stored.image_base64.map(|value| format!("base64:{value}"));
            let fetched = i64::try_from(row.stored.fetched_at).map_err(|_| ErrorCode::StorageError)?;
            conn.execute(
                "INSERT INTO preview_cache(bookmark_id,url_fingerprint,status,safe_metadata,text_excerpt,image_reference,fetched_at,size,last_used) VALUES(?1,?2,'ready',?3,?4,?5,?6,?7,?8) ON CONFLICT(bookmark_id) DO UPDATE SET url_fingerprint=excluded.url_fingerprint,status=excluded.status,safe_metadata=excluded.safe_metadata,text_excerpt=excluded.text_excerpt,image_reference=excluded.image_reference,fetched_at=excluded.fetched_at,size=excluded.size,last_used=excluded.last_used",
                params![row.bookmark_id.as_str(), row.fingerprint, meta, row.stored.summary, image, fetched, row.size, fetched],
            )
            .map_err(storage_error)?;
            evict(conn, limit, row.bookmark_id.as_str())?;
            Ok(())
        })
        .await
    }
}

fn decode_row(
    meta: Option<String>,
    excerpt: Option<String>,
    image: Option<String>,
    fetched_at: u64,
) -> Result<StoredPreview, ErrorCode> {
    let meta = match meta {
        Some(value) => {
            serde_json::from_str::<SafeMeta>(&value).map_err(|_| ErrorCode::StorageError)?
        }
        None => SafeMeta {
            title: None,
            summary_source: None,
            image_media_type: None,
            image_label: None,
        },
    };
    let image_base64 = match image {
        Some(value) => Some(value.strip_prefix("base64:").unwrap_or("").to_owned())
            .filter(|value| !value.is_empty()),
        None => None,
    };
    Ok(StoredPreview {
        title: meta.title,
        summary: excerpt,
        summary_source: meta.summary_source,
        image_base64,
        image_media_type: meta.image_media_type,
        image_label: meta.image_label,
        fetched_at,
    })
}

fn evict(conn: &rusqlite::Connection, limit: i64, keep: &str) -> Result<(), ErrorCode> {
    loop {
        let total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(size),0) FROM preview_cache",
                [],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        if total <= limit {
            return Ok(());
        }
        let victim: Option<String> = conn
            .query_row(
                "SELECT bookmark_id FROM preview_cache WHERE bookmark_id<>?1 ORDER BY last_used ASC, bookmark_id ASC LIMIT 1",
                [keep],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        let Some(victim) = victim else {
            return Ok(());
        };
        conn.execute("DELETE FROM preview_cache WHERE bookmark_id=?1", [victim])
            .map_err(storage_error)?;
    }
}
