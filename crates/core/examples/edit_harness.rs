//! Disposable edit acceptance driver. It reads `MARKBRIDGE_APP_DATA` and
//! `MARKBRIDGE_CREDENTIAL_NAMESPACE`. `Markbridge.Pairing` is rejected before
//! any store or database is opened. Responses stay on stdout for the caller.
use markbridge_core::bridge::{Bridge, credentials::OsCredentialStore};
use markbridge_protocol::{BookmarkNode, EditAction, ErrorCode, Id};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: Value,
    command: String,
    #[serde(default)]
    args: Value,
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if run().await.is_err() {
        eprintln!("HARNESS_FAILED");
        std::process::exit(1);
    }
}

fn acceptance_namespace(value: &str) -> Result<(), ErrorCode> {
    let suffix = value
        .strip_prefix("Markbridge.Task05.")
        .or_else(|| value.strip_prefix("Markbridge.Task06."))
        .filter(|suffix| !suffix.is_empty())
        .ok_or(ErrorCode::InvalidMessage)?;
    if suffix.len() > 80
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(())
}

async fn run() -> Result<(), ErrorCode> {
    let directory =
        PathBuf::from(std::env::var("MARKBRIDGE_APP_DATA").map_err(|_| ErrorCode::InvalidMessage)?);
    let namespace =
        std::env::var("MARKBRIDGE_CREDENTIAL_NAMESPACE").map_err(|_| ErrorCode::InvalidMessage)?;
    if !directory.is_absolute() {
        return Err(ErrorCode::InvalidMessage);
    }
    acceptance_namespace(&namespace)?;
    std::fs::create_dir_all(&directory).map_err(|_| ErrorCode::StorageError)?;
    let database = directory.join("markbridge.sqlite");
    let bridge = Bridge::open(
        database.clone(),
        Arc::new(OsCredentialStore::new(namespace)),
    )
    .await?;
    let mut input = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    let mut output = tokio::io::stdout();
    while let Some(line) = input
        .next_line()
        .await
        .map_err(|_| ErrorCode::StorageError)?
    {
        if line.len() > 65536 {
            return Err(ErrorCode::LimitExceeded);
        }
        let request: Request =
            serde_json::from_str(&line).map_err(|_| ErrorCode::InvalidMessage)?;
        let stop = request.command == "shutdown";
        let result = dispatch(&bridge, &request, &database, &directory.join("backups")).await;
        let response = match result {
            Ok(value) => json!({"id": request.id, "result": value}),
            Err(error) => json!({"id": request.id, "errorCode": error}),
        };
        output
            .write_all(format!("{response}\n").as_bytes())
            .await
            .map_err(|_| ErrorCode::StorageError)?;
        output.flush().await.map_err(|_| ErrorCode::StorageError)?;
        if stop {
            return bridge.shutdown().await;
        }
    }
    bridge.shutdown().await
}

async fn dispatch(
    bridge: &Bridge,
    request: &Request,
    database: &std::path::Path,
    backups: &std::path::Path,
) -> Result<Value, ErrorCode> {
    let string = |key: &str| {
        request
            .args
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(ErrorCode::InvalidMessage)
    };
    let profile = || Id::new(string("profileId")?);
    match request.command.as_str() {
        "state" => serde_json::to_value(bridge.state().await).map_err(|_| ErrorCode::StorageError),
        "start_bridge" => {
            let port = request
                .args
                .get("port")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok())
                .ok_or(ErrorCode::InvalidMessage)?;
            serde_json::to_value(bridge.start(port).await?).map_err(|_| ErrorCode::StorageError)
        }
        "begin_pairing" => {
            serde_json::to_value(bridge.begin_pairing(string("displayName")?).await?)
                .map_err(|_| ErrorCode::StorageError)
        }
        "confirm_pairing" => serde_json::to_value(
            bridge
                .confirm_pairing(profile()?, Id::new(string("instanceId")?)?)
                .await?,
        )
        .map_err(|_| ErrorCode::StorageError),
        "reconnect_profile" => serde_json::to_value(bridge.reconnect_profile(profile()?).await?)
            .map_err(|_| ErrorCode::StorageError),
        "digest" => Ok(digest(&bridge.cache(profile()?).await?.0)),
        "apply_edit" => {
            let action: EditAction = serde_json::from_value(
                request
                    .args
                    .get("action")
                    .cloned()
                    .ok_or(ErrorCode::InvalidMessage)?,
            )
            .map_err(|_| ErrorCode::InvalidMessage)?;
            let revision = request
                .args
                .get("expectedRevision")
                .and_then(Value::as_u64)
                .ok_or(ErrorCode::InvalidMessage)?;
            let second = request
                .args
                .get("secondConfirm")
                .and_then(Value::as_bool)
                .ok_or(ErrorCode::InvalidMessage)?;
            serde_json::to_value(
                bridge
                    .apply_edit(profile()?, revision, action, second)
                    .await?,
            )
            .map_err(|_| ErrorCode::StorageError)
        }
        "list_operations" => serde_json::to_value(bridge.list_operations(profile()?).await?)
            .map_err(|_| ErrorCode::StorageError),
        "refresh_operations" => serde_json::to_value(bridge.refresh_operations(profile()?).await?)
            .map_err(|_| ErrorCode::StorageError),
        "review_operation" => serde_json::to_value(
            bridge
                .review_operation(profile()?, Id::new(string("operationId")?)?)
                .await?,
        )
        .map_err(|_| ErrorCode::StorageError),
        "set_note" => set_note(
            database,
            &string("profileId")?,
            &string("chromeId")?,
            &string("note")?,
        ),
        "note_matches" => note_matches(
            database,
            &string("profileId")?,
            &string("chromeId")?,
            &string("note")?,
        ),
        "backup_flags" => Ok(backup_flags(backups)),
        "shutdown" => Ok(Value::Null),
        _ => Err(ErrorCode::InvalidMessage),
    }
}

