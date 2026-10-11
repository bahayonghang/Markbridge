use super::edit::{PlannedCommit, commit_planned};
use super::{Bridge, Result};
use crate::editing::{self, Plan};
use crate::storage::EncodingBody;
use crate::tags::{TitleDecision, decide_encode, decide_restore};
use markbridge_protocol::*;

struct Prepared {
    plan: Plan,
    encodings: Vec<EncodingBody>,
    conflicts: Vec<EncodingConflict>,
    enabled: bool,
    live: bool,
    revision: Counter,
    fatal: Option<ErrorCode>,
}

impl Bridge {
    pub async fn tag_catalog(
        &self,
        profile_id: Id,
        chrome_ids: Vec<Id>,
        filter_tag_id: Option<Id>,
    ) -> Result<TagCatalog> {
        let inner = self.inner.lock().await;
        if !inner.profiles.contains_key(profile_id.as_str()) {
            return Err(ErrorCode::WrongProfile);
        }
        inner
            .storage()?
            .tag_catalog(profile_id, chrome_ids, filter_tag_id)
            .await
    }

    pub async fn mutate_tags(&self, profile_id: Id, command: TagCommand) -> Result<TagCatalog> {
        let inner = self.inner.lock().await;
        if !inner.profiles.contains_key(profile_id.as_str()) {
            return Err(ErrorCode::WrongProfile);
        }
        inner.storage()?.mutate_tags(profile_id, command).await
    }

    pub async fn preview_title_encoding(
        &self,
        profile_id: Id,
        expected_revision: u64,
        chrome_ids: Vec<Id>,
        restore: bool,
    ) -> Result<TitleEncodingPreview> {
        let inner = self.inner.lock().await;
        let prepared =
            prepare(&inner, &profile_id, expected_revision, &chrome_ids, restore).await?;
        Ok(to_preview(&profile_id, restore, &prepared))
    }

    pub async fn apply_title_encoding(
        &self,
        profile_id: Id,
        expected_revision: u64,
        chrome_ids: Vec<Id>,
        restore: bool,
    ) -> Result<ApplyResult> {
        let mut inner = self.inner.lock().await;
        let prepared =
            prepare(&inner, &profile_id, expected_revision, &chrome_ids, restore).await?;
        if let Some(error) = prepared.fatal {
            return Err(error);
        }
        if !prepared.live {
            return Err(ErrorCode::ReadOnly);
        }
        if prepared.plan.steps.is_empty() {
            return Err(if prepared.conflicts.is_empty() {
                ErrorCode::InvalidMessage
            } else {
                ErrorCode::Conflict
            });
        }
        let (epoch, nodes, session, sender) = {
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            (
                profile.identity.source_epoch,
                profile.nodes.clone(),
                profile.session.clone().ok_or(ErrorCode::ReadOnly)?,
                profile.outbound.clone().ok_or(ErrorCode::ReadOnly)?,
            )
        };
        let mut result = commit_planned(
            self,
            &mut inner,
            PlannedCommit {
                profile_id: &profile_id,
                epoch,
                revision: prepared.revision,
                nodes: &nodes,
                session: &session,
                sender,
                plan: prepared.plan,
                encodings: prepared.encodings,
            },
        )
        .await?;
        result
            .conflicts
            .extend(prepared.conflicts.iter().map(|conflict| OperationConflict {
                request_id: conflict.chrome_id.clone(),
                chrome_id: RequiredNullable(Some(conflict.chrome_id.clone())),
                field: EditField::Title,
            }));
        Ok(result)
    }
}

