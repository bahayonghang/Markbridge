use super::{Storage, storage_error};
use markbridge_protocol::{ErrorCode, Id, SourceEpoch, TagCommand};
use rusqlite::{OptionalExtension, params};

pub(super) fn sync_metadata_fts(
    conn: &rusqlite::Connection,
    bookmark_id: &str,
) -> Result<(), ErrorCode> {
    conn.execute(
        "DELETE FROM metadata_fts WHERE bookmark_id=?1",
        [bookmark_id],
    )
    .map_err(storage_error)?;
    conn.execute(
        "INSERT INTO metadata_fts(bookmark_id, profile_id, summary, note) SELECT m.bookmark_id, c.profile_id, COALESCE(m.summary, ''), COALESCE(m.note, '') FROM bookmark_metadata m JOIN bookmarks_cache c ON c.bookmark_id=m.bookmark_id WHERE m.bookmark_id=?1",
        [bookmark_id],
    )
    .map_err(storage_error)?;
    Ok(())
}

#[derive(Clone, Debug)]
pub(crate) struct MemberRow {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    pub title: String,
    pub url: Option<String>,
    pub note: String,
    #[allow(dead_code)]
    pub summary: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct Observation {
    pub url: String,
    pub class: String,
    pub http_status: Option<u16>,
    pub observed_at: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct TextHitRow {
    pub bookmark_id: Id,
    pub chrome_id: Id,
    pub title: String,
    pub summary: String,
    pub note: String,
}

impl Storage {
    pub(crate) async fn maintenance_members(
        &self,
        profile_id: Id,
        epoch: SourceEpoch,
    ) -> Result<Vec<MemberRow>, ErrorCode> {
        self.call(move |conn| {
            let mut statement = conn.prepare(
                "SELECT c.bookmark_id, c.chrome_id, c.title, c.url, COALESCE(m.note, ''), m.summary FROM bookmarks_cache c LEFT JOIN bookmark_metadata m ON m.bookmark_id=c.bookmark_id WHERE c.profile_id=?1 AND c.source_epoch=?2 AND c.deleted_at IS NULL ORDER BY c.chrome_id",
            ).map_err(storage_error)?;
            let rows = statement
                .query_map(params![profile_id.as_str(), epoch.get() as i64], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                })
                .map_err(storage_error)?;
            let mut members = Vec::new();
            for row in rows {
                let (bookmark, chrome, title, url, note, summary) = row.map_err(storage_error)?;
                let mut tags = conn.prepare(
                    "SELECT t.name FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id WHERE bt.bookmark_id=?1 ORDER BY t.normalized_name",
                ).map_err(storage_error)?;
                let names = tags
                    .query_map([&bookmark], |item| item.get::<_, String>(0))
                    .map_err(storage_error)?;
                let mut tag_names = Vec::new();
                for name in names {
                    tag_names.push(name.map_err(storage_error)?);
                }
                members.push(MemberRow {
                    bookmark_id: Id::new(bookmark)?,
                    chrome_id: Id::new(chrome)?,
                    title,
                    url,
                    note,
                    summary,
                    tags: tag_names,
                });
            }
            Ok(members)
        })
        .await
    }

    pub(crate) async fn insert_observation(
        &self,
        profile_id: Id,
        bookmark_id: Id,
        url: String,
        class: String,
        http_status: Option<u16>,
        observed_at: u64,
    ) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            conn.execute(
                "INSERT INTO link_observations(profile_id, bookmark_id, url, class, http_status, observed_at) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    profile_id.as_str(),
                    bookmark_id.as_str(),
                    url,
                    class,
                    http_status.map(i64::from),
                    observed_at as i64
                ],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn observations_for(
        &self,
        profile_id: Id,
        bookmark_id: Id,
    ) -> Result<Vec<Observation>, ErrorCode> {
        self.call(move |conn| {
            let mut statement = conn.prepare(
                "SELECT url, class, http_status, observed_at FROM link_observations WHERE profile_id=?1 AND bookmark_id=?2 ORDER BY observed_at, rowid",
            ).map_err(storage_error)?;
            let rows = statement
                .query_map(params![profile_id.as_str(), bookmark_id.as_str()], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(storage_error)?;
            let mut out = Vec::new();
            for row in rows {
                let (url, class, status, observed) = row.map_err(storage_error)?;
                out.push(Observation {
                    url,
                    class,
                    http_status: status.and_then(|value| u16::try_from(value).ok()),
                    observed_at: observed.max(0) as u64,
                });
            }
            Ok(out)
        })
        .await
    }

    pub(crate) async fn insert_merge(
        &self,
        operation_id: Id,
        profile_id: Id,
        keeper_chrome_id: Id,
        tag_names: Vec<String>,
    ) -> Result<(), ErrorCode> {
        let names = serde_json::to_string(&tag_names).map_err(|_| ErrorCode::StorageError)?;
        self.call(move |conn| {
            conn.execute(
                "INSERT INTO maintenance_merges(operation_id, profile_id, keeper_chrome_id, tag_names, added_tag_ids, applied) VALUES(?1,?2,?3,?4,'[]',0)",
                params![operation_id.as_str(), profile_id.as_str(), keeper_chrome_id.as_str(), names],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn delete_merge(&self, operation_id: Id) -> Result<(), ErrorCode> {
        self.call(move |conn| {
            conn.execute(
                "DELETE FROM maintenance_merges WHERE operation_id=?1",
                [operation_id.as_str()],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn apply_merge(&self, operation_id: Id) -> Result<(), ErrorCode> {
        let row = self.merge_row(operation_id.clone()).await?;
        let Some((profile_id, keeper, names, applied)) = row else {
            return Ok(());
        };
        if applied {
            return Ok(());
        }
        let before = self.tag_ids_for(profile_id.clone(), keeper.clone()).await?;
        for name in &names {
            self.mutate_tags(
                profile_id.clone(),
                TagCommand::Add {
                    chrome_ids: vec![keeper.clone()],
                    name: name.clone(),
                },
            )
            .await?;
        }
        let after = self.tag_ids_for(profile_id, keeper).await?;
        let added: Vec<String> = after
            .into_iter()
            .filter(|id| !before.iter().any(|old| old == id))
            .collect();
        let json = serde_json::to_string(&added).map_err(|_| ErrorCode::StorageError)?;
        self.call(move |conn| {
            conn.execute(
                "UPDATE maintenance_merges SET added_tag_ids=?2, applied=1 WHERE operation_id=?1 AND applied=0",
                params![operation_id.as_str(), json],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn reverse_merge(&self, operation_id: Id) -> Result<(), ErrorCode> {
        let found = self
            .call({
                let operation_id = operation_id.clone();
                move |conn| load_added(conn, &operation_id)
            })
            .await?;
        let Some((profile_id, keeper, tag_ids)) = found else {
            return Ok(());
        };
        for tag_id in tag_ids {
            self.mutate_tags(
                profile_id.clone(),
                TagCommand::Remove {
                    chrome_ids: vec![keeper.clone()],
                    tag_id: Id::new(tag_id)?,
                },
            )
            .await?;
        }
        self.call(move |conn| {
            conn.execute(
                "UPDATE maintenance_merges SET applied=0 WHERE operation_id=?1",
                [operation_id.as_str()],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub(crate) async fn search_text(
        &self,
        profile_id: Id,
        query: String,
    ) -> Result<Vec<TextHitRow>, ErrorCode> {
        self.call(move |conn| search_text(conn, &profile_id, &query))
            .await
    }

    #[cfg(test)]
    pub(crate) async fn rebuild_text_index(&self) -> Result<(), ErrorCode> {
        self.call(|conn| {
            conn.execute("DELETE FROM metadata_fts", [])
                .map_err(storage_error)?;
            conn.execute(
                "INSERT INTO metadata_fts(bookmark_id, profile_id, summary, note) SELECT m.bookmark_id, c.profile_id, COALESCE(m.summary, ''), COALESCE(m.note, '') FROM bookmark_metadata m JOIN bookmarks_cache c ON c.bookmark_id=m.bookmark_id",
                [],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    async fn merge_row(
        &self,
        operation_id: Id,
    ) -> Result<Option<(Id, Id, Vec<String>, bool)>, ErrorCode> {
        self.call(move |conn| {
            let row = conn
                .query_row(
                    "SELECT profile_id, keeper_chrome_id, tag_names, applied FROM maintenance_merges WHERE operation_id=?1",
                    [operation_id.as_str()],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?)),
                )
                .optional()
                .map_err(storage_error)?;
            let Some((profile, keeper, names, applied)) = row else {
                return Ok(None);
            };
            let names: Vec<String> = serde_json::from_str(&names).map_err(|_| ErrorCode::StorageError)?;
            Ok(Some((Id::new(profile)?, Id::new(keeper)?, names, applied == 1)))
        })
        .await
    }

    async fn tag_ids_for(&self, profile_id: Id, chrome_id: Id) -> Result<Vec<String>, ErrorCode> {
        self.call(move |conn| {
            let bookmark = conn
                .query_row(
                    "SELECT c.bookmark_id FROM bookmarks_cache c JOIN profiles p ON p.id=c.profile_id AND p.source_epoch=c.source_epoch WHERE c.profile_id=?1 AND c.chrome_id=?2 AND c.deleted_at IS NULL",
                    params![profile_id.as_str(), chrome_id.as_str()],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(storage_error)?;
            let Some(bookmark) = bookmark else {
                return Ok(Vec::new());
            };
            let mut statement = conn
                .prepare("SELECT tag_id FROM bookmark_tags WHERE bookmark_id=?1 ORDER BY tag_id")
                .map_err(storage_error)?;
            let rows = statement
                .query_map([bookmark], |row| row.get::<_, String>(0))
                .map_err(storage_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
        })
        .await
    }
}

fn load_added(
    conn: &rusqlite::Connection,
    operation_id: &Id,
) -> Result<Option<(Id, Id, Vec<String>)>, ErrorCode> {
    let row = conn
        .query_row(
            "SELECT profile_id, keeper_chrome_id, added_tag_ids, applied FROM maintenance_merges WHERE operation_id=?1",
            [operation_id.as_str()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?)),
        )
        .optional()
        .map_err(storage_error)?;
    let Some((profile, keeper, ids, applied)) = row else {
        return Ok(None);
    };
    if applied != 1 {
        return Ok(None);
    }
    let ids: Vec<String> = serde_json::from_str(&ids).map_err(|_| ErrorCode::StorageError)?;
    Ok(Some((Id::new(profile)?, Id::new(keeper)?, ids)))
}

fn search_text(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    query: &str,
) -> Result<Vec<TextHitRow>, ErrorCode> {
    let chars = query.chars().count();
    if chars == 0 {
        return Ok(Vec::new());
    }
    if chars < 3 {
        let pattern = like_pattern(query);
        let mut statement = conn.prepare(
            "SELECT c.bookmark_id, c.chrome_id, c.title, COALESCE(m.summary, ''), COALESCE(m.note, '') FROM bookmark_metadata m JOIN bookmarks_cache c ON c.bookmark_id=m.bookmark_id JOIN profiles p ON p.id=c.profile_id AND p.source_epoch=c.source_epoch WHERE c.profile_id=?1 AND c.deleted_at IS NULL AND (COALESCE(m.summary, '') LIKE ?2 ESCAPE '\\' OR m.note LIKE ?2 ESCAPE '\\') ORDER BY c.chrome_id LIMIT 50",
        ).map_err(storage_error)?;
        return map_hits(
            statement
                .query_map(params![profile_id.as_str(), pattern], hit_row)
                .map_err(storage_error)?,
        );
    }
    let match_query = fts_query(query);
    let mut statement = conn.prepare(
        "SELECT c.bookmark_id, c.chrome_id, c.title, COALESCE(m.summary, ''), COALESCE(m.note, '') FROM metadata_fts JOIN bookmarks_cache c ON c.bookmark_id=metadata_fts.bookmark_id JOIN bookmark_metadata m ON m.bookmark_id=c.bookmark_id JOIN profiles p ON p.id=c.profile_id AND p.source_epoch=c.source_epoch WHERE metadata_fts MATCH ?2 AND metadata_fts.profile_id=?1 AND c.profile_id=?1 AND c.deleted_at IS NULL ORDER BY c.chrome_id LIMIT 50",
    ).map_err(storage_error)?;
    map_hits(
        statement
            .query_map(params![profile_id.as_str(), match_query], hit_row)
            .map_err(storage_error)?,
    )
}

fn hit_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, String, String)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}

fn map_hits<F>(rows: rusqlite::MappedRows<'_, F>) -> Result<Vec<TextHitRow>, ErrorCode>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, String, String)>,
{
    let mut hits = Vec::new();
    for row in rows {
        let (bookmark, chrome, title, summary, note) = row.map_err(storage_error)?;
        hits.push(TextHitRow {
            bookmark_id: Id::new(bookmark)?,
            chrome_id: Id::new(chrome)?,
            title,
            summary,
            note,
        });
    }
    Ok(hits)
}

fn like_pattern(query: &str) -> String {
    let mut out = String::from('%');
    for ch in query.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

fn fts_query(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}
