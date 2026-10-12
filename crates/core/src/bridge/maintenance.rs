use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use super::edit::{self, PlannedCommit};
use super::{Bridge, Inner, Result, random_id};
use crate::maintenance::{self, CheckedTarget, HANDLING};
use crate::storage::maintenance::MemberRow;
use markbridge_protocol::*;
use url::Url;

const MSG_SCOPE: &str = "未选择范围。没有发出请求。";
const MSG_CANCEL: &str = "检查已取消。未继续请求其余地址。";
const MSG_CONFIRM: &str = "未确认清理。没有删除书签。";
const MSG_OFFLINE: &str = "未连接。不能写入浏览器。";
const MSG_STALE: &str = "资料已变化。旧方案不能应用。";
const MSG_SAME: &str = "这些书签不是同一 URL。";
const MSG_KEEPER: &str = "保留项不在所选重复项中。";
const MSG_NONE: &str = "没有可移除的重复项。";
const MSG_SECOND: &str = "删除超过 20 项需要再次确认。";
const MSG_PROTECTED: &str = "包含不可删除的书签。没有删除。";

impl Bridge {
    pub async fn inspect_library(
        &self,
        profile_id: Id,
        chrome_ids: Vec<Id>,
    ) -> Result<MaintenanceReport> {
        let request_id = random_id("mnt")?;
        let inner = self.inner.lock().await;
        self.assemble(&inner, &profile_id, &chrome_ids, request_id, None, None, None, false)
            .await
    }

    pub async fn check_links(
        &self,
        profile_id: Id,
        chrome_ids: Vec<Id>,
        request_id: Id,
    ) -> Result<MaintenanceReport> {
        let scope = unique_ids(&chrome_ids);
        if scope.is_empty() || scope.len() > maintenance::SCOPE_LIMIT {
            let inner = self.inner.lock().await;
            return self
                .assemble(
                    &inner,
                    &profile_id,
                    &scope,
                    request_id,
                    None,
                    Some(ErrorCode::InvalidMessage),
                    Some(MSG_SCOPE.to_owned()),
                    false,
                )
                .await;
        }
        let flag = self.links.begin(&request_id).await;
        let prepared = {
            let inner = self.inner.lock().await;
            if !inner.profiles.contains_key(profile_id.as_str()) {
                Err(ErrorCode::WrongProfile)
            } else {
                let epoch = inner
                    .profiles
                    .get(profile_id.as_str())
                    .ok_or(ErrorCode::WrongProfile)?
                    .identity
                    .source_epoch;
                let members = inner
                    .storage()?
                    .maintenance_members(profile_id.clone(), epoch)
                    .await?;
                let targets = probe_targets(&members, &scope);
                let storage = inner.storage()?.share();
                Ok((targets, storage))
            }
        };
        let (targets, storage) = match prepared {
            Ok(value) => value,
            Err(error) => {
                flag.cancel();
                return Err(error);
            }
        };
        let net = self
            .link_net
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Err(error) = maintenance::run_link_check(&storage, &profile_id, &targets, &flag, net).await {
            flag.cancel();
            return Err(error);
        }
        drop(storage);
        let cancelled = flag.is_cancelled();
        let inner = self.inner.lock().await;
        self.assemble(
            &inner,
            &profile_id,
            &scope,
            request_id,
            None,
            cancelled.then_some(ErrorCode::Cancelled),
            cancelled.then(|| MSG_CANCEL.to_owned()),
            false,
        )
        .await
    }

    pub async fn cancel_link_check(&self, request_id: Id) -> Result<()> {
        self.links.cancel(&request_id).await;
        Ok(())
    }

    pub async fn preview_cleanup(
        &self,
        profile_id: Id,
        expected_revision: u64,
        chrome_ids: Vec<Id>,
        keeper_chrome_id: Id,
    ) -> Result<MaintenanceReport> {
        let request_id = random_id("mnt")?;
        let mut inner = self.inner.lock().await;
        self.cleanup_report(
            &mut inner,
            &profile_id,
            expected_revision,
            &chrome_ids,
            &keeper_chrome_id,
            request_id,
            false,
            false,
        )
        .await
    }

    pub async fn confirm_cleanup(
        &self,
        profile_id: Id,
        expected_revision: u64,
        chrome_ids: Vec<Id>,
        keeper_chrome_id: Id,
        confirm: bool,
        second_confirm: bool,
    ) -> Result<MaintenanceReport> {
        let request_id = random_id("mnt")?;
        let mut inner = self.inner.lock().await;
        self.cleanup_report(
            &mut inner,
            &profile_id,
            expected_revision,
            &chrome_ids,
            &keeper_chrome_id,
            request_id,
            confirm,
            second_confirm,
        )
        .await
    }

