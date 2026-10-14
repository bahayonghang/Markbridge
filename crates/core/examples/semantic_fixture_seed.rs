//! Seeds a fresh disposable semantic fixture through the production storage worker only.
use markbridge_core::storage::{Metadata, PairedOrigin, Profile, Storage};
use markbridge_protocol::{
    BookmarkNode, Counter, DisplayName, ErrorCode, Id, SourceEpoch, TagCommand, TreeSnapshot,
};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    kind: String,
    profiles: Vec<FixtureProfile>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureProfile {
    profile_id: Id,
    nodes: Vec<BookmarkNode>,
    summaries: BTreeMap<String, String>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("SEMANTIC_SEED_FAILED {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), ErrorCode> {
    let mut arguments = std::env::args().skip(1);
    let database = PathBuf::from(arguments.next().ok_or(ErrorCode::InvalidMessage)?);
    let input = PathBuf::from(arguments.next().ok_or(ErrorCode::InvalidMessage)?);
    let app_data = database.parent().ok_or(ErrorCode::InvalidMessage)?;
    let root = app_data.parent().ok_or(ErrorCode::InvalidMessage)?;
    if arguments.next().is_some()
        || !database.is_absolute()
        || !input.is_absolute()
        || database.exists()
        || database.file_name().and_then(|name| name.to_str()) != Some("markbridge.sqlite")
        || app_data.file_name().and_then(|name| name.to_str()) != Some("app-data")
        || !root
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("markbridge-task13-native-"))
        || input != root.join("semantic-fixture.json")
        || database
            .to_string_lossy()
            .contains("com.markbridge.desktop")
    {
        return Err(ErrorCode::InvalidMessage);
    }
    let temporary = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| ErrorCode::StorageError)?;
    if !root.is_dir()
        || root
            .parent()
            .and_then(|path| path.canonicalize().ok())
            .as_ref()
            != Some(&temporary)
    {
        return Err(ErrorCode::InvalidMessage);
    }
    let mut ancestor = Some(app_data);
    while let Some(path) = ancestor {
        match std::fs::symlink_metadata(path) {
            Ok(metadata) => {
                #[cfg(windows)]
                let redirected = {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & 0x400 != 0
                };
                #[cfg(not(windows))]
                let redirected = false;
                if metadata.file_type().is_symlink() || redirected {
                    return Err(ErrorCode::InvalidMessage);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && path == app_data => {}
            Err(_) => return Err(ErrorCode::StorageError),
        }
        ancestor = path.parent();
    }
    std::fs::create_dir_all(app_data).map_err(|_| ErrorCode::StorageError)?;
    if std::fs::read_dir(app_data)
        .map_err(|_| ErrorCode::StorageError)?
        .next()
        .is_some()
    {
        return Err(ErrorCode::InvalidMessage);
    }
    if std::fs::metadata(&input)
        .map_err(|_| ErrorCode::StorageError)?
        .len()
        > 16 * 1024 * 1024
    {
        return Err(ErrorCode::LimitExceeded);
    }
    let bytes = std::fs::read(input).map_err(|_| ErrorCode::StorageError)?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(ErrorCode::LimitExceeded);
    }
    let fixture: Fixture = serde_json::from_slice(&bytes).map_err(|_| ErrorCode::InvalidMessage)?;
    let mut identities = BTreeSet::new();
    if fixture.kind != "markbridge-semantic-fixture-v1"
        || fixture.profiles.is_empty()
        || fixture.profiles.len() > 2
    {
        return Err(ErrorCode::InvalidMessage);
    }
    for profile in &fixture.profiles {
        if !profile.profile_id.as_str().starts_with("semantic-fixture-")
            || !identities.insert(profile.profile_id.as_str().to_owned())
            || profile.nodes.len() > 11004
            || profile.summaries.len() > 10000
            || profile
                .summaries
                .values()
                .any(|summary| summary.chars().count() > 1000)
        {
            return Err(ErrorCode::InvalidMessage);
        }
    }
    let storage = Storage::open(&database).await?;
    let mut bookmarks = 0usize;
    for profile in fixture.profiles {
        let id = profile.profile_id;
        storage
            .create_profile(Profile {
                id: id.clone(),
                instance_id: Id::new(format!("instance-{}", id.as_str()))?,
                source_epoch: SourceEpoch::new(1)?,
                display_name: DisplayName::new(id.as_str())?,
                paired_origin: PairedOrigin::new(
                    "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                )?,
                credential_reference: None,
            })
            .await?;
        storage
            .replace_tree(
                id.clone(),
                Id::new("semantic-seed-session")?,
                TreeSnapshot {
                    source_epoch: SourceEpoch::new(1)?,
                    revision: Counter::new(1)?,
                    barrier_seq: Counter::new(1)?,
                    nodes: profile.nodes,
                },
            )
            .await?;
        let rows = storage.bookmarks(id.clone(), SourceEpoch::new(1)?).await?;
        let mut tagged = Vec::new();
        let mut remaining = profile.summaries;
        for row in rows.into_iter().filter(|row| row.node.url.is_some()) {
            bookmarks += 1;
            let summary = remaining.remove(row.node.chrome_id.as_str());
            storage
                .set_metadata(
                    row.bookmark_id,
                    Metadata {
                        display_title: None,
                        summary,
                        note: "MB15-NOTE-NEVER-SENT".into(),
                        updated_at: Counter::new(1)?,
                    },
                )
                .await?;
            if tagged.len() < 3 {
                tagged.push(row.node.chrome_id);
            }
        }
        if !remaining.is_empty() || tagged.is_empty() {
            return Err(ErrorCode::InvalidMessage);
        }
        storage
            .mutate_tags(
                id,
                TagCommand::Add {
                    chrome_ids: tagged,
                    name: "MB15-TAG-NEVER-SENT".into(),
                },
            )
            .await?;
    }
    storage.close().await?;
    println!(
        "SEMANTIC_SEED_OK profiles={} bookmarks={bookmarks}",
        identities.len()
    );
    Ok(())
}
