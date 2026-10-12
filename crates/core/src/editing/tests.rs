use super::*;
use markbridge_protocol::{Position, Title, Url};

fn id(value: &str) -> Id {
    Id::new(value).unwrap()
}
fn node(
    chrome: &str,
    parent: Option<&str>,
    position: u64,
    title: &str,
    url: Option<&str>,
) -> BookmarkNode {
    BookmarkNode {
        chrome_id: id(chrome),
        parent_id: parent.map(id),
        position: Position::new(position).unwrap(),
        kind: if url.is_some() {
            NodeKind::Bookmark
        } else {
            NodeKind::Folder
        },
        title: Title::new(title).unwrap(),
        url: url.map(|value| Url::new(value).unwrap()),
        folder_type: None,
        unmodifiable: None,
        date_added: None,
        date_last_used: None,
    }
}
fn sample() -> Vec<BookmarkNode> {
    let mut nodes = vec![
        node("0", None, 0, "", None),
        node("bar", Some("0"), 0, "栏", None),
        node("other", Some("0"), 1, "其他", None),
        node("managed", Some("0"), 2, "受管", None),
        node(
            "item",
            Some("bar"),
            0,
            "A & B <C>",
            Some("https://example.test/?q=1&x=<y>"),
        ),
        node(
            "next",
            Some("bar"),
            1,
            "Next",
            Some("https://example.test/next"),
        ),
        node("folder", Some("bar"), 2, "目录", None),
        node(
            "child",
            Some("folder"),
            0,
            "子项",
            Some("https://example.test/child"),
        ),
        node(
            "locked",
            Some("managed"),
            0,
            "锁定",
            Some("https://example.test/locked"),
        ),
    ];
    nodes[1].folder_type = Some(FolderType::BookmarksBar);
    nodes[2].folder_type = Some(FolderType::Other);
    nodes[3].folder_type = Some(FolderType::Managed);
    nodes[3].unmodifiable = Some(Unmodifiable::Managed);
    nodes
}

#[test]
fn plans_cover_create_update_move_reorder_and_delete() {
    let nodes = sample();
    let created = plan(
        &nodes,
        &EditAction::Create {
            parent_id: id("bar"),
            position: Position::new(1).unwrap(),
            title: Title::new("新").unwrap(),
            url: Some(Url::new("https://example.test/new").unwrap()),
        },
        &[],
        None,
    )
    .unwrap();
    assert!(created.steps[0].target.is_none());
    assert!(created.steps[0].expected_before.is_none());
    assert_eq!(created.affected, 1);
    let updated = plan(
        &nodes,
        &EditAction::Update {
            chrome_id: id("item"),
            title: Some(Title::new("改").unwrap()),
            url: None,
        },
        &[],
        None,
    )
    .unwrap();
    assert_eq!(
        updated.steps[0].expected_before.as_ref().unwrap().chrome_id,
        id("item")
    );
    assert!(
        updated
            .changes
            .iter()
            .any(|change| change.field == EditField::Title)
    );
    let moved = plan(
        &nodes,
        &EditAction::Move {
            chrome_id: id("item"),
            parent_id: id("other"),
            position: Position::new(0).unwrap(),
        },
        &[],
        None,
    )
    .unwrap();
    assert!(matches!(moved.steps[0].payload, Mutation::Move { .. }));
    let order = plan(
        &nodes,
        &EditAction::Reorder {
            parent_id: id("bar"),
            child_ids: vec![id("next"), id("item"), id("folder")],
        },
        &[],
        None,
    )
    .unwrap();
    assert_eq!(
        order.steps[0].expected_child_ids.as_ref().unwrap(),
        &vec![id("item"), id("next"), id("folder")]
    );
    let deleted = plan(
        &nodes,
        &EditAction::Delete {
            chrome_id: id("folder"),
        },
        &[],
        None,
    )
    .unwrap();
    assert_eq!(deleted.affected, 2);
    assert!(!deleted.requires_second_confirm);
    assert_eq!(deleted.orders[0].child_ids.len(), 3);
}