    pub async fn search_text(&self, profile_id: Id, query: String) -> Result<TextSearchPage> {
        if query.chars().count() > 200 {
            return Err(ErrorCode::InvalidMessage);
        }
        let inner = self.inner.lock().await;
        if !inner.profiles.contains_key(profile_id.as_str()) {
            return Err(ErrorCode::WrongProfile);
        }
        let hits = inner
            .storage()?
            .search_text(profile_id.clone(), query.clone())
            .await?;
        Ok(TextSearchPage {
            profile_id,
            query,
            hits: hits
                .into_iter()
                .map(|hit| TextHit {
                    bookmark_id: hit.bookmark_id,
                    chrome_id: hit.chrome_id,
                    title: maintenance::clip(&hit.title, 4096),
                    summary: maintenance::clip(&hit.summary, 4096),
                    note: maintenance::clip(&hit.note, 4096),
                })
                .collect(),
        })
    }

    #[cfg(test)]
    pub(crate) fn use_link_network(&self, net: std::sync::Arc<dyn crate::preview::Network>) {
        *self
            .link_net
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = net;
    }

    async fn cleanup_report(
        &self,
        inner: &mut Inner,
        profile_id: &Id,
        expected_revision: u64,
        chrome_ids: &[Id],
        keeper_chrome_id: &Id,
        request_id: Id,
        confirm: bool,
        second_confirm: bool,
    ) -> Result<MaintenanceReport> {
        let revision = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?
            .view
            .revision
            .get();
        if revision != expected_revision {
            return self
                .assemble(
                    inner,
                    profile_id,
                    chrome_ids,
                    request_id,
                    None,
                    Some(ErrorCode::StaleProposal),
                    Some(MSG_STALE.to_owned()),
                    false,
                )
                .await;
        }
        let view = match self.cleanup_view(inner, profile_id, chrome_ids, keeper_chrome_id).await {
            Ok(view) => view,
            Err(ViewFail::Text(message)) => {
                return self
                    .assemble(
                        inner,
                        profile_id,
                        chrome_ids,
                        request_id,
                        None,
                        Some(ErrorCode::InvalidMessage),
                        Some(message.to_owned()),
                        false,
                    )
                    .await;
            }
            Err(ViewFail::Code(error)) => return Err(error),
        };
        if !confirm {
            return self
                .assemble(
                    inner,
                    profile_id,
                    chrome_ids,
                    request_id,
                    Some(view),
                    Some(ErrorCode::Cancelled),
                    Some(MSG_CONFIRM.to_owned()),
                    false,
                )
                .await;
        }
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if profile.view.connection != BridgeConnection::Live
            || profile.session.is_none()
            || profile.outbound.is_none()
        {
            return self
                .assemble(
                    inner,
                    profile_id,
                    chrome_ids,
                    request_id,
                    Some(view),
                    Some(ErrorCode::ReadOnly),
                    Some(MSG_OFFLINE.to_owned()),
                    false,
                )
                .await;
        }
        if profile.busy || profile.writes_blocked || profile.batch_hold.is_some() {
            return Err(ErrorCode::Conflict);
        }
        let epoch = profile.identity.source_epoch;
        let revision_counter = profile.view.revision;
        let nodes = profile.nodes.clone();
        let session = profile.session.clone().ok_or(ErrorCode::ReadOnly)?;
        let sender = profile.outbound.clone().ok_or(ErrorCode::ReadOnly)?;
        let removal_ids: Vec<Id> = view
            .removals
            .iter()
            .map(|member| member.chrome_id.clone())
            .collect();
        let tags_to_add: Vec<String> = view
            .metadata
            .tag_union
            .iter()
            .filter(|tag| {
                !view
                    .keeper
                    .tags
                    .iter()
                    .any(|existing| existing == *tag)
            })
            .cloned()
            .collect();
        let planned = match crate::editing::plan_bookmark_cleanup(&nodes, &removal_ids) {
            Ok(plan) => plan,
            Err(ErrorCode::ProtectedNode) => {
                return self
                    .assemble(
                        inner,
                        profile_id,
                        chrome_ids,
                        request_id,
                        Some(view),
                        Some(ErrorCode::ProtectedNode),
                        Some(MSG_PROTECTED.to_owned()),
                        false,
                    )
                    .await;
            }
            Err(error) => return Err(error),
        };
        if planned.requires_second_confirm && !second_confirm {
            return self
                .assemble(
                    inner,
                    profile_id,
                    chrome_ids,
                    request_id,
                    Some(view),
                    Some(ErrorCode::Cancelled),
                    Some(MSG_SECOND.to_owned()),
                    false,
                )
                .await;
        }
        let operation_id = crate::editing::operation_id()?;
        inner
            .storage()?
            .insert_merge(
                operation_id.clone(),
                profile_id.clone(),
                keeper_chrome_id.clone(),
                tags_to_add,
            )
            .await?;
        let applied = edit::commit_planned(
            self,
            inner,
            PlannedCommit {
                profile_id,
                epoch,
                revision: revision_counter,
                nodes: &nodes,
                session: &session,
                sender,
                plan: planned,
                encodings: Vec::new(),
                send_limit: None,
                operation_id: Some(operation_id.clone()),
            },
        )
        .await;
        let applied = match applied {
            Ok(result) => result,
            Err(error) => {
                let _ = inner.storage()?.delete_merge(operation_id).await;
                return Err(error);
            }
        };
        let mut view = view;
        view.operation_id = RequiredNullable(Some(applied.operation_id));
        view.operation_state = RequiredNullable(Some(applied.state));
        self.assemble(
            inner,
            profile_id,
            chrome_ids,
            request_id,
            Some(view),
            None,
            None,
            false,
        )
        .await
    }

