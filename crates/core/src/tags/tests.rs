use super::*;
use crate::editing::plan_title_updates;
use markbridge_protocol::{BookmarkNode, ErrorCode, Id, Mutation, NodeKind, Position, Title, Url};

fn node(id: &str, parent: Option<&str>, title: &str) -> BookmarkNode {
    BookmarkNode {
        chrome_id: Id::new(id).unwrap(),
        parent_id: parent.map(|value| Id::new(value).unwrap()),
        position: Position::new(0).unwrap(),
        kind: NodeKind::Bookmark,
        title: Title::new(title).unwrap(),
        url: Some(Url::new("https://example.com/a").unwrap()),
        folder_type: None,
        unmodifiable: None,
        date_added: None,
        date_last_used: None,
    }
}

#[test]
fn normalization_folds_case_space_and_unicode_the_same_way() {
    let spaced = normalize_tag(" Work ").unwrap();
    let lower = normalize_tag("work").unwrap();
    let upper = normalize_tag("WORK").unwrap();
    let composed = normalize_tag("É").unwrap();
    let decomposed = normalize_tag("e\u{0301}").unwrap();
    assert_eq!(spaced.key, lower.key);
    assert_eq!(spaced.key, upper.key);
    assert_eq!(spaced.display, "Work");
    assert_eq!(composed.key, decomposed.key);
    assert_eq!(decomposed.display, "é");
    assert_eq!(normalize_tag("   "), Err(ErrorCode::InvalidMessage));
    assert_eq!(
        normalize_tag(&"a".repeat(33)),
        Err(ErrorCode::LimitExceeded)
    );
    assert_eq!(normalize_tag("a\nb"), Err(ErrorCode::InvalidMessage));
}

#[test]
fn pipes_backslashes_and_empty_tags_round_trip_without_a_second_copy() {
    let encoded = encode_title(r"a|b\c", &["x|y", ""]).unwrap();
    let (raw, tags) = decode_title(&encoded).unwrap();
    assert_eq!(raw, r"a|b\c");
    assert_eq!(tags, vec!["x|y".to_string(), String::new()]);
    let again = encode_title(&raw, &tags.iter().map(String::as_str).collect::<Vec<_>>()).unwrap();
    assert_eq!(again, encoded);
    assert_eq!(again.matches(" | ").count(), 2);

    let first = decide_encode("a|b", None, None, &["t"]).unwrap();
    let TitleDecision::Write { raw, title } = first else {
        panic!("expected a first encode");
    };
    assert_eq!(raw, "a|b");
    assert_eq!(title, r"a\|b | t");
    assert!(matches!(
        decide_encode(&title, Some(&raw), Some(&title), &["t"]).unwrap(),
        TitleDecision::Unchanged
    ));
    let TitleDecision::Write { title: next, .. } =
        decide_encode(&title, Some(&raw), Some(&title), &["t", "u"]).unwrap()
    else {
        panic!("expected one replacement");
    };
    assert_eq!(next, r"a\|b | t | u");
    assert!(!next.contains("| t | t"));
    assert!(matches!(
        decide_encode("external | extra", Some(&raw), Some(&title), &["t"]).unwrap(),
        TitleDecision::Conflict
    ));
    assert!(matches!(
        decide_restore(&title, Some(&raw), Some(&title)),
        TitleDecision::Write { title: restored, .. } if restored == "a|b"
    ));
    assert!(matches!(
        decide_restore("external", Some(&raw), Some(&title)),
        TitleDecision::Conflict
    ));
    assert!(matches!(
        decide_restore("plain", None, None),
        TitleDecision::Unchanged
    ));
}

#[test]
fn restore_receipt_keeps_the_raw_title_as_last_encoded() {
    assert_eq!(
        last_title_after_receipt(false, "a|b", r"a\|b | t"),
        r"a\|b | t"
    );
    assert_eq!(last_title_after_receipt(true, "a|b", r"a\|b | t"), "a|b");
    assert!(matches!(
        decide_encode(r"a\|b | t", Some("a|b"), Some("a|b"), &["t"]).unwrap(),
        TitleDecision::Conflict
    ));
    let TitleDecision::Write { raw, title } =
        decide_encode("a|b", Some("a|b"), Some("a|b"), &["t"]).unwrap()
    else {
        panic!("expected one encode from the restored title");
    };
    assert_eq!(raw, "a|b");
    assert_eq!(title, r"a\|b | t");
    assert!(!title.contains("| t | t"));
}

#[test]
fn title_plan_includes_only_the_selected_change_and_not_the_url() {
    let mut nodes = vec![
        node("0", None, "root"),
        node("42", Some("0"), "a|b"),
        node("43", Some("0"), "keep"),
    ];
    nodes[0].kind = NodeKind::Folder;
    nodes[0].url = None;
    let plan = plan_title_updates(&nodes, &[(Id::new("42").unwrap(), r"a\|b | t".into())]).unwrap();
    assert_eq!(plan.steps.len(), 1);
    assert_eq!(plan.steps[0].target.as_ref().unwrap().as_str(), "42");
    match &plan.steps[0].payload {
        Mutation::Update { title, url } => {
            assert_eq!(title.as_ref().unwrap().as_str(), r"a\|b | t");
            assert!(url.is_none());
        }
        other => panic!("unexpected {other:?}"),
    }
    assert!(
        plan.changes
            .iter()
            .all(|change| change.field == markbridge_protocol::EditField::Title)
    );
    let same = plan_title_updates(&nodes, &[(Id::new("43").unwrap(), "keep".into())]).unwrap();
    assert!(same.steps.is_empty());
    assert!(matches!(
        plan_title_updates(&nodes, &[(Id::new("0").unwrap(), "renamed".into())]),
        Err(ErrorCode::ProtectedNode)
    ));
}
