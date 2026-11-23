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

#[test]
fn reviewed_subtrees_validate_before_state_shape_and_size_with_legacy_compatibility() {
    let root = json!({"chromeId":"folder","parentId":"bar","position":0,"kind":"folder","title":"F","url":null});
    let child = json!({"chromeId":"leaf","parentId":"folder","position":0,"kind":"bookmark","title":"L","url":"https://example.com/"});
    let value = json!({"protocolVersion":1,"type":"apply_operation","profileId":"p","sessionId":"s","requestId":"r","seq":null,"payload":{"operationId":"op","sourceEpoch":1,"expectedRevision":1,"steps":[{"requestId":"step","target":"folder","expectedBefore":root,"expectedChildIds":null,"expectedSubtree":[root,child],"payload":{"kind":"delete"}}]}});
    assert!(parse(&value).is_ok());
    let mut changed = root.clone();
    changed["title"] = json!("Changed");
    let mut outside = child.clone();
    outside["parentId"] = json!("outside");
    for subtree in [
        json!([]),
        json!([child]),
        json!([root, outside]),
        json!([changed, child]),
        json!([root, child, child]),
        json!(vec![root.clone(); 100001]),
    ] {
        let mut invalid = value.clone();
        invalid["payload"]["steps"][0]["expectedSubtree"] = subtree;
        assert!(parse(&invalid).is_err());
    }
    let mut legacy = value;
    legacy["payload"]["steps"][0]
        .as_object_mut()
        .unwrap()
        .remove("expectedSubtree");
    assert!(parse(&legacy).is_ok());
}

#[test]
fn fixed_extension_identity_constants_and_zero_click_wire_contract() {
    assert_eq!(OFFICIAL_EXTENSION_ID.len(), 32);
    assert!(
        OFFICIAL_EXTENSION_ID
            .bytes()
            .all(|byte| (b'a'..=b'p').contains(&byte))
    );
    assert_eq!(
        OFFICIAL_EXTENSION_ORIGIN,
        format!("chrome-extension://{OFFICIAL_EXTENSION_ID}")
    );
    assert_eq!(BRIDGE_PORT_START, 49153);
    assert_eq!(BRIDGE_PORT_END, 49160);

    let hello_minimal = json!({
        "protocolVersion": 1,
        "type": "hello",
        "profileId": "pending",
        "sessionId": "session-1",
        "requestId": "req-hello",
        "seq": null,
        "payload": {
            "instanceId": "inst-1"
        }
    });
    assert!(parse(&hello_minimal).is_ok());

    let hello_full = json!({
        "protocolVersion": 1,
        "type": "hello",
        "profileId": "profile-1",
        "sessionId": "session-1",
        "requestId": "req-hello-2",
        "seq": null,
        "payload": {
            "instanceId": "inst-1",
            "displayNameHint": "工作资料",
            "userInitiated": true
        }
    });
    assert!(parse(&hello_full).is_ok());

    let hello_with_legacy_credential = json!({
        "protocolVersion": 1,
        "type": "hello",
        "profileId": "profile-1",
        "sessionId": "session-1",
        "requestId": "req-hello-3",
        "seq": null,
        "payload": {
            "instanceId": "inst-1",
            "credential": "x".repeat(32)
        }
    });
    assert!(parse(&hello_with_legacy_credential).is_err());

    let legacy_pair = json!({
        "protocolVersion": 1,
        "type": "pair",
        "profileId": "profile-1",
        "sessionId": "session-1",
        "requestId": "req-pair",
        "seq": null,
        "payload": {
            "instanceId": "inst-1",
            "credential": "x".repeat(32),
            "displayName": "Chrome"
        }
    });
    assert!(parse(&legacy_pair).is_err());

    let hello_result = json!({
        "protocolVersion": 1,
        "type": "hello_result",
        "profileId": "profile-1",
        "sessionId": "session-1",
        "requestId": "req-hello",
        "seq": null,
        "payload": {
            "accepted": true,
            "profileId": "profile-1",
            "displayName": "Chrome 资料 1",
            "sourceEpoch": 1,
            "writePaused": true,
            "errorCode": null
        }
    });
    assert!(parse(&hello_result).is_ok());

    let pause_sync = json!({
        "protocolVersion": 1,
        "type": "pause_sync",
        "profileId": "profile-1",
        "sessionId": "session-1",
        "requestId": "req-pause",
        "seq": null,
        "payload": {
            "reason": "PROFILE_IGNORED"
        }
    });
    assert!(parse(&pause_sync).is_ok());

    let mut invalid_pause_sync = pause_sync.clone();
    invalid_pause_sync["requestId"] = Value::Null;
    assert!(parse(&invalid_pause_sync).is_err());

    let write_policy = json!({
        "protocolVersion": 1,
        "type": "write_policy",
        "profileId": "profile-1",
        "sessionId": "session-1",
        "requestId": "req-write-policy",
        "seq": null,
        "payload": {
            "writePaused": true
        }
    });
    assert!(parse(&write_policy).is_ok());

    let mut invalid_write_policy = write_policy.clone();
    invalid_write_policy["requestId"] = Value::Null;
    assert!(parse(&invalid_write_policy).is_err());

    let mut write_policy_with_seq = write_policy.clone();
    write_policy_with_seq["seq"] = json!(1);
    assert!(parse(&write_policy_with_seq).is_err());

    let mut write_policy_extra = write_policy.clone();
    write_policy_extra["payload"]["extra"] = json!(true);
    assert!(parse(&write_policy_extra).is_err());

    let bridge_state: BridgeState = serde_json::from_value(json!({
        "protocolVersion": 1,
        "revision": 2,
        "port": 49153,
        "errorCode": "PORT_EXHAUSTED",
        "profiles": [{
            "profileId": "profile-1",
            "instanceId": "inst-1",
            "displayName": "Chrome 资料 1",
            "connection": "ignored",
            "writePaused": true,
            "ignored": true,
            "nodeCount": 12,
            "revision": 3,
            "lastSyncedAt": 1700000000000_u64,
            "errorCode": "WRITE_PAUSED"
        }],
        "mirrors": []
    }))
    .unwrap();
    assert_eq!(
        bridge_state.profiles[0].connection,
        BridgeConnection::Ignored
    );
    assert!(bridge_state.profiles[0].write_paused);
    assert!(bridge_state.profiles[0].ignored);

    assert!(
        serde_json::from_value::<BridgeState>(json!({
            "protocolVersion": 1,
            "revision": 0,
            "port": null,
            "errorCode": null,
            "profiles": [],
            "pending": [],
            "mirrors": []
        }))
        .is_err()
    );
}
