use super::{Result, Storage, storage_error};
use crate::tags;
use markbridge_protocol::{
    BookmarkNode, Counter, ErrorCode, Id, RequiredNullable, TagCatalog, TagCommand, TagEntry,
    TagItem,
};
use rand::TryRngCore;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize)]
struct Snap {
    bookmark_ids: Vec<String>,
    tag_ids: Vec<String>,
    notes: Vec<NoteSnap>,
    tags: Vec<TagSnap>,
    links: Vec<LinkSnap>,
}
#[derive(Serialize, Deserialize)]
struct NoteSnap {
    bookmark_id: String,
    note: String,
}
#[derive(Serialize, Deserialize)]
struct TagSnap {
    id: String,
    name: String,
    normalized: String,
}
#[derive(Serialize, Deserialize)]
struct LinkSnap {
    bookmark_id: String,
    tag_id: String,
}
struct Outcome {
    affected: u64,
    merge_required: bool,
    source: Option<Id>,
    target: Option<Id>,
}

impl Storage {
    pub async fn tag_catalog(
        &self,
        profile_id: Id,
        chrome_ids: Vec<Id>,
        filter_tag_id: Option<Id>,
    ) -> Result<TagCatalog> {
        self.call(move |conn| read_catalog(conn, &profile_id, &chrome_ids, filter_tag_id.as_ref()))
            .await
    }

    pub async fn mutate_tags(&self, profile_id: Id, command: TagCommand) -> Result<TagCatalog> {
        self.call(move |conn| {
            let transaction = conn.transaction().map_err(storage_error)?;
            let outcome = apply(&transaction, &profile_id, &command)?;
            let mut catalog = read_catalog(&transaction, &profile_id, command_ids(&command), None)?;
            catalog.affected = Counter::new(outcome.affected)?;
            catalog.merge_required = outcome.merge_required;
            catalog.source_tag_id = RequiredNullable(outcome.source);
            catalog.target_tag_id = RequiredNullable(outcome.target);
            transaction.commit().map_err(storage_error)?;
            Ok(catalog)
        })
        .await
    }