fn digest(nodes: &[BookmarkNode]) -> Value {
    let mut rows = Vec::new();
    for node in nodes {
        rows.push(json!([
            node.chrome_id.as_str(),
            node.parent_id.as_ref().map(Id::as_str).unwrap_or(""),
            node.position.get(),
            node.title.as_str(),
            node.url.as_ref().map(|url| url.as_str()).unwrap_or(""),
            label(&node.folder_type),
            label(&node.unmodifiable)
        ]));
    }
    rows.sort_by(|left, right| {
        left[0]
            .as_str()
            .unwrap_or("")
            .cmp(right[0].as_str().unwrap_or(""))
    });
    let text = serde_json::to_string(&rows).unwrap_or_default();
    json!({"count": rows.len(), "hash": fnv(&text)})
}

fn label<T: serde::Serialize>(value: &Option<T>) -> String {
    value
        .as_ref()
        .and_then(|item| serde_json::to_value(item).ok())
        .and_then(|item| item.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn fnv(text: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn set_note(
    database: &std::path::Path,
    profile_id: &str,
    chrome_id: &str,
    note: &str,
) -> Result<Value, ErrorCode> {
    if note.len() > 2000 {
        return Err(ErrorCode::LimitExceeded);
    }
    let connection = open_db(database)?;
    let bookmark_id: String = connection.query_row(
        "SELECT bookmark_id FROM bookmarks_cache WHERE profile_id=?1 AND chrome_id=?2 AND deleted_at IS NULL",
        [profile_id, chrome_id],
        |row| row.get(0),
    ).map_err(|_| ErrorCode::InvalidMessage)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::StorageError)?
        .as_millis() as i64;
    connection.execute(
        "INSERT INTO bookmark_metadata(bookmark_id,display_title,summary,note,updated_at) VALUES(?1,NULL,NULL,?2,?3) ON CONFLICT(bookmark_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at",
        rusqlite::params![bookmark_id, note, now],
    ).map_err(|_| ErrorCode::StorageError)?;
    Ok(json!({"stored": true}))
}

fn note_matches(
    database: &std::path::Path,
    profile_id: &str,
    chrome_id: &str,
    note: &str,
) -> Result<Value, ErrorCode> {
    let connection = open_db(database)?;
    let found: Option<String> = connection.query_row(
        "SELECT m.note FROM bookmarks_cache c JOIN bookmark_metadata m ON m.bookmark_id=c.bookmark_id WHERE c.profile_id=?1 AND c.chrome_id=?2 AND c.deleted_at IS NULL",
        [profile_id, chrome_id],
        |row| row.get(0),
    ).ok();
    Ok(json!({"matches": found.as_deref() == Some(note)}))
}

fn open_db(database: &std::path::Path) -> Result<rusqlite::Connection, ErrorCode> {
    let connection = rusqlite::Connection::open(database).map_err(|_| ErrorCode::StorageError)?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| ErrorCode::StorageError)?;
    Ok(connection)
}

fn backup_flags(directory: &std::path::Path) -> Value {
    let mut html = false;
    let mut sidecar = false;
    let mut escaped_amp = false;
    let mut escaped_lt = false;
    let mut hierarchy = false;
    let Ok(entries) = std::fs::read_dir(directory) else {
        return json!({"html": false, "sidecar": false, "escapedAmp": false, "escapedLt": false, "hierarchy": false});
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        if path.extension().and_then(|value| value.to_str()) == Some("html") {
            html = true;
            escaped_amp |= body.contains("&amp;");
            escaped_lt |= body.contains("&lt;");
            hierarchy |= body.contains("<DL><p>");
        }
        if path.extension().and_then(|value| value.to_str()) == Some("json") {
            sidecar = true;
        }
    }
    json!({"html": html, "sidecar": sidecar, "escapedAmp": escaped_amp, "escapedLt": escaped_lt, "hierarchy": hierarchy})
}
