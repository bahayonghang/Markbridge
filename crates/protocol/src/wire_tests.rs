use super::*;
use serde_json::{Value, json};
fn rust_fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/protocol/rust-to-ts.json"
    ))
    .unwrap()
}
fn parse(value: &Value) -> Result<WireMessage, ErrorCode> {
    parse_frame(&serde_json::to_vec(value).unwrap())
}
#[test]
fn both_language_fixtures_roundtrip() {
    for fixture in [
        include_str!("../../../tests/fixtures/protocol/rust-to-ts.json"),
        include_str!("../../../tests/fixtures/protocol/ts-to-rust.json"),
    ] {
        let parsed = parse_frame(fixture.as_bytes()).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&encode_frame(&parsed).unwrap()).unwrap(),
            serde_json::from_str::<Value>(fixture).unwrap()
        );
    }
}
#[test]
fn managed_folder_type_is_preserved_and_protected() {
    let mut value = rust_fixture();
    value["payload"]["nodes"][0]["folderType"] = json!("managed");
    let WireMessage::TreeFull { payload, .. } = parse(&value).unwrap() else {
        unreachable!()
    };
    assert_eq!(payload.nodes[0].folder_type, Some(FolderType::Managed));
    assert!(
        payload
            .protected_ids()
            .unwrap()
            .contains(payload.nodes[0].chrome_id.as_str())
    );
}
#[test]
fn unknown_versions_mutations_extra_fields_missing_nullable_fields_and_bounds_reject() {
    let mut value = rust_fixture();
    value["protocolVersion"] = json!(2);
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    value["credential"] = json!("forbidden");
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    value.as_object_mut().unwrap().remove("seq");
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    value["requestId"] = Value::Null;
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    value["payload"]["revision"] = json!(MAX_SAFE_INTEGER + 1);
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    value["payload"]["nodes"][1]["title"] = json!("🦢".repeat(4096));
    assert!(parse(&value).is_ok());
    value["payload"]["nodes"][1]["title"] = json!("🦢".repeat(4097));
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    value["profileId"] = json!("a".repeat(128));
    assert!(parse(&value).is_ok());
    value["profileId"] = json!("a".repeat(129));
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    value["payload"]["nodes"][1]["url"] = json!("x".repeat(16384));
    assert!(parse(&value).is_ok());
    value["payload"]["nodes"][1]["url"] = json!("x".repeat(16385));
    assert!(parse(&value).is_err());
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/protocol/ts-to-rust.json"
    ))
    .unwrap();
    value["payload"]["steps"][0]["payload"]["kind"] = json!("export_html");
    assert!(parse(&value).is_err());
    assert!(parse_frame(br#"{"protocolVersion":1,"type":"tree_full","profileId":"a","sessionId":"s","requestId":"r","seq":null,"payload":{"sourceEpoch":1,"revision":1,"barrierSeq":1,"nodes":[{"chromeId":"0","parentId":null,"position":0,"kind":"folder","title":"\ud800"}]}}"#).is_err());
}
#[test]
fn tree_topology_depth_and_node_limits_are_runtime_enforced() {
    let mut value = rust_fixture();
    value["payload"]["nodes"][1]["parentId"] = json!("missing");
    assert!(parse(&value).is_err());
    let mut value = rust_fixture();
    let duplicate = value["payload"]["nodes"][1].clone();
    value["payload"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(parse(&value).is_err());
    let base: TreeSnapshot = match parse(&rust_fixture()).unwrap() {
        WireMessage::TreeFull { payload, .. } => payload,
        _ => unreachable!(),
    };
    let folder = base.nodes[0].clone();
    let mut tree = base;
    tree.nodes.clear();
    for index in 0..MAX_DEPTH {
        let mut node = folder.clone();
        node.chrome_id = Id::new(format!("n{index}")).unwrap();
        node.parent_id = (index > 0).then(|| Id::new(format!("n{}", index - 1)).unwrap());
        tree.nodes.push(node);
    }
    assert!(tree.validate().is_ok());
    let mut node = folder.clone();
    node.chrome_id = Id::new("too-deep").unwrap();
    node.parent_id = Some(Id::new(format!("n{}", MAX_DEPTH - 1)).unwrap());
    tree.nodes.push(node);
    assert_eq!(tree.validate(), Err(ErrorCode::LimitExceeded));
    tree.nodes[0].parent_id = Some(Id::new("n1").unwrap());
    assert_eq!(tree.validate(), Err(ErrorCode::InvalidTree));
    tree.nodes = (0..MAX_NODES)
        .map(|index| {
            let mut node = folder.clone();
            node.chrome_id = Id::new(format!("n{index}")).unwrap();
            node.position = Position::new(index as u64).unwrap();
            node
        })
        .collect();
    assert!(tree.validate().is_ok());
    tree.nodes.push(folder);
    assert_eq!(tree.validate(), Err(ErrorCode::LimitExceeded));
}
#[test]
fn frame_limit_counts_utf8_bytes_and_preserves_exact_boundary() {
    let mut bytes = serde_json::to_vec(&rust_fixture()).unwrap();
    bytes.resize(MAX_FRAME_BYTES, b' ');
    assert!(parse_frame(&bytes).is_ok());
    bytes.push(b' ');
    assert_eq!(parse_frame(&bytes), Err(ErrorCode::FrameTooLarge));
}
#[test]
fn event_variants_keep_complete_fields_and_reject_unknown_variants() {
    let node = rust_fixture()["payload"]["nodes"][1].clone();
    for event in [
        json!({"kind":"created","node":node}),
        json!({"kind":"changed","chromeId":"42","title":"new","url":null}),
        json!({"kind":"moved","chromeId":"42","oldParentId":"0","oldPosition":0,"parentId":"1","position":1}),
        json!({"kind":"removed","chromeId":"42","parentId":"0","position":0,"subtree":[node]}),
        json!({"kind":"reordered","parentId":"0","childIds":["42","43"]}),
        json!({"kind":"import_began"}),
        json!({"kind":"import_ended"}),
    ] {
        let message = json!({"protocolVersion":1,"type":"event","profileId":"p","sessionId":"s","requestId":null,"seq":1,"payload":{"sourceEpoch":1,"event":event}});
        assert!(parse(&message).is_ok());
        let mut extra = message.clone();
        extra["payload"]["event"]["unexpected"] = json!(true);
        assert!(parse(&extra).is_err());
        let mut missing = message;
        missing.as_object_mut().unwrap().remove("requestId");
        assert!(parse(&missing).is_err());
    }
}
#[test]
fn time_sources_are_normalized_without_mixing_epochs() {
    let api = chrome_time(1_700_000_000_000).unwrap();
    let file = file_time(13_344_473_600_000_000).unwrap();
    assert_eq!(api.unix_millis, file.unix_millis);
    assert_ne!(api.source, file.source);
    assert!(file_time(0).is_err());
    assert!(chrome_time(MAX_SAFE_INTEGER + 1).is_err());
}
#[test]
fn reorder_requires_expected_folder_sequence_and_receipts_bound_observed_sequences() {
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/protocol/ts-to-rust.json"
    ))
    .unwrap();
    value["payload"]["steps"][0] = json!({"requestId":"step","target":"0","expectedBefore":rust_fixture()["payload"]["nodes"][0],"expectedChildIds":["a","b"],"payload":{"kind":"reorder","childIds":["b","a"]}});
    assert!(parse(&value).is_ok());
    for expected in [Value::Null, json!(["a", "a"]), json!(["a", "c"])] {
        let mut invalid = value.clone();
        invalid["payload"]["steps"][0]["expectedChildIds"] = expected;
        assert!(parse(&invalid).is_err());
    }
    let mut invalid = value;
    invalid["payload"]["steps"][0]["expectedBefore"] =
        rust_fixture()["payload"]["nodes"][1].clone();
    assert!(parse(&invalid).is_err());
    let mut receipt = json!({"protocolVersion":1,"type":"operation_receipt","profileId":"p","sessionId":"s","requestId":"r","seq":null,"payload":{"operationId":"o","requestId":"r","state":"applied","before":null,"after":null,"beforeChildIds":["a","b"],"afterChildIds":["b","a"],"errorCode":null}});
    receipt["payload"]["before"] = rust_fixture()["payload"]["nodes"][0].clone();
    receipt["payload"]["after"] = rust_fixture()["payload"]["nodes"][0].clone();
    assert!(parse(&receipt).is_ok());
    receipt["payload"]["beforeChildIds"] = json!(["a", "a"]);
    assert!(parse(&receipt).is_err());
}

#[test]
fn mutation_variants_reject_extra_fields_and_accept_json_integer_notation() {
    let fixture = rust_fixture();
    for payload in [
        json!({"kind":"update","title":"updated","url":null}),
        json!({"kind":"move","parentId":"0","position":1}),
        json!({"kind":"delete"}),
    ] {
        let mut value: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/protocol/ts-to-rust.json"
        ))
        .unwrap();
        value["payload"]["steps"][0] = json!({"requestId":"step","target":"42","expectedBefore":fixture["payload"]["nodes"][1],"expectedChildIds":null,"payload":payload});
        assert!(parse(&value).is_ok());
        value["payload"]["steps"][0]["payload"]["unexpected"] = json!(true);
        assert!(parse(&value).is_err());
    }
    for notation in ["1.0", "1e0"] {
        let frame = serde_json::to_string(&fixture).unwrap().replace(
            "\"protocolVersion\":1",
            &format!("\"protocolVersion\":{notation}"),
        );
        assert!(parse_frame(frame.as_bytes()).is_ok());
    }
}