    pub async fn record_title_encoding(
        &self,
        bookmark_id: Id,
        raw_title: String,
        last_encoded_title: Option<String>,
        now: u64,
    ) -> Result<()> {
        self.call(move |conn| {
            conn.execute(
                "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,raw_title,last_encoded_title,updated_at) VALUES(?1,NULL,NULL,'',?2,?3,?4) ON CONFLICT(bookmark_id) DO UPDATE SET raw_title=excluded.raw_title,last_encoded_title=excluded.last_encoded_title,updated_at=excluded.updated_at",
                params![bookmark_id.as_str(), raw_title, last_encoded_title, now as i64],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }
}

fn command_ids(command: &TagCommand) -> &[Id] {
    match command {
        TagCommand::SetNote { chrome_ids, .. }
        | TagCommand::Add { chrome_ids, .. }
        | TagCommand::Remove { chrome_ids, .. } => chrome_ids,
        _ => &[],
    }
}

fn apply(conn: &rusqlite::Connection, profile_id: &Id, command: &TagCommand) -> Result<Outcome> {
    let epoch = epoch_of(conn, profile_id)?;
    match command {
        TagCommand::SetNote { chrome_ids, note } => {
            set_note(conn, profile_id, epoch, chrome_ids, note)
        }
        TagCommand::Add { chrome_ids, name } => add_tag(conn, profile_id, epoch, chrome_ids, name),
        TagCommand::Remove { chrome_ids, tag_id } => {
            remove_tag(conn, profile_id, epoch, chrome_ids, tag_id)
        }
        TagCommand::Rename { tag_id, name } => rename_tag(conn, profile_id, epoch, tag_id, name),
        TagCommand::Merge {
            source_id,
            target_id,
        } => merge_tags(conn, profile_id, epoch, source_id, target_id),
        TagCommand::Delete { tag_id } => delete_tag(conn, profile_id, epoch, tag_id),
        TagCommand::Undo { journal_id } => undo(conn, profile_id, epoch, journal_id),
        TagCommand::SetEncoding { enabled } => {
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![encoding_key(profile_id), if *enabled { "on" } else { "off" }],
            )
            .map_err(storage_error)?;
            Ok(clean())
        }
    }
}

fn set_note(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    chrome_ids: &[Id],
    note: &str,
) -> Result<Outcome> {
    tags::note_ok(note)?;
    let bookmarks = resolve(conn, profile_id, epoch, chrome_ids)?;
    let mut changed = Vec::new();
    for bookmark in bookmarks {
        if current_note(conn, &bookmark)? != note {
            changed.push(bookmark);
        }
    }
    if changed.is_empty() {
        return Ok(clean());
    }
    let snap = capture(conn, &changed, &[])?;
    let now = now_millis()?;
    for bookmark in &changed {
        conn.execute(
            "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,updated_at) VALUES(?1,NULL,NULL,?2,?3) ON CONFLICT(bookmark_id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at",
            params![bookmark, note, now],
        )
        .map_err(storage_error)?;
    }
    write_journal(conn, profile_id, &snap)?;
    Ok(affected(changed.len() as u64))
}

fn add_tag(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    chrome_ids: &[Id],
    name: &str,
) -> Result<Outcome> {
    let normalized = tags::normalize_tag(name)?;
    let bookmarks = resolve(conn, profile_id, epoch, chrome_ids)?;
    let existing = tag_by_key(conn, &normalized.key)?;
    let tag_id = if let Some(tag) = &existing {
        tag.id.clone()
    } else {
        new_id("tag")?.as_str().to_owned()
    };
    let mut fresh = Vec::new();
    for bookmark in bookmarks {
        if !linked(conn, &bookmark, &tag_id)? {
            fresh.push(bookmark);
        }
    }
    if existing.is_some() && fresh.is_empty() {
        return Ok(clean());
    }
    for bookmark in &fresh {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bookmark_tags WHERE bookmark_id=?1",
                [bookmark],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        if count as usize >= tags::TAGS_PER_BOOKMARK {
            return Err(ErrorCode::LimitExceeded);
        }
    }
    let snap = capture(conn, &fresh, std::slice::from_ref(&tag_id))?;
    if existing.is_none() {
        conn.execute(
            "INSERT INTO tags(id,name,normalized_name) VALUES(?1,?2,?3)",
            params![tag_id, normalized.display, normalized.key],
        )
        .map_err(storage_error)?;
    }
    for bookmark in &fresh {
        conn.execute(
            "INSERT INTO bookmark_tags(bookmark_id,tag_id) VALUES(?1,?2)",
            params![bookmark, tag_id],
        )
        .map_err(storage_error)?;
    }
    write_journal(conn, profile_id, &snap)?;
    Ok(affected(fresh.len() as u64))
}

fn remove_tag(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    chrome_ids: &[Id],
    tag_id: &Id,
) -> Result<Outcome> {
    let bookmarks = resolve(conn, profile_id, epoch, chrome_ids)?;
    if tag_row(conn, tag_id.as_str())?.is_none() {
        return Err(ErrorCode::InvalidMessage);
    }
    let mut present = Vec::new();
    for bookmark in bookmarks {
        if linked(conn, &bookmark, tag_id.as_str())? {
            present.push(bookmark);
        }
    }
    if present.is_empty() {
        return Ok(clean());
    }
    let snap = capture(conn, &present, &[tag_id.as_str().to_owned()])?;
    for bookmark in &present {
        conn.execute(
            "DELETE FROM bookmark_tags WHERE bookmark_id=?1 AND tag_id=?2",
            params![bookmark, tag_id.as_str()],
        )
        .map_err(storage_error)?;
    }
    delete_tag_if_unused(conn, tag_id.as_str())?;
    write_journal(conn, profile_id, &snap)?;
    Ok(affected(present.len() as u64))
}

fn rename_tag(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    tag_id: &Id,
    name: &str,
) -> Result<Outcome> {
    let normalized = tags::normalize_tag(name)?;
    let Some(tag) = tag_row(conn, tag_id.as_str())? else {
        return Err(ErrorCode::InvalidMessage);
    };
    if tag.name == normalized.display && tag.normalized == normalized.key {
        return Ok(clean());
    }
    if let Some(other) = tag_by_key(conn, &normalized.key)?
        && other.id != tag.id
    {
        let bookmarks = bookmarks_with_tag(conn, profile_id, epoch, &tag.id)?;
        return Ok(Outcome {
            affected: bookmarks.len() as u64,
            merge_required: true,
            source: Some(Id::new(tag.id)?),
            target: Some(Id::new(other.id)?),
        });
    }
    let bookmarks = bookmarks_with_tag(conn, profile_id, epoch, tag_id.as_str())?;
    let snap = capture(conn, &bookmarks, std::slice::from_ref(&tag.id))?;
    conn.execute(
        "UPDATE tags SET name=?2,normalized_name=?3 WHERE id=?1",
        params![tag.id, normalized.display, normalized.key],
    )
    .map_err(storage_error)?;
    write_journal(conn, profile_id, &snap)?;
    Ok(affected(bookmarks.len().max(1) as u64))
}

fn merge_tags(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    source_id: &Id,
    target_id: &Id,
) -> Result<Outcome> {
    if source_id == target_id
        || tag_row(conn, source_id.as_str())?.is_none()
        || tag_row(conn, target_id.as_str())?.is_none()
    {
        return Err(ErrorCode::InvalidMessage);
    }
    let mut bookmarks = bookmarks_with_tag(conn, profile_id, epoch, source_id.as_str())?;
    for bookmark in bookmarks_with_tag(conn, profile_id, epoch, target_id.as_str())? {
        if !bookmarks.contains(&bookmark) {
            bookmarks.push(bookmark);
        }
    }
    let mut moved = 0;
    for bookmark in &bookmarks {
        if linked(conn, bookmark, source_id.as_str())? {
            moved += 1;
        }
    }
    if moved == 0 {
        return Ok(clean());
    }
    let snap = capture(
        conn,
        &bookmarks,
        &[source_id.as_str().to_owned(), target_id.as_str().to_owned()],
    )?;
    for bookmark in &bookmarks {
        if linked(conn, bookmark, source_id.as_str())?
            && linked(conn, bookmark, target_id.as_str())?
        {
            conn.execute(
                "DELETE FROM bookmark_tags WHERE bookmark_id=?1 AND tag_id=?2",
                params![bookmark, source_id.as_str()],
            )
            .map_err(storage_error)?;
        } else if linked(conn, bookmark, source_id.as_str())? {
            conn.execute(
                "UPDATE bookmark_tags SET tag_id=?3 WHERE bookmark_id=?1 AND tag_id=?2",
                params![bookmark, source_id.as_str(), target_id.as_str()],
            )
            .map_err(storage_error)?;
        }
    }
    delete_tag_if_unused(conn, source_id.as_str())?;
    write_journal(conn, profile_id, &snap)?;
    Ok(affected(moved as u64))
}

fn delete_tag(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    tag_id: &Id,
) -> Result<Outcome> {
    if tag_row(conn, tag_id.as_str())?.is_none() {
        return Err(ErrorCode::InvalidMessage);
    }
    let bookmarks = bookmarks_with_tag(conn, profile_id, epoch, tag_id.as_str())?;
    if bookmarks.is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    let snap = capture(conn, &bookmarks, &[tag_id.as_str().to_owned()])?;
    for bookmark in &bookmarks {
        conn.execute(
            "DELETE FROM bookmark_tags WHERE bookmark_id=?1 AND tag_id=?2",
            params![bookmark, tag_id.as_str()],
        )
        .map_err(storage_error)?;
    }
    delete_tag_if_unused(conn, tag_id.as_str())?;
    write_journal(conn, profile_id, &snap)?;
    Ok(affected(bookmarks.len() as u64))
}

fn undo(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    journal_id: &Id,
) -> Result<Outcome> {
    let latest: Option<String> = conn
        .query_row(
            "SELECT journal_id FROM tag_journal WHERE profile_id=?1 AND undone=0 ORDER BY rowid DESC LIMIT 1",
            [profile_id.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    if latest.as_deref() != Some(journal_id.as_str()) {
        return Err(ErrorCode::Conflict);
    }
    let json: String = conn
        .query_row(
            "SELECT before_json FROM tag_journal WHERE journal_id=?1",
            [journal_id.as_str()],
            |row| row.get(0),
        )
        .map_err(|_| ErrorCode::InvalidMessage)?;
    let snap: Snap = serde_json::from_str(&json).map_err(|_| ErrorCode::StorageError)?;
    restore(conn, epoch, &snap)?;
    conn.execute(
        "UPDATE tag_journal SET undone=1 WHERE journal_id=?1",
        [journal_id.as_str()],
    )
    .map_err(storage_error)?;
    Ok(affected(snap.bookmark_ids.len() as u64))
}

fn restore(conn: &rusqlite::Connection, _epoch: i64, snap: &Snap) -> Result<()> {
    for tag in &snap.tags {
        conn.execute(
            "INSERT INTO tags(id,name,normalized_name) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name",
            params![tag.id, tag.name, tag.normalized],
        )
        .map_err(storage_error)?;
    }
    for bookmark in &snap.bookmark_ids {
        conn.execute("DELETE FROM bookmark_tags WHERE bookmark_id=?1", [bookmark])
            .map_err(storage_error)?;
    }
    for link in &snap.links {
        conn.execute(
            "INSERT INTO bookmark_tags(bookmark_id,tag_id) VALUES(?1,?2)",
            params![link.bookmark_id, link.tag_id],
        )
        .map_err(storage_error)?;
    }
    for tag_id in &snap.tag_ids {
        if snap.tags.iter().all(|tag| tag.id != *tag_id) {
            delete_tag_if_unused(conn, tag_id)?;
        }
    }
    let now = now_millis()?;
    for note in &snap.notes {
        conn.execute(
            "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,updated_at) VALUES(?1,NULL,NULL,?2,?3) ON CONFLICT(bookmark_id) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at",
            params![note.bookmark_id, note.note, now],
        )
        .map_err(storage_error)?;
    }
    Ok(())
}

fn read_catalog(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    chrome_ids: &[Id],
    filter_tag_id: Option<&Id>,
) -> Result<TagCatalog> {
    bound_ids(chrome_ids)?;
    let epoch = epoch_of(conn, profile_id)?;
    let enabled = encoding_enabled(conn, profile_id)?;
    let journal = latest_journal(conn, profile_id)?;
    let mut tags = Vec::new();
    let mut statement = conn
        .prepare(
            "SELECT t.id,t.name,COUNT(*) FROM tags t JOIN bookmark_tags bt ON bt.tag_id=t.id JOIN bookmarks_cache c ON c.bookmark_id=bt.bookmark_id WHERE c.profile_id=?1 AND c.source_epoch=?2 AND c.deleted_at IS NULL GROUP BY t.id,t.name,t.normalized_name ORDER BY t.normalized_name",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![profile_id.as_str(), epoch], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(storage_error)?;
    for row in rows {
        let (id, name, count) = row.map_err(storage_error)?;
        tags.push(TagItem {
            tag_id: Id::new(id)?,
            name,
            count: Counter::new(count as u64)?,
        });
    }
    drop(statement);
    let mut entries = Vec::new();
    for chrome_id in chrome_ids {
        entries.push(entry(conn, profile_id, epoch, chrome_id)?);
    }
    let matches = match filter_tag_id {
        Some(tag_id) => filter_nodes(conn, profile_id, epoch, tag_id)?,
        None => Vec::new(),
    };
    Ok(TagCatalog {
        profile_id: profile_id.clone(),
        encoding_enabled: enabled,
        journal_id: RequiredNullable(journal),
        affected: Counter::new(0)?,
        merge_required: false,
        source_tag_id: RequiredNullable(None),
        target_tag_id: RequiredNullable(None),
        filter_tag_id: RequiredNullable(filter_tag_id.cloned()),
        tags,
        entries,
        matches,
    })
}

fn entry(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    chrome_id: &Id,
) -> Result<TagEntry> {
    let bookmark_id = resolve(conn, profile_id, epoch, std::slice::from_ref(chrome_id))?.remove(0);
    let (note, raw, last, title) = conn
        .query_row(
            "SELECT COALESCE(m.note,''),m.raw_title,m.last_encoded_title,c.title FROM bookmarks_cache c LEFT JOIN bookmark_metadata m ON m.bookmark_id=c.bookmark_id WHERE c.bookmark_id=?1",
            [&bookmark_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, String>(3)?)),
        )
        .map_err(storage_error)?;
    let mut statement = conn
        .prepare(
            "SELECT t.id FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id WHERE bt.bookmark_id=?1 ORDER BY t.normalized_name",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map([&bookmark_id], |row| row.get::<_, String>(0))
        .map_err(storage_error)?;
    let mut tag_ids = Vec::new();
    for row in rows {
        tag_ids.push(Id::new(row.map_err(storage_error)?)?);
    }
    Ok(TagEntry {
        bookmark_id: Id::new(bookmark_id)?,
        chrome_id: chrome_id.clone(),
        note,
        tag_ids,
        conflict: last.as_ref().is_some_and(|encoded| encoded != &title),
        raw_title: RequiredNullable(raw),
        last_encoded_title: RequiredNullable(last),
    })
}

fn filter_nodes(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    tag_id: &Id,
) -> Result<Vec<BookmarkNode>> {
    let mut statement = conn
        .prepare(
            "SELECT c.node_json FROM bookmark_tags bt JOIN bookmarks_cache c ON c.bookmark_id=bt.bookmark_id WHERE bt.tag_id=?1 AND c.profile_id=?2 AND c.source_epoch=?3 AND c.deleted_at IS NULL ORDER BY c.chrome_id",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(
            params![tag_id.as_str(), profile_id.as_str(), epoch],
            |row| row.get::<_, String>(0),
        )
        .map_err(storage_error)?;
    let mut nodes = Vec::new();
    for row in rows {
        nodes.push(
            serde_json::from_str(&row.map_err(storage_error)?)
                .map_err(|_| ErrorCode::StorageError)?,
        );
        if nodes.len() > 100_000 {
            return Err(ErrorCode::LimitExceeded);
        }
    }
    Ok(nodes)
}

fn capture(
    conn: &rusqlite::Connection,
    bookmark_ids: &[String],
    tag_ids: &[String],
) -> Result<Snap> {
    let notes = bookmark_ids
        .iter()
        .map(|bookmark_id| {
            Ok(NoteSnap {
                note: current_note(conn, bookmark_id)?,
                bookmark_id: bookmark_id.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let mut tags = Vec::new();
    for tag_id in tag_ids {
        if let Some(tag) = tag_row(conn, tag_id)? {
            tags.push(tag);
        }
    }
    let mut links = Vec::new();
    for bookmark_id in bookmark_ids {
        let mut statement = conn
            .prepare("SELECT tag_id FROM bookmark_tags WHERE bookmark_id=?1 ORDER BY tag_id")
            .map_err(storage_error)?;
        let rows = statement
            .query_map([bookmark_id], |row| row.get::<_, String>(0))
            .map_err(storage_error)?;
        for row in rows {
            links.push(LinkSnap {
                bookmark_id: bookmark_id.clone(),
                tag_id: row.map_err(storage_error)?,
            });
        }
    }
    Ok(Snap {
        bookmark_ids: bookmark_ids.to_vec(),
        tag_ids: tag_ids.to_vec(),
        notes,
        tags,
        links,
    })
}

fn write_journal(conn: &rusqlite::Connection, profile_id: &Id, snap: &Snap) -> Result<Id> {
    let journal_id = new_id("journal")?;
    let json = serde_json::to_string(snap).map_err(|_| ErrorCode::StorageError)?;
    conn.execute(
        "INSERT INTO tag_journal(journal_id,profile_id,created_at,undone,before_json) VALUES(?1,?2,?3,0,?4)",
        params![journal_id.as_str(), profile_id.as_str(), now_millis()?, json],
    )
    .map_err(storage_error)?;
    Ok(journal_id)
}

fn resolve(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    chrome_ids: &[Id],
) -> Result<Vec<String>> {
    require_ids(chrome_ids)?;
    let mut bookmarks = Vec::new();
    for chrome_id in chrome_ids {
        let bookmark = conn
            .query_row(
                "SELECT bookmark_id FROM bookmarks_cache WHERE profile_id=?1 AND source_epoch=?2 AND chrome_id=?3 AND deleted_at IS NULL",
                params![profile_id.as_str(), epoch, chrome_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        bookmarks.push(bookmark.ok_or(ErrorCode::InvalidMessage)?);
    }
    Ok(bookmarks)
}

fn bookmarks_with_tag(
    conn: &rusqlite::Connection,
    profile_id: &Id,
    epoch: i64,
    tag_id: &str,
) -> Result<Vec<String>> {
    let mut statement = conn
        .prepare(
            "SELECT bt.bookmark_id FROM bookmark_tags bt JOIN bookmarks_cache c ON c.bookmark_id=bt.bookmark_id WHERE bt.tag_id=?1 AND c.profile_id=?2 AND c.source_epoch=?3 AND c.deleted_at IS NULL ORDER BY c.chrome_id",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![tag_id, profile_id.as_str(), epoch], |row| {
            row.get::<_, String>(0)
        })
        .map_err(storage_error)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(storage_error)
}

fn current_note(conn: &rusqlite::Connection, bookmark_id: &str) -> Result<String> {
    let note = conn
        .query_row(
            "SELECT note FROM bookmark_metadata WHERE bookmark_id=?1",
            [bookmark_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage_error)?;
    Ok(note.unwrap_or_default())
}

fn linked(conn: &rusqlite::Connection, bookmark_id: &str, tag_id: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM bookmark_tags WHERE bookmark_id=?1 AND tag_id=?2",
            params![bookmark_id, tag_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(storage_error)?
        .is_some())
}

fn tag_row(conn: &rusqlite::Connection, tag_id: &str) -> Result<Option<TagSnap>> {
    conn.query_row(
        "SELECT id,name,normalized_name FROM tags WHERE id=?1",
        [tag_id],
        |row| {
            Ok(TagSnap {
                id: row.get(0)?,
                name: row.get(1)?,
                normalized: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(storage_error)
}

fn tag_by_key(conn: &rusqlite::Connection, key: &str) -> Result<Option<TagSnap>> {
    conn.query_row(
        "SELECT id,name,normalized_name FROM tags WHERE normalized_name=?1",
        [key],
        |row| {
            Ok(TagSnap {
                id: row.get(0)?,
                name: row.get(1)?,
                normalized: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(storage_error)
}

fn delete_tag_if_unused(conn: &rusqlite::Connection, tag_id: &str) -> Result<()> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bookmark_tags WHERE tag_id=?1",
            [tag_id],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    if count == 0 {
        conn.execute("DELETE FROM tags WHERE id=?1", [tag_id])
            .map_err(storage_error)?;
    }
    Ok(())
}

fn encoding_enabled(conn: &rusqlite::Connection, profile_id: &Id) -> Result<bool> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [encoding_key(profile_id)],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    Ok(value.as_deref() == Some("on"))
}

fn latest_journal(conn: &rusqlite::Connection, profile_id: &Id) -> Result<Option<Id>> {
    let value: Option<String> = conn
        .query_row(
            "SELECT journal_id FROM tag_journal WHERE profile_id=?1 AND undone=0 ORDER BY rowid DESC LIMIT 1",
            [profile_id.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    value.map(Id::new).transpose()
}

fn epoch_of(conn: &rusqlite::Connection, profile_id: &Id) -> Result<i64> {
    conn.query_row(
        "SELECT source_epoch FROM profiles WHERE id=?1",
        [profile_id.as_str()],
        |row| row.get(0),
    )
    .optional()
    .map_err(storage_error)?
    .ok_or(ErrorCode::WrongProfile)
}

fn encoding_key(profile_id: &Id) -> String {
    format!("title-encoding-{}", profile_id.as_str())
}

fn require_ids(ids: &[Id]) -> Result<()> {
    if ids.is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    bound_ids(ids)
}

fn bound_ids(ids: &[Id]) -> Result<()> {
    if ids.len() > 1_000 {
        Err(ErrorCode::LimitExceeded)
    } else {
        Ok(())
    }
}

fn clean() -> Outcome {
    Outcome {
        affected: 0,
        merge_required: false,
        source: None,
        target: None,
    }
}

fn affected(affected: u64) -> Outcome {
    Outcome {
        affected,
        merge_required: false,
        source: None,
        target: None,
    }
}

fn new_id(prefix: &str) -> Result<Id> {
    let mut bytes = [0_u8; 16];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| ErrorCode::StorageError)?;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    Id::new(format!("{prefix}-{hex}"))
}

fn now_millis() -> Result<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::StorageError)?
        .as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::Bridge;
    use crate::bridge::credentials::CredentialStore;
    use crate::storage::{AfterBody, IdMapBody, PairedOrigin, Profile, Storage};
    use markbridge_protocol::{
        BookmarkNode, DisplayName, FolderType, NodeKind, Position, SourceEpoch, TagCommand, Title,
        TreeSnapshot, Url,
    };
    use std::sync::Arc;

    fn pid(value: &str) -> Id {
        Id::new(value).unwrap()
    }
    fn profile(name: &str) -> Profile {
        Profile {
            id: pid(name),
            instance_id: pid(&format!("instance-{name}")),
            source_epoch: SourceEpoch::new(1).unwrap(),
            display_name: DisplayName::new(name).unwrap(),
            paired_origin: PairedOrigin::new("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .unwrap(),
            credential_reference: None,
        }
    }
    fn bookmark(id: &str, parent: &str, position: u64, title: &str) -> BookmarkNode {
        BookmarkNode {
            chrome_id: pid(id),
            parent_id: Some(pid(parent)),
            position: Position::new(position).unwrap(),
            kind: NodeKind::Bookmark,
            title: Title::new(title).unwrap(),
            url: Some(Url::new("https://example.com/item").unwrap()),
            folder_type: None,
            unmodifiable: None,
            date_added: None,
            date_last_used: None,
        }
    }
    fn folder(id: &str, parent: Option<&str>, position: u64, title: &str) -> BookmarkNode {
        BookmarkNode {
            chrome_id: pid(id),
            parent_id: parent.map(pid),
            position: Position::new(position).unwrap(),
            kind: NodeKind::Folder,
            title: Title::new(title).unwrap(),
            url: None,
            folder_type: if parent.is_none() {
                Some(FolderType::BookmarksBar)
            } else {
                None
            },
            unmodifiable: None,
            date_added: None,
            date_last_used: None,
        }
    }
    fn sample(left: &str, right: &str) -> TreeSnapshot {
        TreeSnapshot {
            source_epoch: SourceEpoch::new(1).unwrap(),
            revision: Counter::new(1).unwrap(),
            barrier_seq: Counter::new(1).unwrap(),
            nodes: vec![
                folder("0", None, 0, "根"),
                folder("1", Some("0"), 0, "栏"),
                bookmark("42", "1", 0, left),
                bookmark("43", "1", 1, right),
            ],
        }
    }
    async fn chrome_rows(
        storage: &Storage,
        profile_id: &str,
    ) -> Vec<(String, String, Option<String>)> {
        let profile_id = profile_id.to_owned();
        storage
            .call(move |conn| {
                let mut statement = conn
                    .prepare(
                        "SELECT chrome_id,title,url FROM bookmarks_cache WHERE profile_id=?1 ORDER BY chrome_id",
                    )
                    .map_err(storage_error)?;
                let rows = statement
                    .query_map([profile_id], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })
                    .map_err(storage_error)?;
                rows.collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(storage_error)
            })
            .await
            .unwrap()
    }
    async fn operation_count(storage: &Storage) -> i64 {
        storage
            .call(|conn| {
                conn.query_row("SELECT COUNT(*) FROM operations", [], |row| row.get(0))
                    .map_err(storage_error)
            })
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn offline_tag_and_note_edits_leave_chrome_titles_and_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("app.sqlite"))
            .await
            .unwrap();
        storage.create_profile(profile("profile-a")).await.unwrap();
        storage
            .replace_tree(pid("profile-a"), pid("session-a"), sample("a|b", "keep"))
            .await
            .unwrap();
        let before = chrome_rows(&storage, "profile-a").await;
        let added = storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Add {
                    chrome_ids: vec![pid("42"), pid("43")],
                    name: " Work ".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(added.affected.get(), 2);
        assert_eq!(added.tags[0].name, "Work");
        let work_id = added.tags[0].tag_id.clone();
        let repeat = storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Add {
                    chrome_ids: vec![pid("42")],
                    name: "work".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(repeat.affected.get(), 0);
        assert_eq!(repeat.tags[0].name, "Work");
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Add {
                    chrome_ids: vec![pid("42")],
                    name: "É".into(),
                },
            )
            .await
            .unwrap();
        let folded = storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Add {
                    chrome_ids: vec![pid("43")],
                    name: "e\u{0301}".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(
            folded
                .tags
                .iter()
                .filter(|tag| tag.name == "É" || tag.name == "é")
                .count(),
            1
        );
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::SetNote {
                    chrome_ids: vec![pid("42"), pid("43")],
                    note: "备注".into(),
                },
            )
            .await
            .unwrap();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::SetNote {
                    chrome_ids: vec![pid("42")],
                    note: String::new(),
                },
            )
            .await
            .unwrap();
        let filtered = storage
            .tag_catalog(
                pid("profile-a"),
                vec![pid("42"), pid("43")],
                Some(work_id.clone()),
            )
            .await
            .unwrap();
        assert_eq!(
            filtered
                .matches
                .iter()
                .map(|node| node.chrome_id.as_str())
                .collect::<Vec<_>>(),
            vec!["42", "43"]
        );
        assert_eq!(filtered.entries[0].note, "");
        assert_eq!(filtered.entries[1].note, "备注");
        assert!(
            storage
                .mutate_tags(
                    pid("profile-a"),
                    TagCommand::Add {
                        chrome_ids: vec![pid("42")],
                        name: " ".into(),
                    },
                )
                .await
                .is_err()
        );
        let removed = storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Remove {
                    chrome_ids: vec![pid("42")],
                    tag_id: work_id.clone(),
                },
            )
            .await
            .unwrap();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Undo {
                    journal_id: removed.journal_id.0.clone().unwrap(),
                },
            )
            .await
            .unwrap();
        let restored = storage
            .tag_catalog(pid("profile-a"), vec![pid("42")], Some(work_id.clone()))
            .await
            .unwrap();
        assert_eq!(restored.matches.len(), 2);
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Add {
                    chrome_ids: vec![pid("42")],
                    name: "Alpha".into(),
                },
            )
            .await
            .unwrap();
        let alpha = storage
            .tag_catalog(pid("profile-a"), vec![], None)
            .await
            .unwrap()
            .tags
            .into_iter()
            .find(|tag| tag.name == "Alpha")
            .unwrap();
        let collision = storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Rename {
                    tag_id: alpha.tag_id.clone(),
                    name: "WORK".into(),
                },
            )
            .await
            .unwrap();
        assert!(collision.merge_required);
        assert_eq!(collision.affected.get(), 1);
        let merged = storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Merge {
                    source_id: collision.source_tag_id.0.clone().unwrap(),
                    target_id: collision.target_tag_id.0.clone().unwrap(),
                },
            )
            .await
            .unwrap();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Undo {
                    journal_id: merged.journal_id.0.clone().unwrap(),
                },
            )
            .await
            .unwrap();
        let after_undo = storage
            .tag_catalog(pid("profile-a"), vec![pid("42")], None)
            .await
            .unwrap();
        assert!(after_undo.tags.iter().any(|tag| tag.name == "Alpha"));
        assert!(
            after_undo.entries[0]
                .tag_ids
                .iter()
                .any(|tag| tag == &alpha.tag_id)
        );
        let deleted = storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Delete {
                    tag_id: alpha.tag_id.clone(),
                },
            )
            .await
            .unwrap();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Undo {
                    journal_id: deleted.journal_id.0.clone().unwrap(),
                },
            )
            .await
            .unwrap();
        let revived = storage
            .tag_catalog(pid("profile-a"), vec![pid("42")], None)
            .await
            .unwrap();
        assert!(
            revived.entries[0]
                .tag_ids
                .iter()
                .any(|tag| tag == &alpha.tag_id)
        );
        storage
            .mutate_tags(pid("profile-a"), TagCommand::SetEncoding { enabled: true })
            .await
            .unwrap();
        storage
            .mutate_tags(pid("profile-a"), TagCommand::SetEncoding { enabled: false })
            .await
            .unwrap();
        assert_eq!(chrome_rows(&storage, "profile-a").await, before);
        assert_eq!(operation_count(&storage).await, 0);
        storage.close().await.unwrap();
    }

    #[tokio::test]
    async fn deleting_a_shared_tag_keeps_the_other_profile_link() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("app.sqlite"))
            .await
            .unwrap();
        for name in ["profile-a", "profile-b"] {
            storage.create_profile(profile(name)).await.unwrap();
            storage
                .replace_tree(
                    pid(name),
                    pid(&format!("session-{name}")),
                    sample("one", "two"),
                )
                .await
                .unwrap();
            storage
                .mutate_tags(
                    pid(name),
                    TagCommand::Add {
                        chrome_ids: vec![pid("42")],
                        name: "Work".into(),
                    },
                )
                .await
                .unwrap();
        }
        let work = storage
            .tag_catalog(pid("profile-a"), vec![], None)
            .await
            .unwrap()
            .tags[0]
            .tag_id
            .clone();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Delete {
                    tag_id: work.clone(),
                },
            )
            .await
            .unwrap();
        let other = storage
            .tag_catalog(pid("profile-b"), vec![pid("42")], None)
            .await
            .unwrap();
        assert_eq!(other.entries[0].tag_ids, vec![work]);
        storage.close().await.unwrap();
    }

    #[tokio::test]
    async fn the_fifty_first_tag_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("app.sqlite"))
            .await
            .unwrap();
        storage.create_profile(profile("profile-a")).await.unwrap();
        storage
            .replace_tree(pid("profile-a"), pid("session-a"), sample("one", "two"))
            .await
            .unwrap();
        for index in 0..50 {
            storage
                .mutate_tags(
                    pid("profile-a"),
                    TagCommand::Add {
                        chrome_ids: vec![pid("42")],
                        name: format!("t{index:02}"),
                    },
                )
                .await
                .unwrap();
        }
        assert_eq!(
            storage
                .mutate_tags(
                    pid("profile-a"),
                    TagCommand::Add {
                        chrome_ids: vec![pid("42")],
                        name: "extra".into(),
                    },
                )
                .await,
            Err(ErrorCode::LimitExceeded)
        );
        let entry = storage
            .tag_catalog(pid("profile-a"), vec![pid("42")], None)
            .await
            .unwrap();
        assert_eq!(entry.entries[0].tag_ids.len(), 50);
        storage.close().await.unwrap();
    }

    #[tokio::test]
    async fn copied_bookmark_identity_keeps_tags_notes_and_raw_title() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path().join("app.sqlite"))
            .await
            .unwrap();
        storage.create_profile(profile("profile-a")).await.unwrap();
        storage
            .replace_tree(pid("profile-a"), pid("session-a"), sample("one", "two"))
            .await
            .unwrap();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Add {
                    chrome_ids: vec![pid("42")],
                    name: "Work".into(),
                },
            )
            .await
            .unwrap();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::SetNote {
                    chrome_ids: vec![pid("42")],
                    note: "备注".into(),
                },
            )
            .await
            .unwrap();
        let old = storage
            .bookmarks(pid("profile-a"), SourceEpoch::new(1).unwrap())
            .await
            .unwrap()
            .into_iter()
            .find(|row| row.node.chrome_id.as_str() == "42")
            .unwrap();
        storage
            .record_title_encoding(
                old.bookmark_id.clone(),
                "raw-title".into(),
                Some("encoded".into()),
                4,
            )
            .await
            .unwrap();
        let old_id = old.bookmark_id.as_str().to_owned();
        storage
            .call(move |conn| {
                conn.execute(
                    "INSERT INTO bookmarks_cache(bookmark_id,profile_id,source_epoch,chrome_id,parent_id,position,node_kind,title,url,node_json,revision) SELECT 'b-new',profile_id,source_epoch,'99',parent_id,2,node_kind,title,url,node_json,revision FROM bookmarks_cache WHERE bookmark_id=?1",
                    [&old_id],
                )
                .unwrap();
                let after = AfterBody {
                    maps: vec![IdMapBody {
                        request_id: pid("req-copy"),
                        old_chrome_id: pid("42"),
                        new_chrome_id: pid("99"),
                        old_bookmark_id: pid(&old_id),
                    }],
                    reviewed: false,
                    conflicts: vec![],
                };
                conn.execute(
                    "INSERT INTO operations(operation_id,profile_id,source_epoch,state,before_json,after_json,created_at) VALUES('op-copy','profile-a',1,'applied','{}',?1,1)",
                    [serde_json::to_string(&after).unwrap()],
                )
                .unwrap();
                Ok(())
            })
            .await
            .unwrap();
        storage
            .copy_mapped_metadata(pid("profile-a"), SourceEpoch::new(1).unwrap(), 5)
            .await
            .unwrap();
        let copied = storage
            .call(|conn| {
                let note: String = conn
                    .query_row(
                        "SELECT note FROM bookmark_metadata WHERE bookmark_id='b-new'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                let raw: String = conn
                    .query_row(
                        "SELECT raw_title FROM bookmark_metadata WHERE bookmark_id='b-new'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                let tag: String = conn
                    .query_row(
                        "SELECT t.name FROM bookmark_tags bt JOIN tags t ON t.id=bt.tag_id WHERE bt.bookmark_id='b-new'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                Ok((note, raw, tag))
            })
            .await
            .unwrap();
        assert_eq!(copied, ("备注".into(), "raw-title".into(), "Work".into()));
        storage.close().await.unwrap();
    }

    struct EmptyCreds;
    impl CredentialStore for EmptyCreds {
        fn get(&self, _: &str) -> Result<String> {
            Err(ErrorCode::Unpaired)
        }
        fn set(&self, _: &str, _: &str) -> Result<()> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn encoding_preview_is_scoped_and_offline_apply_does_not_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("app.sqlite");
        let storage = Storage::open(&path).await.unwrap();
        storage.create_profile(profile("profile-a")).await.unwrap();
        storage
            .replace_tree(
                pid("profile-a"),
                pid("session-a"),
                sample("external", "keep"),
            )
            .await
            .unwrap();
        storage
            .mutate_tags(
                pid("profile-a"),
                TagCommand::Add {
                    chrome_ids: vec![pid("42"), pid("43")],
                    name: "t".into(),
                },
            )
            .await
            .unwrap();
        let old = storage
            .bookmarks(pid("profile-a"), SourceEpoch::new(1).unwrap())
            .await
            .unwrap()
            .into_iter()
            .find(|row| row.node.chrome_id.as_str() == "42")
            .unwrap();
        storage
            .record_title_encoding(old.bookmark_id, "Name".into(), Some("Name | t".into()), 1)
            .await
            .unwrap();
        storage
            .mutate_tags(pid("profile-a"), TagCommand::SetEncoding { enabled: false })
            .await
            .unwrap();
        let before = chrome_rows(&storage, "profile-a").await;
        storage.close().await.unwrap();
        let bridge = Bridge::open(&path, Arc::new(EmptyCreds)).await.unwrap();
        let blocked = bridge
            .preview_title_encoding(pid("profile-a"), 1, vec![pid("42"), pid("43")], false)
            .await
            .unwrap();
        assert!(!blocked.enabled);
        assert!(!blocked.writable);
        assert!(blocked.changes.is_empty());
        assert_eq!(
            bridge
                .apply_title_encoding(pid("profile-a"), 1, vec![pid("43")], false)
                .await,
            Err(ErrorCode::InvalidMessage)
        );
        bridge
            .mutate_tags(pid("profile-a"), TagCommand::SetEncoding { enabled: true })
            .await
            .unwrap();
        let preview = bridge
            .preview_title_encoding(pid("profile-a"), 1, vec![pid("42"), pid("43")], false)
            .await
            .unwrap();
        assert!(
            preview
                .conflicts
                .iter()
                .any(|conflict| conflict.chrome_id.as_str() == "42")
        );
        assert_eq!(preview.changes.len(), 1);
        assert_eq!(preview.changes[0].before.0.as_deref(), Some("keep"));
        assert_eq!(preview.changes[0].after.0.as_deref(), Some("keep | t"));
        assert!(!preview.writable);
        assert_eq!(
            bridge
                .apply_title_encoding(pid("profile-a"), 1, vec![pid("42"), pid("43")], false)
                .await,
            Err(ErrorCode::ReadOnly)
        );
        let restore = bridge
            .preview_title_encoding(pid("profile-a"), 1, vec![pid("42"), pid("43")], true)
            .await
            .unwrap();
        assert!(
            restore
                .conflicts
                .iter()
                .any(|conflict| conflict.chrome_id.as_str() == "42")
        );
        assert!(restore.changes.is_empty());
        bridge
            .mutate_tags(pid("profile-a"), TagCommand::SetEncoding { enabled: false })
            .await
            .unwrap();
        bridge.shutdown().await.unwrap();
        let storage = Storage::open(&path).await.unwrap();
        assert_eq!(chrome_rows(&storage, "profile-a").await, before);
        assert_eq!(operation_count(&storage).await, 0);
        let tags = storage
            .tag_catalog(pid("profile-a"), vec![pid("42")], None)
            .await
            .unwrap();
        assert_eq!(tags.entries[0].tag_ids.len(), 1);
        assert!(!tags.encoding_enabled);
        storage.close().await.unwrap();
    }
}