#[test]
fn rejects_root_managed_descendant_and_cycle_moves() {
    let nodes = sample();
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Delete { chrome_id: id("0") },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::ProtectedNode
    );
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Move {
                chrome_id: id("bar"),
                parent_id: id("other"),
                position: Position::new(0).unwrap()
            },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::ProtectedNode
    );
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Delete {
                chrome_id: id("managed")
            },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::ProtectedNode
    );
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Delete {
                chrome_id: id("locked")
            },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::ProtectedNode
    );
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Update {
                chrome_id: id("bar"),
                title: Some(Title::new("改栏").unwrap()),
                url: None
            },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::ProtectedNode
    );
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Move {
                chrome_id: id("folder"),
                parent_id: id("child"),
                position: Position::new(0).unwrap()
            },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::InvalidTree
    );
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Move {
                chrome_id: id("folder"),
                parent_id: id("folder"),
                position: Position::new(0).unwrap()
            },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::InvalidTree
    );
    assert_eq!(
        plan(
            &nodes,
            &EditAction::Reorder {
                parent_id: id("0"),
                child_ids: vec![id("other"), id("bar"), id("managed")]
            },
            &[],
            None
        )
        .unwrap_err(),
        ErrorCode::ProtectedNode
    );
}

#[test]
fn large_delete_requires_a_second_confirmation() {
    let mut nodes = sample();
    for index in 0..21 {
        nodes.push(node(
            &format!("n{index}"),
            Some("folder"),
            index,
            "项",
            Some("https://example.test/n"),
        ));
    }
    let deleted = plan(
        &nodes,
        &EditAction::Delete {
            chrome_id: id("folder"),
        },
        &[],
        None,
    )
    .unwrap();
    assert!(deleted.affected > LARGE_DELETE);
    assert!(deleted.requires_second_confirm);
}

#[test]
fn html_keeps_hierarchy_and_escapes_sidecar_is_separate() {
    let nodes = sample();
    let html = render_netscape(&nodes).unwrap();
    let bar = html.find("栏").unwrap();
    let folder = html.find("目录").unwrap();
    let child = html.find("子项").unwrap();
    assert!(bar < folder && folder < child);
    assert!(html.contains("<DL><p>"));
    assert!(html.contains("A &amp; B &lt;C&gt;"));
    assert!(html.contains("https://example.test/?q=1&amp;x=&lt;y&gt;"));
    assert!(!html.contains("本地备注"));
    let sidecar = render_sidecar(
        &id("profile-a"),
        1,
        &[LocalRef {
            bookmark_id: id("bookmark-a"),
            chrome_id: id("item"),
            note: "本地备注".into(),
            summary: None,
            display_title: None,
        }],
    )
    .unwrap();
    assert!(sidecar.contains("本地备注"));
    assert!(sidecar.contains("bookmark-a"));
    assert!(!sidecar.contains("<DL>"));
    assert!(!sidecar.contains("https://example.test"));
}

#[test]
fn backup_failure_does_not_dispatch_and_partial_sidecar_is_removed() {
    let mut calls = 0;
    let result = dispatch_after_backup::<()>(Err(ErrorCode::StorageError), |_| {
        calls += 1;
        Ok(())
    });
    assert_eq!(result, Err(ErrorCode::StorageError));
    assert_eq!(calls, 0);
    let directory = tempfile::tempdir().unwrap();
    let blocker = directory.path().join("blocked");
    std::fs::write(&blocker, "not a directory").unwrap();
    assert!(write_backup_pair(&blocker, &id("op-a"), "<html>", "{}").is_err());
    let operation = id("op-b");
    let (html, json) =
        write_backup_pair(directory.path(), &operation, "<html>", "{\"note\":1}").unwrap();
    assert_eq!(std::fs::read_to_string(html).unwrap(), "<html>");
    assert_eq!(std::fs::read_to_string(json).unwrap(), "{\"note\":1}");
}

#[test]
fn lost_ack_does_not_report_success_or_replay_create_or_delete() {
    for kind in [MutationKind::Create, MutationKind::Delete] {
        for phase in [AttemptPhase::Marker, AttemptPhase::Effect] {
            let attempt = Attempt {
                phase,
                kind,
                receipt_applied: false,
            };
            assert_eq!(resume(Some(&attempt)), Resume::Uncertain);
            assert!(!reports_applied(resume(Some(&attempt)), false));
        }
    }
    let stored = Attempt {
        phase: AttemptPhase::Receipt,
        kind: MutationKind::Create,
        receipt_applied: true,
    };
    assert_eq!(resume(Some(&stored)), Resume::Replay);
    assert!(reports_applied(resume(Some(&stored)), true));
    assert_eq!(resume(None), Resume::Execute);
    assert_eq!(
        freeze_state(OperationState::Applying),
        OperationState::Uncertain
    );
    assert_eq!(
        freeze_state(OperationState::RollingBack),
        OperationState::Uncertain
    );
    assert_ne!(
        freeze_state(OperationState::Applying),
        OperationState::Applied
    );
    assert_eq!(
        fold_states(&[Some(OperationState::Applied), None], false, false, true),
        OperationState::Uncertain
    );
    assert_eq!(
        fold_states(
            &[Some(OperationState::Applied), Some(OperationState::Applied)],
            false,
            false,
            true
        ),
        OperationState::Applied
    );
}

