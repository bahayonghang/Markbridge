//! Disposable native acceptance driver. No test endpoint enters the product listener.
use markbridge_core::bridge::{Bridge, credentials::OsCredentialStore};
use markbridge_protocol::{ErrorCode, Id};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

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
async fn run() -> Result<(), ErrorCode> {
    let mut arguments = std::env::args().skip(1);
    let directory = PathBuf::from(arguments.next().ok_or(ErrorCode::InvalidMessage)?);
    let namespace = arguments.next().ok_or(ErrorCode::InvalidMessage)?;
    if !directory.is_absolute()
        || !namespace.starts_with("Markbridge.Task03.")
        || arguments.next().is_some()
    {
        return Err(ErrorCode::InvalidMessage);
    }
    std::fs::create_dir_all(&directory).map_err(|_| ErrorCode::StorageError)?;
    let bridge = Bridge::open(
        directory.join("bridge.sqlite"),
        Arc::new(OsCredentialStore::new(namespace)),
    )
    .await?;
    let mut input = BufReader::new(tokio::io::stdin()).lines();
    let mut output = tokio::io::stdout();
    while let Some(line) = input
        .next_line()
        .await
        .map_err(|_| ErrorCode::StorageError)?
    {
        let request: Request = if line.len() <= 4096 {
            serde_json::from_str(&line).map_err(|_| ErrorCode::InvalidMessage)?
        } else {
            return Err(ErrorCode::LimitExceeded);
        };
        let stop = request.command == "shutdown";
        let result = dispatch(&bridge, &request, &directory.join("bridge.sqlite")).await;
        let response = match result {
            Ok(value) => json!({"id":request.id,"result":value}),
            Err(error) => json!({"id":request.id,"errorCode":error}),
        };
        output
            .write_all(format!("{response}\n").as_bytes())
            .await
            .map_err(|_| ErrorCode::StorageError)?;
        output.flush().await.map_err(|_| ErrorCode::StorageError)?;
        if stop {
            return Ok(());
        }
    }
    bridge.shutdown().await
}
async fn dispatch(
    bridge: &Bridge,
    request: &Request,
    database: &std::path::Path,
) -> Result<Value, ErrorCode> {
    let string = |key: &str| {
        request
            .args
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(ErrorCode::InvalidMessage)
    };
    match request.command.as_str() {
        "state" => serde_json::to_value(bridge.state().await),
        "start_bridge" => serde_json::to_value(bridge.start(request.args.get("port").and_then(Value::as_u64).and_then(|value| u16::try_from(value).ok()).ok_or(ErrorCode::InvalidMessage)?).await?),
        "begin_pairing" => serde_json::to_value(bridge.begin_pairing(string("displayName")?).await?),
        "confirm_pairing" => serde_json::to_value(bridge.confirm_pairing(Id::new(string("profileId")?)?, Id::new(string("instanceId")?)?).await?),
        "cancel_pairing" => serde_json::to_value(bridge.cancel_pairing(Id::new(string("profileId")?)?).await?),
        "revoke_pairing" => serde_json::to_value(bridge.revoke_pairing(Id::new(string("profileId")?)?).await?),
        "reconnect_profile" => serde_json::to_value(bridge.reconnect_profile(Id::new(string("profileId")?)?).await?),
        "cache" => {
            let profile = Id::new(string("profileId")?)?;
            let (nodes, cursor) = bridge.cache(profile.clone()).await?;
            let connection = rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| ErrorCode::StorageError)?;
            let mut statement = connection.prepare("SELECT chrome_id,bookmark_id FROM bookmarks_cache WHERE profile_id=?1 AND deleted_at IS NULL ORDER BY chrome_id").map_err(|_| ErrorCode::StorageError)?;
            let local_ids = statement.query_map([profile.as_str()], |row| Ok(json!({"chromeId":row.get::<_, String>(0)?,"bookmarkId":row.get::<_, String>(1)?}))).map_err(|_| ErrorCode::StorageError)?.collect::<std::result::Result<Vec<_>, _>>().map_err(|_| ErrorCode::StorageError)?;
            Ok(json!({"nodes":nodes,"localIds":local_ids,"cursor":cursor.map(|cursor| json!({"sourceEpoch":cursor.source_epoch,"sessionId":cursor.session_id,"lastSeq":cursor.last_seq,"revision":cursor.revision}))}))
        },
        "shutdown" => { bridge.shutdown().await?; Ok(json!(null)) },
        _ => return Err(ErrorCode::InvalidMessage),
    }.map_err(|_| ErrorCode::InvalidMessage)
}
