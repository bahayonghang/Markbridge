//! Writes one disposable profile cache. This process does not open a credential store.
use markbridge_core::storage::{Profile, Storage};
use markbridge_protocol::{
    BookmarkNode, Counter, DisplayName, ErrorCode, Id, SourceEpoch, TreeSnapshot,
};
use std::path::PathBuf;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("SEED_FAILED {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), ErrorCode> {
    let mut arguments = std::env::args().skip(1);
    let database = PathBuf::from(arguments.next().ok_or(ErrorCode::InvalidMessage)?);
    let nodes_path = PathBuf::from(arguments.next().ok_or(ErrorCode::InvalidMessage)?);
    let rendered = database.to_string_lossy();
    if !database.is_absolute()
        || !nodes_path.is_absolute()
        || arguments.next().is_some()
        || database.file_name().and_then(|name| name.to_str()) != Some("markbridge.sqlite")
        || rendered.contains("com.markbridge.desktop")
    {
        return Err(ErrorCode::InvalidMessage);
    }
    let parent = database.parent().ok_or(ErrorCode::InvalidMessage)?;
    std::fs::create_dir_all(parent).map_err(|_| ErrorCode::StorageError)?;
    let text = std::fs::read_to_string(&nodes_path).map_err(|_| ErrorCode::StorageError)?;
    let nodes: Vec<BookmarkNode> =
        serde_json::from_str(&text).map_err(|_| ErrorCode::InvalidMessage)?;
    let count = nodes.len();
    let storage = Storage::open(&database).await?;
    storage
        .create_profile(Profile {
            id: Id::new("pb10k")?,
            instance_id: Id::new("ib10k")?,
            source_epoch: SourceEpoch::new(1)?,
            display_name: DisplayName::new("B10K")?,
            paired_origin: markbridge_core::storage::PairedOrigin::new(
                "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )?,
            credential_reference: None,
        })
        .await?;
    storage
        .replace_tree(
            Id::new("pb10k")?,
            Id::new("sb10k")?,
            TreeSnapshot {
                source_epoch: SourceEpoch::new(1)?,
                revision: Counter::new(1)?,
                barrier_seq: Counter::new(1)?,
                nodes,
            },
        )
        .await?;
    storage.close().await?;
    println!("SEED_OK nodes={count}");
    Ok(())
}