#[test]
fn undo_restores_matching_content_and_keeps_external_edits() {
    let nodes = sample();
    let before = nodes
        .iter()
        .find(|node| node.chrome_id.as_str() == "item")
        .unwrap()
        .clone();
    let mut after = before.clone();
    after.title = Title::new("改").unwrap();
    let stored = StoredEdit {
        operation_id: id("op-undo"),
        state: OperationState::Applied,
        orders: vec![],
        snapshot: vec![],
        steps: vec![StoredStep {
            request_id: id("req-update"),
            payload: Mutation::Update {
                title: Some(Title::new("改").unwrap()),
                url: None,
            },
            before: Some(before.clone()),
            after: Some(after.clone()),
            before_child_ids: None,
            after_child_ids: None,
            applied: true,
        }],
    };
    let mut current = nodes.clone();
    current
        .iter_mut()
        .find(|node| node.chrome_id.as_str() == "item")
        .unwrap()
        .title = Title::new("改").unwrap();
    let undo = plan(
        &current,
        &EditAction::Undo {
            operation_id: id("op-undo"),
        },
        &[],
        Some(&stored),
    )
    .unwrap();
    assert!(undo.conflicts.is_empty());
    assert!(matches!(undo.steps[0].payload, Mutation::Update { .. }));
    let conflicted = plan(
        &nodes,
        &EditAction::Undo {
            operation_id: id("op-undo"),
        },
        &[],
        Some(&stored),
    )
    .unwrap();
    assert_eq!(conflicted.conflicts.len(), 1);
    assert!(conflicted.steps.is_empty());
    assert_eq!(conflicted.conflicts[0].field, EditField::Title);
}

#[test]
fn undo_delete_creates_a_new_node_only_when_siblings_match() {
    let nodes = sample();
    let before = nodes
        .iter()
        .find(|node| node.chrome_id.as_str() == "item")
        .unwrap()
        .clone();
    let mut current: Vec<_> = nodes
        .into_iter()
        .filter(|node| node.chrome_id.as_str() != "item")
        .collect();
    current
        .iter_mut()
        .find(|node| node.chrome_id.as_str() == "next")
        .unwrap()
        .position = Position::new(0).unwrap();
    current
        .iter_mut()
        .find(|node| node.chrome_id.as_str() == "folder")
        .unwrap()
        .position = Position::new(1).unwrap();
    let stored = StoredEdit {
        operation_id: id("op-delete"),
        state: OperationState::Applied,
        orders: vec![ChildOrder {
            parent_id: id("bar"),
            child_ids: vec![id("item"), id("next"), id("folder")],
        }],
        snapshot: vec![],
        steps: vec![StoredStep {
            request_id: id("req-delete"),
            payload: Mutation::Delete {},
            before: Some(before),
            after: None,
            before_child_ids: None,
            after_child_ids: None,
            applied: true,
        }],
    };
    let locals = [LocalRef {
        bookmark_id: id("bookmark-item"),
        chrome_id: id("item"),
        note: "备注".into(),
        summary: None,
        display_title: None,
    }];
    let undo = plan(
        &current,
        &EditAction::Undo {
            operation_id: id("op-delete"),
        },
        &locals,
        Some(&stored),
    )
    .unwrap();
    assert!(undo.conflicts.is_empty());
    match &undo.steps[0].payload {
        Mutation::Create {
            parent_id, title, ..
        } => {
            assert_eq!(parent_id, &id("bar"));
            assert_eq!(title.as_str(), "A & B <C>");
        }
        other => panic!("expected create, got {other:?}"),
    }
    assert_eq!(undo.restores[0].old_chrome_id, id("item"));
    assert_ne!(undo.steps[0].request_id, id("item"));
    current.retain(|node| node.chrome_id.as_str() != "next");
    let conflict = plan(
        &current,
        &EditAction::Undo {
            operation_id: id("op-delete"),
        },
        &locals,
        Some(&stored),
    )
    .unwrap();
    assert!(conflict.steps.is_empty());
    assert_eq!(conflict.conflicts[0].field, EditField::Order);
}

