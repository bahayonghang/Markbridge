//! Disposable tag acceptance driver. It reads `MARKBRIDGE_APP_DATA` and
//! `MARKBRIDGE_CREDENTIAL_NAMESPACE`. `Markbridge.Pairing` is rejected before
//! any store or database is opened. The database file name is `markbridge.sqlite`.
//! Responses stay on stdout for the caller. This executable is not a product listener.
use markbridge_core::bridge::{Bridge, credentials::OsCredentialStore};
use markbridge_protocol::{BookmarkNode, EditAction, ErrorCode, Id, TagCommand};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};
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
        .or_else(|| value.strip_prefix("Markbridge.Task07."))
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

fn acceptance_directory(directory: &Path) -> Result<(), ErrorCode> {
    if !directory.is_absolute() {
        return Err(ErrorCode::InvalidMessage);
    }
    let text = directory
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    if text.contains("com.markbridge.desktop")
        || text.contains("google/chrome/user data")
        || text.contains("markbridge-06-chromium")
    {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(())
}

async fn run() -> Result<(), ErrorCode> {
    let directory =
        Path::new(&std::env::var("MARKBRIDGE_APP_DATA").map_err(|_| ErrorCode::InvalidMessage)?)
            .to_path_buf();
    let namespace =
        std::env::var("MARKBRIDGE_CREDENTIAL_NAMESPACE").map_err(|_| ErrorCode::InvalidMessage)?;
    acceptance_directory(&directory)?;
    acceptance_namespace(&namespace)?;
    std::fs::create_dir_all(&directory).map_err(|_| ErrorCode::StorageError)?;
    let database = directory.join("markbridge.sqlite");
    if database.file_name().and_then(|name| name.to_str()) != Some("markbridge.sqlite") {
        return Err(ErrorCode::InvalidMessage);
    }
    let bridge = Bridge::open(database, Arc::new(OsCredentialStore::new(namespace))).await?;
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
        let result = dispatch(&bridge, &request).await;
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

async fn dispatch(bridge: &Bridge, request: &Request) -> Result<Value, ErrorCode> {
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
            let revision = required_u64(&request.args, "expectedRevision")?;
            let second = required_bool(&request.args, "secondConfirm")?;
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
        "tag_catalog" => serde_json::to_value(
            bridge
                .tag_catalog(
                    profile()?,
                    id_list(&request.args, "chromeIds")?,
                    optional_id(&request.args, "filterTagId")?,
                )
                .await?,
        )
        .map_err(|_| ErrorCode::StorageError),
        "tag_command" => {
            let command: TagCommand = serde_json::from_value(
                request
                    .args
                    .get("command")
                    .cloned()
                    .ok_or(ErrorCode::InvalidMessage)?,
            )
            .map_err(|_| ErrorCode::InvalidMessage)?;
            serde_json::to_value(bridge.mutate_tags(profile()?, command).await?)
                .map_err(|_| ErrorCode::StorageError)
        }
        "preview_title_encoding" => serde_json::to_value(
            bridge
                .preview_title_encoding(
                    profile()?,
                    required_u64(&request.args, "expectedRevision")?,
                    id_list(&request.args, "chromeIds")?,
                    required_bool(&request.args, "restore")?,
                )
                .await?,
        )
        .map_err(|_| ErrorCode::StorageError),
        "apply_title_encoding" => serde_json::to_value(
            bridge
                .apply_title_encoding(
                    profile()?,
                    required_u64(&request.args, "expectedRevision")?,
                    id_list(&request.args, "chromeIds")?,
                    required_bool(&request.args, "restore")?,
                )
                .await?,
        )
        .map_err(|_| ErrorCode::StorageError),
        "shutdown" => Ok(Value::Null),
        _ => Err(ErrorCode::InvalidMessage),
    }
}

fn required_u64(args: &Value, key: &str) -> Result<u64, ErrorCode> {
    args.get(key)
        .and_then(Value::as_u64)
        .ok_or(ErrorCode::InvalidMessage)
}

fn required_bool(args: &Value, key: &str) -> Result<bool, ErrorCode> {
    args.get(key)
        .and_then(Value::as_bool)
        .ok_or(ErrorCode::InvalidMessage)
}

fn optional_id(args: &Value, key: &str) -> Result<Option<Id>, ErrorCode> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(Id::new(value.clone())?)),
        Some(_) => Err(ErrorCode::InvalidMessage),
    }
}

fn id_list(args: &Value, key: &str) -> Result<Vec<Id>, ErrorCode> {
    let Some(items) = args.get(key).and_then(Value::as_array) else {
        return Err(ErrorCode::InvalidMessage);
    };
    let mut ids = Vec::new();
    for item in items {
        ids.push(Id::new(
            item.as_str().ok_or(ErrorCode::InvalidMessage)?.to_owned(),
        )?);
    }
    Ok(ids)
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