    async fn cleanup_view(
        &self,
        inner: &Inner,
        profile_id: &Id,
        chrome_ids: &[Id],
        keeper_chrome_id: &Id,
    ) -> std::result::Result<CleanupView, ViewFail> {
        let _ = self;
        let selected = selected_members(inner, profile_id, chrome_ids)
            .await
            .map_err(ViewFail::Code)?;
        let Some(keeper) = selected
            .iter()
            .find(|member| &member.chrome_id == keeper_chrome_id)
        else {
            return Err(ViewFail::Text(MSG_KEEPER));
        };
        let Some(key) = keeper.url.as_deref().and_then(maintenance::normalize_url) else {
            return Err(ViewFail::Text(MSG_SAME));
        };
        let mut removals = Vec::new();
        for member in &selected {
            if member.chrome_id == keeper.chrome_id {
                continue;
            }
            let Some(member_key) = member.url.as_deref().and_then(maintenance::normalize_url) else {
                return Err(ViewFail::Text(MSG_SAME));
            };
            if member_key != key {
                return Err(ViewFail::Text(MSG_SAME));
            }
            removals.push(member);
        }
        if removals.is_empty() {
            return Err(ViewFail::Text(MSG_NONE));
        }
        let mut tags = BTreeSet::new();
        for member in std::iter::once(keeper).chain(removals.iter().map(|member| *member)) {
            for tag in &member.tags {
                tags.insert(maintenance::clip(tag, 32));
            }
        }
        let note_conflicts = removals
            .iter()
            .filter(|member| !member.note.is_empty() && member.note != keeper.note)
            .map(|member| NoteConflict {
                bookmark_id: member.bookmark_id.clone(),
                chrome_id: member.chrome_id.clone(),
                note: maintenance::clip(&member.note, 4096),
            })
            .collect();
        Ok(CleanupView {
            keeper: member_dto(keeper),
            removals: removals.into_iter().map(member_dto).collect(),
            metadata: MetadataHandling {
                tag_union: tags.into_iter().take(64).collect(),
                note_conflicts,
                keeper_note: maintenance::clip(&keeper.note, 4096),
                handling: HANDLING.to_owned(),
            },
            operation_id: RequiredNullable(None),
            operation_state: RequiredNullable(None),
        })
    }