#[test]
fn undo_delete_recreates_descendants_under_new_parent_ids() {
    let nodes = sample();
    let folder = nodes
        .iter()
        .find(|node| node.chrome_id.as_str() == "folder")
        .unwrap()
        .clone();
    let current: Vec<_> = nodes
        .iter()
        .filter(|node| node.chrome_id.as_str() != "folder" && node.chrome_id.as_str() != "child")
        .cloned()
        .collect();
    let stored = StoredEdit {
        operation_id: id("op-folder"),
        state: OperationState::Applied,
        orders: vec![ChildOrder {
            parent_id: id("bar"),
            child_ids: vec![id("item"), id("next"), id("folder")],
        }],
        snapshot: nodes,
        steps: vec![StoredStep {
            request_id: id("req-delete-folder"),
            payload: Mutation::Delete {},
            before: Some(folder),
            after: None,
            before_child_ids: None,
            after_child_ids: None,
            applied: true,
        }],
    };
    let locals = [
        LocalRef {
            bookmark_id: id("bookmark-folder"),
            chrome_id: id("folder"),
            note: "目录备注".into(),
            summary: None,
            display_title: None,
        },
        LocalRef {
            bookmark_id: id("bookmark-child"),
            chrome_id: id("child"),
            note: "子备注".into(),
            summary: None,
            display_title: None,
        },
    ];
    let undo = plan(
        &current,
        &EditAction::Undo {
            operation_id: id("op-folder"),
        },
        &locals,
        Some(&stored),
    )
    .unwrap();
    assert!(undo.conflicts.is_empty());
    assert_eq!(undo.steps.len(), 2);
    match &undo.steps[0].payload {
        Mutation::Create {
            parent_id,
            title,
            url,
            ..
        } => {
            assert_eq!(parent_id, &id("bar"));
            assert_eq!(title.as_str(), "目录");
            assert!(url.is_none());
        }
        other => panic!("expected folder create, got {other:?}"),
    }
    match &undo.steps[1].payload {
        Mutation::Create {
            parent_id, title, ..
        } => {
            assert_eq!(parent_id, &undo.steps[0].request_id);
            assert_eq!(title.as_str(), "子项");
        }
        other => panic!("expected child create, got {other:?}"),
    }
    assert_eq!(undo.restores.len(), 2);
    assert_eq!(undo.restores[1].old_chrome_id, id("child"));
}

#[test]
fn reclassify_creates_folders_before_moves_and_has_no_delete() {
    let plan = plan_reclassify(
        &sample(),
        &id("bar"),
        &[ReclassFolder {
            local_id: id("fld1"),
            parent_local: None,
            name: "阅读".into(),
        }],
        &[ReclassMove {
            chrome_id: id("item"),
            folder_local: id("fld1"),
        }],
    )
    .unwrap();
    assert!(plan.steps.len() >= 2);
    assert!(
        plan.steps
            .iter()
            .all(|step| !matches!(step.payload, Mutation::Delete {}))
    );
    assert!(matches!(plan.steps[0].payload, Mutation::Create { .. }));
    match &plan.steps[1].payload {
        Mutation::Move { parent_id, .. } => assert_eq!(parent_id, &plan.steps[0].request_id),
        other => panic!("expected move, got {other:?}"),
    }
    let cycle = plan_reclassify(
        &sample(),
        &id("bar"),
        &[
            ReclassFolder {
                local_id: id("fld1"),
                parent_local: Some(id("fld2")),
                name: "甲".into(),
            },
            ReclassFolder {
                local_id: id("fld2"),
                parent_local: Some(id("fld1")),
                name: "乙".into(),
            },
        ],
        &[],
    );
    assert_eq!(cycle.unwrap_err(), ErrorCode::InvalidTree);
}

