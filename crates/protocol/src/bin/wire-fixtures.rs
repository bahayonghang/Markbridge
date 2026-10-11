//! A typed Rust producer and consumer for cross-language fixtures.
use markbridge_protocol::*;
fn id(value: &str) -> Id {
    Id::new(value).expect("fixture ID")
}
pub fn rust_fixture() -> WireMessage {
    WireMessage::TreeFull {
        protocol_version: Version::new(1).unwrap(),
        profile_id: id("profile-rust"),
        session_id: id("session-rust"),
        request_id: RequiredNullable(Some(id("request-tree"))),
        seq: RequiredNullable(None),
        payload: TreeSnapshot {
            source_epoch: SourceEpoch::new(1).unwrap(),
            revision: Counter::new(MAX_SAFE_INTEGER).unwrap(),
            barrier_seq: Counter::new(42).unwrap(),
            nodes: vec![
                BookmarkNode {
                    chrome_id: id("0"),
                    parent_id: None,
                    position: Position::new(0).unwrap(),
                    kind: NodeKind::Folder,
                    title: Title::new("合成根").unwrap(),
                    url: None,
                    folder_type: None,
                    unmodifiable: None,
                    date_added: None,
                    date_last_used: None,
                },
                BookmarkNode {
                    chrome_id: id("42"),
                    parent_id: Some(id("0")),
                    position: Position::new(0).unwrap(),
                    kind: NodeKind::Bookmark,
                    title: Title::new("合成书签 🦢 | raw").unwrap(),
                    url: Some(Url::new("https://example.invalid/path?q=fixture#local").unwrap()),
                    folder_type: None,
                    unmodifiable: None,
                    date_added: Some(chrome_time(1_700_000_000_000).unwrap()),
                    date_last_used: Some(file_time(13_344_473_600_000_000).unwrap()),
                },
            ],
        },
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().nth(1).as_deref() == Some("--emit") {
        println!("{}", String::from_utf8(encode_frame(&rust_fixture())?)?);
    } else if std::env::args().nth(1).as_deref() == Some("--check-corpus") {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Case {
            frame: String,
            accepted: bool,
        }
        let path = std::env::args().nth(2).ok_or("Missing corpus path")?;
        let cases: Vec<Case> = serde_json::from_slice(&std::fs::read(path)?)?;
        for (index, case) in cases.iter().enumerate() {
            if parse_frame(case.frame.as_bytes()).is_ok() != case.accepted {
                return Err(
                    format!("Corpus case {index} differs between Rust and TypeScript").into(),
                );
            }
        }
        println!("Validated {} cross-language acceptance cases.", cases.len());
    } else if let Some(path) = std::env::args().nth(2) {
        let frame = std::fs::read(path)?;
        let message = parse_frame(&frame)?;
        println!("{}", String::from_utf8(encode_frame(&message)?)?);
    } else {
        return Err("Usage: wire-fixtures --emit | --check path".into());
    }
    Ok(())
}