    async fn assemble(
        &self,
        inner: &Inner,
        profile_id: &Id,
        chrome_ids: &[Id],
        request_id: Id,
        cleanup: Option<CleanupView>,
        failure: Option<ErrorCode>,
        failure_message: Option<String>,
        running: bool,
    ) -> Result<MaintenanceReport> {
        let _ = self;
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        let epoch = profile.identity.source_epoch;
        let revision = profile.view.revision;
        let scope = unique_ids(chrome_ids);
        let failure = if scope.len() > maintenance::SCOPE_LIMIT {
            Some(ErrorCode::LimitExceeded)
        } else {
            failure
        };
        let failure_message = if scope.len() > maintenance::SCOPE_LIMIT {
            Some(MSG_SCOPE.to_owned())
        } else {
            failure_message
        };
        let selected = if scope.len() > maintenance::SCOPE_LIMIT {
            Vec::new()
        } else {
            selected_members(inner, profile_id, &scope).await?
        };
        let mut buckets: BTreeMap<String, Vec<&MemberRow>> = BTreeMap::new();
        for member in &selected {
            let Some(url) = member.url.as_deref() else {
                continue;
            };
            let Some(key) = maintenance::normalize_url(url) else {
                continue;
            };
            buckets.entry(key).or_default().push(member);
        }
        let mut duplicates = Vec::new();
        for (key, group) in buckets {
            if group.len() < 2 {
                continue;
            }
            duplicates.push(DuplicateGroup {
                normalized_url: maintenance::clip(&key, 16_384),
                members: group.into_iter().map(member_dto).collect(),
            });
        }
        let mut links = Vec::new();
        for member in &selected {
            let Some(url) = member.url.clone().filter(|url| !url.is_empty()) else {
                continue;
            };
            let rows = inner
                .storage()?
                .observations_for(profile_id.clone(), member.bookmark_id.clone())
                .await?;
            let (verdict, status, checks) = maintenance::verdict_for(&url, &rows);
            links.push(LinkRow {
                bookmark_id: member.bookmark_id.clone(),
                chrome_id: member.chrome_id.clone(),
                url: maintenance::clip(&url, 16_384),
                verdict,
                http_status: RequiredNullable(status),
                checks: Counter::new(checks)?,
            });
        }
        Ok(MaintenanceReport {
            profile_id: profile_id.clone(),
            source_epoch: epoch,
            revision,
            request_id,
            duplicates,
            links,
            cleanup: RequiredNullable(cleanup),
            running,
            failure: RequiredNullable(failure),
            failure_message: RequiredNullable(failure_message),
        })
    }
}

enum ViewFail {
    Text(&'static str),
    Code(ErrorCode),
}

async fn selected_members(
    inner: &Inner,
    profile_id: &Id,
    chrome_ids: &[Id],
) -> Result<Vec<MemberRow>> {
    let epoch = inner
        .profiles
        .get(profile_id.as_str())
        .ok_or(ErrorCode::WrongProfile)?
        .identity
        .source_epoch;
    let members = inner
        .storage()?
        .maintenance_members(profile_id.clone(), epoch)
        .await?;
    let mut order = HashMap::new();
    for (index, id) in chrome_ids.iter().enumerate() {
        order.entry(id.as_str()).or_insert(index);
    }
    let mut selected: Vec<MemberRow> = members
        .into_iter()
        .filter(|member| order.contains_key(member.chrome_id.as_str()))
        .collect();
    selected.sort_by_key(|member| {
        order
            .get(member.chrome_id.as_str())
            .copied()
            .unwrap_or(usize::MAX)
    });
    Ok(selected)
}

fn member_dto(member: &MemberRow) -> LibraryMember {
    LibraryMember {
        bookmark_id: member.bookmark_id.clone(),
        chrome_id: member.chrome_id.clone(),
        title: maintenance::clip(&member.title, 4096),
        url: maintenance::clip(member.url.as_deref().unwrap_or(""), 16_384),
        tags: member
            .tags
            .iter()
            .take(32)
            .map(|tag| maintenance::clip(tag, 32))
            .collect(),
        note: maintenance::clip(&member.note, 4096),
    }
}

fn unique_ids(ids: &[Id]) -> Vec<Id> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        if seen.insert(id.as_str().to_owned()) {
            out.push(id.clone());
        }
    }
    out
}

fn probe_targets(members: &[MemberRow], scope: &[Id]) -> Vec<CheckedTarget> {
    let wanted: HashSet<&str> = scope.iter().map(Id::as_str).collect();
    members
        .iter()
        .filter(|member| wanted.contains(member.chrome_id.as_str()))
        .filter_map(|member| {
            let url = member.url.clone()?;
            Url::parse(&url)
                .ok()
                .filter(|parsed| parsed.scheme() == "http" || parsed.scheme() == "https")?;
            Some(CheckedTarget {
                bookmark_id: member.bookmark_id.clone(),
                chrome_id: member.chrome_id.clone(),
                url,
            })
        })
        .collect()
}