#[test]
fn unconfirmed_cleanup_does_not_plan_a_delete() {
    let nodes = sample();
    assert_eq!(
        plan_empty_cleanup(&nodes, &[id("item")], false).unwrap_err(),
        ErrorCode::Cancelled
    );
    assert_eq!(
        plan_empty_cleanup(&nodes, &[id("item")], true).unwrap_err(),
        ErrorCode::InvalidMessage
    );
    let kept = plan_empty_cleanup(&nodes, &[id("folder")], true).unwrap();
    assert!(kept.steps.is_empty());
    let mut with_empty = nodes;
    with_empty.push(node("empty", Some("bar"), 3, "空", None));
    assert!(plan_empty_cleanup(&with_empty, &[id("empty"), id("item")], true).is_err());
    let plan = plan_empty_cleanup(&with_empty, &[id("empty")], true).unwrap();
    assert_eq!(plan.steps.len(), 1);
    assert!(matches!(plan.steps[0].payload, Mutation::Delete {}));
}

#[test]
fn undo_of_create_then_move_restores_the_folder_index_before_delete() {
    let mut current = vec![
        node("0", None, 0, "", None),
        node("bar", Some("0"), 0, "栏", None),
        node(
            "next",
            Some("bar"),
            0,
            "Next",
            Some("https://example.test/next"),
        ),
        node("fld", Some("bar"), 1, "阅读", None),
        node(
            "item",
            Some("fld"),
            0,
            "A & B <C>",
            Some("https://example.test/?q=1&x=<y>"),
        ),
    ];
    current[1].folder_type = Some(FolderType::BookmarksBar);
    let created = node("fld", Some("bar"), 2, "阅读", None);
    let before = node(
        "item",
        Some("bar"),
        0,
        "A & B <C>",
        Some("https://example.test/?q=1&x=<y>"),
    );
    let after = node(
        "item",
        Some("fld"),
        0,
        "A & B <C>",
        Some("https://example.test/?q=1&x=<y>"),
    );
    let stored = StoredEdit {
        operation_id: id("op-reclass"),
        state: OperationState::Applied,
        orders: vec![],
        snapshot: current.clone(),
        steps: vec![
            StoredStep {
                request_id: id("req-create"),
                payload: Mutation::Create {
                    parent_id: id("bar"),
                    position: Position::new(2).unwrap(),
                    title: Title::new("阅读").unwrap(),
                    url: None,
                },
                before: None,
                after: Some(created),
                before_child_ids: None,
                after_child_ids: None,
                applied: true,
            },
            StoredStep {
                request_id: id("req-move"),
                payload: Mutation::Move {
                    parent_id: id("fld"),
                    position: Position::new(0).unwrap(),
                },
                before: Some(before),
                after: Some(after.clone()),
                before_child_ids: None,
                after_child_ids: None,
                applied: true,
            },
        ],
    };
    let undo = plan(
        &current,
        &EditAction::Undo {
            operation_id: id("op-reclass"),
        },
        &[],
        Some(&stored),
    )
    .unwrap();
    assert!(undo.conflicts.is_empty());
    match &undo.steps[0].payload {
        Mutation::Move {
            parent_id,
            position,
        } => {
            assert_eq!(parent_id, &id("bar"));
            assert_eq!(position.get(), 0);
        }
        other => panic!("expected move back, got {other:?}"),
    }
    assert!(matches!(undo.steps[1].payload, Mutation::Delete {}));
    assert!(
        undo.steps
            .iter()
            .all(|step| !matches!(step.payload, Mutation::Update { .. }))
    );

    current
        .iter_mut()
        .find(|node| node.chrome_id.as_str() == "item")
        .unwrap()
        .title = Title::new("Changed").unwrap();
    let titled = plan(
        &current,
        &EditAction::Undo {
            operation_id: id("op-reclass"),
        },
        &[],
        Some(&stored),
    )
    .unwrap();
    assert!(matches!(titled.steps[0].payload, Mutation::Move { .. }));

    current
        .iter_mut()
        .find(|node| node.chrome_id.as_str() == "item")
        .unwrap()
        .parent_id = Some(id("bar"));
    current
        .iter_mut()
        .find(|node| node.chrome_id.as_str() == "item")
        .unwrap()
        .position = Position::new(2).unwrap();
    let conflict = plan(
        &current,
        &EditAction::Undo {
            operation_id: id("op-reclass"),
        },
        &[],
        Some(&stored),
    )
    .unwrap();
    assert!(
        conflict
            .steps
            .iter()
            .all(|step| !matches!(step.payload, Mutation::Move { .. }))
    );
    assert!(!conflict.conflicts.is_empty());
}