async fn prepare(
    inner: &super::Inner,
    profile_id: &Id,
    expected_revision: u64,
    chrome_ids: &[Id],
    restore: bool,
) -> Result<Prepared> {
    if chrome_ids.is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    if chrome_ids.len() > 1_000 {
        return Err(ErrorCode::LimitExceeded);
    }
    let profile = inner
        .profiles
        .get(profile_id.as_str())
        .ok_or(ErrorCode::WrongProfile)?;
    if expected_revision != profile.view.revision.get() {
        return Err(ErrorCode::StaleProposal);
    }
    let live = profile.view.connection == BridgeConnection::Live
        && !profile.writes_blocked
        && !profile.busy
        && profile.session.is_some()
        && profile.outbound.is_some();
    let catalog = inner
        .storage()?
        .tag_catalog(profile_id.clone(), chrome_ids.to_vec(), None)
        .await?;
    let mut updates = Vec::new();
    let mut intents = Vec::new();
    let mut conflicts = Vec::new();
    let mut fatal = None;
    let allowed = restore || catalog.encoding_enabled;
    if !allowed {
        fatal = Some(ErrorCode::InvalidMessage);
    }
    for entry in &catalog.entries {
        let Some(node) = profile
            .nodes
            .iter()
            .find(|node| node.chrome_id == entry.chrome_id)
        else {
            return Err(ErrorCode::InvalidTree);
        };
        if !allowed {
            continue;
        }
        if let Err(error) = editing::title_blocked(&profile.nodes, &entry.chrome_id) {
            conflicts.push(EncodingConflict {
                chrome_id: entry.chrome_id.clone(),
                error_code: error,
            });
            continue;
        }
        let names = tag_names(&catalog, entry)?;
        let decision = if restore {
            Ok(decide_restore(
                node.title.as_str(),
                entry.raw_title.0.as_deref(),
                entry.last_encoded_title.0.as_deref(),
            ))
        } else {
            decide_encode(
                node.title.as_str(),
                entry.raw_title.0.as_deref(),
                entry.last_encoded_title.0.as_deref(),
                &names,
            )
        };
        match decision {
            Ok(TitleDecision::Unchanged) => {}
            Ok(TitleDecision::Conflict) => conflicts.push(EncodingConflict {
                chrome_id: entry.chrome_id.clone(),
                error_code: ErrorCode::Conflict,
            }),
            Err(ErrorCode::LimitExceeded) => conflicts.push(EncodingConflict {
                chrome_id: entry.chrome_id.clone(),
                error_code: ErrorCode::LimitExceeded,
            }),
            Err(error) => return Err(error),
            Ok(TitleDecision::Write { raw, title }) => {
                updates.push((entry.chrome_id.clone(), title.clone()));
                intents.push((
                    entry.bookmark_id.clone(),
                    entry.chrome_id.clone(),
                    raw,
                    title,
                ));
            }
        }
    }
    let plan = if fatal.is_none() {
        editing::plan_title_updates(&profile.nodes, &updates)?
    } else {
        editing::plan_title_updates(&profile.nodes, &[])?
    };
    let mut encodings = Vec::new();
    for step in &plan.steps {
        let Some(chrome_id) = &step.target else {
            continue;
        };
        let Some((bookmark_id, _, raw, title)) =
            intents.iter().find(|(_, chrome, _, _)| chrome == chrome_id)
        else {
            continue;
        };
        encodings.push(EncodingBody {
            request_id: step.request_id.clone(),
            bookmark_id: bookmark_id.clone(),
            raw_title: raw.clone(),
            encoded_title: title.clone(),
            restore,
        });
    }
    Ok(Prepared {
        plan,
        encodings,
        conflicts,
        enabled: catalog.encoding_enabled,
        live,
        revision: profile.view.revision,
        fatal,
    })
}

fn tag_names<'a>(catalog: &'a TagCatalog, entry: &TagEntry) -> Result<Vec<&'a str>> {
    let mut names = Vec::new();
    for tag_id in &entry.tag_ids {
        let tag = catalog
            .tags
            .iter()
            .find(|tag| &tag.tag_id == tag_id)
            .ok_or(ErrorCode::StorageError)?;
        names.push(tag.name.as_str());
    }
    Ok(names)
}

fn to_preview(profile_id: &Id, restore: bool, prepared: &Prepared) -> TitleEncodingPreview {
    let error = prepared.fatal.or(if prepared.conflicts.is_empty() {
        None
    } else if prepared.plan.steps.is_empty() {
        Some(ErrorCode::Conflict)
    } else {
        None
    });
    TitleEncodingPreview {
        profile_id: profile_id.clone(),
        expected_revision: prepared.revision,
        enabled: prepared.enabled,
        restore,
        writable: prepared.live && prepared.fatal.is_none() && !prepared.plan.steps.is_empty(),
        error_code: RequiredNullable(error),
        changes: prepared.plan.changes.clone(),
        conflicts: prepared.conflicts.clone(),
    }
}
