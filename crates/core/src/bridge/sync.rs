//! Pure reconciliation. A rejected event cannot alter the committed cache.
use markbridge_protocol::{BookmarkEvent, BookmarkNode, ErrorCode, Id, Position};
use std::collections::HashSet;

pub fn apply_event(nodes: &mut Vec<BookmarkNode>, event: &BookmarkEvent) -> Result<(), ErrorCode> {
    match event {
        BookmarkEvent::Created { node } => {
            if nodes.iter().any(|n| n.chrome_id == node.chrome_id) {
                return Err(ErrorCode::Conflict);
            }
            shift(nodes, node.parent_id.as_ref(), node.position.get(), 1)?;
            nodes.push(node.clone());
        }
        BookmarkEvent::Changed {
            chrome_id,
            title,
            url,
        } => {
            let node = nodes
                .iter_mut()
                .find(|n| n.chrome_id == *chrome_id)
                .ok_or(ErrorCode::Conflict)?;
            node.title = title.clone();
            node.url = url.clone();
        }
        BookmarkEvent::Moved {
            chrome_id,
            old_parent_id,
            old_position,
            parent_id,
            position,
        } => {
            let Some(index) = nodes.iter().position(|n| n.chrome_id == *chrome_id) else {
                return Err(ErrorCode::Conflict);
            };
            let cached = &nodes[index];
            if cached.parent_id.as_ref() != Some(old_parent_id) || cached.position != *old_position
            {
                return Err(ErrorCode::Conflict);
            }
            let mut node = nodes.remove(index);
            shift(nodes, Some(old_parent_id), old_position.get() + 1, -1)?;
            shift(nodes, Some(parent_id), position.get(), 1)?;
            node.parent_id = Some(parent_id.clone());
            node.position = *position;
            nodes.push(node);
        }
        BookmarkEvent::Removed {
            chrome_id,
            parent_id,
            position,
            subtree,
        } => {
            let Some(node) = nodes.iter().find(|n| n.chrome_id == *chrome_id) else {
                return Err(ErrorCode::Conflict);
            };
            if node.parent_id.as_ref() != Some(parent_id) || node.position != *position {
                return Err(ErrorCode::Conflict);
            }
            let mut removed = HashSet::from([chrome_id.clone()]);
            loop {
                let before = removed.len();
                for node in nodes.iter() {
                    if node.parent_id.as_ref().is_some_and(|p| removed.contains(p)) {
                        removed.insert(node.chrome_id.clone());
                    }
                }
                if removed.len() == before {
                    break;
                }
            }
            if subtree.len() != removed.len()
                || subtree.iter().any(|n| !removed.contains(&n.chrome_id))
            {
                return Err(ErrorCode::Conflict);
            }
            nodes.retain(|n| !removed.contains(&n.chrome_id));
            shift(nodes, Some(parent_id), position.get() + 1, -1)?;
        }
        BookmarkEvent::Reordered {
            parent_id,
            child_ids,
        } => {
            let actual: HashSet<_> = nodes
                .iter()
                .filter(|n| n.parent_id.as_ref() == Some(parent_id))
                .map(|n| &n.chrome_id)
                .collect();
            if actual.len() != child_ids.len() || child_ids.iter().any(|id| !actual.contains(id)) {
                return Err(ErrorCode::Conflict);
            }
            for node in nodes
                .iter_mut()
                .filter(|n| n.parent_id.as_ref() == Some(parent_id))
            {
                node.position = Position::new(
                    child_ids
                        .iter()
                        .position(|id| *id == node.chrome_id)
                        .ok_or(ErrorCode::Conflict)? as u64,
                )?;
            }
        }
        BookmarkEvent::ImportBegan {} | BookmarkEvent::ImportEnded {} => {
            return Err(ErrorCode::Conflict);
        }
    }
    Ok(())
}

fn shift(
    nodes: &mut [BookmarkNode],
    parent: Option<&Id>,
    start: u64,
    amount: i64,
) -> Result<(), ErrorCode> {
    for node in nodes
        .iter_mut()
        .filter(|n| n.parent_id.as_ref() == parent && n.position.get() >= start)
    {
        node.position = Position::new((node.position.get() as i64 + amount) as u64)?;
    }
    Ok(())
}
