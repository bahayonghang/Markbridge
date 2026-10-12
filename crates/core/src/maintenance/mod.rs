//! Duplicate groups, dead-link checks, and summary search. Browser deletes go through the edit engine.
use std::time::{SystemTime, UNIX_EPOCH};

use markbridge_protocol::{ErrorCode, Id, LinkVerdict, PreviewFailure};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use url::Url;

use crate::preview::{self, CancelFlag, Network, ProbeError, ProbeHit};
use crate::storage::{Storage, maintenance::Observation};

pub const CHECK_CONCURRENCY: usize = 4;
pub const RECHECK_GAP_MS: u64 = 1_000;
pub const SCOPE_LIMIT: usize = 1_000;
pub const HANDLING: &str = "保留项备注保持不变。标签取并集。摘要不合并。";

#[derive(Clone, Debug)]
pub struct CheckedTarget {
    pub bookmark_id: Id,
    #[allow(dead_code)]
    pub chrome_id: Id,
    pub url: String,
}

pub fn normalize_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    let port = url.port_or_known_default()?;
    let default = matches!((url.scheme(), port), ("http", 80) | ("https", 443));
    let suffix = raw_suffix(raw)?;
    let mut out = format!("{}://{host}", url.scheme());
    if !default {
        out.push(':');
        out.push_str(&port.to_string());
    }
    out.push_str(&suffix);
    Some(out)
}

fn raw_suffix(raw: &str) -> Option<String> {
    let (_, after) = raw.split_once("://")?;
    let end = after.find(['/', '?', '#']).unwrap_or(after.len());
    let rest = &after[end..];
    if rest.is_empty() {
        return Some("/".to_owned());
    }
    if rest.starts_with('?') || rest.starts_with('#') {
        return Some(format!("/{rest}"));
    }
    Some(rest.to_owned())
}

pub fn verdict_for(url: &str, rows: &[Observation]) -> (LinkVerdict, Option<u16>, u64) {
    let matched: Vec<&Observation> = rows.iter().filter(|row| row.url == url).collect();
    let checks = matched.len() as u64;
    let Some(last) = matched.last() else {
        return (LinkVerdict::Unknown, None, 0);
    };
    let verdict = match last.class.as_str() {
        "alive" => LinkVerdict::Alive,
        "gone" if matched.iter().any(|row| {
            row.class == "gone" && last.observed_at.saturating_sub(row.observed_at) >= RECHECK_GAP_MS
        }) => LinkVerdict::Candidate,
        "gone" => LinkVerdict::Pending,
        _ => LinkVerdict::Unknown,
    };
    (verdict, last.http_status, checks)
}

pub fn classify_probe(result: &Result<ProbeHit, ProbeError>) -> Option<(&'static str, Option<u16>)> {
    match result {
        Err(ProbeError::Cancelled) => None,
        Err(ProbeError::Denied(PreviewFailure::TimedOut)) => Some(("unknown", None)),
        Err(ProbeError::Denied(_)) => Some(("unknown", None)),
        Ok(hit) if hit.login_page || matches!(hit.status, 401 | 403 | 429) => {
            Some(("unknown", Some(hit.status)))
        }
        Ok(hit) if matches!(hit.status, 404 | 410) => Some(("gone", Some(hit.status))),
        Ok(hit) if (200..300).contains(&hit.status) => Some(("alive", Some(hit.status))),
        Ok(hit) => Some(("unknown", Some(hit.status))),
    }
}

pub async fn run_link_check(
    storage: &Storage,
    profile_id: &Id,
    targets: &[CheckedTarget],
    cancel: &CancelFlag,
    net: std::sync::Arc<dyn Network>,
) -> Result<(), ErrorCode> {
    let semaphore = std::sync::Arc::new(Semaphore::new(CHECK_CONCURRENCY));
    let mut tasks = tokio::task::JoinSet::new();
    for target in targets {
        if cancel.is_cancelled() {
            break;
        }
        let permit = tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            permit = semaphore.clone().acquire_owned() => permit.map_err(|_| ErrorCode::StorageError)?,
        };
        if cancel.is_cancelled() {
            drop(permit);
            break;
        }
        let target = target.clone();
        let profile_id = profile_id.clone();
        let storage = storage.share();
        let flag = cancel.clone();
        let net = net.clone();
        tasks.spawn(async move {
            let _permit: OwnedSemaphorePermit = permit;
            check_one(storage, profile_id, target, flag, net).await
        });
    }
    while let Some(joined) = tasks.join_next().await {
        joined.map_err(|_| ErrorCode::StorageError)??;
    }
    Ok(())
}

async fn check_one(
    storage: Storage,
    profile_id: Id,
    target: CheckedTarget,
    cancel: CancelFlag,
    net: std::sync::Arc<dyn Network>,
) -> Result<(), ErrorCode> {
    if cancel.is_cancelled() {
        return Ok(());
    }
    let probed = preview::probe_public(&target.url, &cancel, net.as_ref()).await;
    let Some((class, status)) = classify_probe(&probed) else {
        return Ok(());
    };
    let observed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::StorageError)?
        .as_millis() as u64;
    storage
        .insert_observation(
            profile_id,
            target.bookmark_id,
            target.url,
            class.to_owned(),
            status,
            observed,
        )
        .await
}

pub fn clip(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}
