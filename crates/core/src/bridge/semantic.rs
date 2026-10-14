//! Explicit local semantic operations. Network calls never retain a Storage handle or Bridge lock.
use super::{Bridge, Result};
use crate::{
    semantic::{self, CancelFlag, Transport, transport},
    storage::semantic::{Config, Review, Run},
};
use markbridge_protocol::*;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{
    sync::{Mutex, Notify},
    task::JoinHandle,
};

pub(super) struct Runtime {
    control: Mutex<Control>,
    requests: Arc<Requests>,
    embeddings: Mutex<()>,
    pub(super) transport: Arc<dyn Transport>,
}
#[derive(Default)]
struct Control {
    reviews: HashMap<String, (Instant, Review)>,
    builds: HashMap<String, (CancelFlag, JoinHandle<()>)>,
}
#[derive(Default)]
struct Requests {
    flags: StdMutex<HashMap<String, CancelFlag>>,
    // No timer eviction: a cancelled late IPC cannot regain permission to send text.
    pending_cancel: StdMutex<HashSet<String>>,
    changed: Notify,
    closed: AtomicBool,
}
struct Lease {
    requests: Arc<Requests>,
    key: String,
    flag: CancelFlag,
}
impl Drop for Lease {
    fn drop(&mut self) {
        let mut flags = self.requests.flags.lock().expect("semantic request mutex");
        if flags
            .get(&self.key)
            .is_some_and(|flag| flag.same_request(&self.flag))
        {
            flags.remove(&self.key);
        }
        self.requests.changed.notify_waiters();
    }
}
impl Runtime {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            control: Mutex::new(Control::default()),
            requests: Arc::new(Requests::default()),
            embeddings: Mutex::new(()),
            transport: Arc::new(semantic::HttpTransport::new()?),
        })
    }
    fn lease(&self, key: String) -> Result<Lease> {
        let mut flags = self.requests.flags.lock().expect("semantic request mutex");
        if self.requests.closed.load(Ordering::SeqCst)
            || flags.contains_key(&key)
            || flags.len() >= 32
        {
            return Err(ErrorCode::Conflict);
        }
        let flag = CancelFlag::new();
        if key.starts_with("q\0") {
            let mut pending = self
                .requests
                .pending_cancel
                .lock()
                .expect("semantic cancellation mutex");
            if pending.remove(&key) {
                flag.cancel();
            } else if pending.len() >= 128 {
                return Err(ErrorCode::LimitExceeded);
            }
        }
        flags.insert(key.clone(), flag.clone());
        Ok(Lease {
            requests: self.requests.clone(),
            key,
            flag,
        })
    }
    fn cancel(&self, profile: Option<&Id>) {
        let flags = self.requests.flags.lock().expect("semantic request mutex");
        for (key, flag) in flags.iter() {
            if profile.is_none_or(|p| key.starts_with(&format!("q\0{}\0", p.as_str()))) {
                flag.cancel();
            }
        }
    }
}
async fn stop_build(control: &mut Control, profile: &Id) {
    if let Some((flag, mut task)) = control.builds.remove(profile.as_str()) {
        flag.cancel();
        if tokio::time::timeout(Duration::from_secs(2), &mut task)
            .await
            .is_err()
        {
            task.abort();
            let _ = task.await;
        }
    }
}
fn storage_failure(_: ErrorCode) -> SemanticFailure {
    SemanticFailure::StorageError
}
impl Bridge {
    pub async fn semantic_settings(&self) -> Result<SemanticSettings> {
        let storage = self.inner.lock().await.storage()?.share();
        storage
            .semantic_config()
            .await
            .map(|config| config.settings())
    }
    pub async fn save_semantic_config(&self, value: SemanticConfig) -> Result<SemanticSettings> {
        let endpoint = value
            .endpoint
            .0
            .as_deref()
            .map(semantic::endpoint)
            .transpose()
            .map_err(|_| ErrorCode::InvalidMessage)?;
        let model = value
            .model
            .0
            .as_deref()
            .map(semantic::model)
            .transpose()
            .map_err(|_| ErrorCode::InvalidMessage)?;
        if value.enabled && (endpoint.is_none() || model.is_none()) {
            return Err(ErrorCode::InvalidMessage);
        }
        let config = Config {
            enabled: value.enabled,
            endpoint,
            model,
        };
        let mut control = self.semantic.control.lock().await;
        if self.semantic.requests.closed.load(Ordering::SeqCst) {
            return Err(ErrorCode::Conflict);
        }
        let storage = self.inner.lock().await.storage()?.share();
        // Commit generation advancement before any in-memory cancellation.
        let old = storage.semantic_config().await?;
        storage.semantic_save_config(config.clone()).await?;
        drop(storage);
        if old != config {
            self.semantic.cancel(None);
            control.reviews.clear();
            let profiles: Vec<_> = control.builds.keys().cloned().collect();
            for profile in profiles {
                stop_build(&mut control, &Id::new(profile)?).await;
            }
        }
        Ok(config.settings())
    }
    pub async fn semantic_model_check(
        &self,
        endpoint: String,
        model: String,
    ) -> Result<SemanticModelCheck> {
        let lease = self
            .semantic
            .lease(format!("probe\0{}", super::random_id("sm")?.as_str()))?;
        let result = transport::inspect(
            self.semantic.transport.as_ref(),
            &endpoint,
            &model,
            &lease.flag,
        )
        .await;
        Ok(match result {
            Ok(info) => SemanticModelCheck {
                available: true,
                model: RequiredNullable(Some(info.model)),
                digest: RequiredNullable(Some(Id::new(info.digest)?)),
                dimension: RequiredNullable(info.dimension),
                failure: RequiredNullable(None),
                failure_message: RequiredNullable(None),
            },
            Err(failure) => SemanticModelCheck {
                available: false,
                model: RequiredNullable(None),
                digest: RequiredNullable(None),
                dimension: RequiredNullable(None),
                failure: RequiredNullable(Some(failure)),
                failure_message: RequiredNullable(Some(failure.message())),
            },
        })
    }
    pub async fn semantic_review_scope(&self, scope: SemanticScope) -> Result<SemanticScopeReview> {
        let mut control = self.semantic.control.lock().await;
        if self.semantic.requests.closed.load(Ordering::SeqCst) {
            return Err(ErrorCode::Conflict);
        }
        let storage = self.inner.lock().await.storage()?.share();
        let review = storage.semantic_review(scope).await?;
        drop(storage);
        control
            .reviews
            .retain(|_, (time, _)| time.elapsed() < Duration::from_secs(300));
        if control.reviews.len() >= 16 {
            return Err(ErrorCode::Conflict);
        }
        let id = super::random_id("sr")?;
        let result = SemanticScopeReview {
            review_id: id.clone(),
            profile_id: review.scope.profile_id.clone(),
            source_epoch: review.scope.source_epoch,
            expected_revision: review.scope.expected_revision,
            count: review.targets.len() as u16,
            clipped_count: review
                .targets
                .iter()
                .filter(|target| semantic::input(&target.title, &target.summary).1)
                .count() as u16,
            upper_bytes: Counter::new(review.targets.len() as u64 * 4096 * 4)?,
            model: review
                .config
                .model
                .clone()
                .ok_or(ErrorCode::InvalidMessage)?,
            input_recipe_version: semantic::RECIPE,
            max_input_chars: semantic::MAX_CHARS as u16,
            max_input_bytes: semantic::MAX_BYTES as u16,
        };
        control
            .reviews
            .insert(id.as_str().to_owned(), (Instant::now(), review));
        Ok(result)
    }
    pub async fn semantic_start_index(&self, review_id: Id) -> Result<SemanticStatus> {
        let mut control = self.semantic.control.lock().await;
        if self.semantic.requests.closed.load(Ordering::SeqCst) {
            return Err(ErrorCode::Conflict);
        }
        let (time, review) = control
            .reviews
            .remove(review_id.as_str())
            .ok_or(ErrorCode::Conflict)?;
        if time.elapsed() >= Duration::from_secs(300) {
            return Err(ErrorCode::Conflict);
        }
        let profile = review.scope.profile_id.clone();
        let epoch = review.scope.source_epoch;
        let storage = self.inner.lock().await.storage()?.share();
        let run = storage
            .semantic_start(review, super::random_id("si")?)
            .await?;
        drop(storage);
        self.semantic.cancel(Some(&profile));
        stop_build(&mut control, &profile).await;
        self.spawn_semantic(&mut control, run);
        self.semantic_status(profile, epoch).await
    }
    pub async fn semantic_status(&self, profile: Id, epoch: SourceEpoch) -> Result<SemanticStatus> {
        let storage = self.inner.lock().await.storage()?.share();
        storage.semantic_status(profile, epoch).await
    }
    pub async fn semantic_pause(&self, profile: Id, epoch: SourceEpoch) -> Result<SemanticStatus> {
        self.semantic_change(profile, epoch, "pause").await
    }
    pub async fn semantic_resume(&self, profile: Id, epoch: SourceEpoch) -> Result<SemanticStatus> {
        self.semantic_change(profile, epoch, "resume").await
    }
    pub async fn semantic_delete_index(
        &self,
        profile: Id,
        epoch: SourceEpoch,
    ) -> Result<SemanticStatus> {
        self.semantic_change(profile, epoch, "delete").await
    }
    async fn semantic_change(
        &self,
        profile: Id,
        epoch: SourceEpoch,
        action: &'static str,
    ) -> Result<SemanticStatus> {
        let mut control = self.semantic.control.lock().await;
        if self.semantic.requests.closed.load(Ordering::SeqCst) {
            return Err(ErrorCode::Conflict);
        }
        let storage = self.inner.lock().await.storage()?.share();
        let run = storage
            .semantic_transition(profile.clone(), epoch, action)
            .await?;
        drop(storage);
        self.semantic.cancel(Some(&profile));
        stop_build(&mut control, &profile).await;
        if action == "resume"
            && let Some(run) = run
        {
            self.spawn_semantic(&mut control, run);
        }
        self.semantic_status(profile, epoch).await
    }
    fn spawn_semantic(&self, control: &mut Control, run: Run) {
        let bridge = self.clone();
        let flag = CancelFlag::new();
        let task_flag = flag.clone();
        let profile = run.index.profile_id.clone();
        let task = tokio::spawn(async move {
            let result = bridge.semantic_build(&run, &task_flag).await;
            // Stale/cancelled generations can never be restored by a late finish.
            if let Ok(storage) = bridge.semantic_storage().await {
                let _ = storage.semantic_finish(run, result.err()).await;
            }
        });
        control
            .builds
            .insert(profile.as_str().to_owned(), (flag, task));
    }
    async fn semantic_storage(&self) -> Result<crate::storage::Storage> {
        Ok(self.inner.lock().await.storage()?.share())
    }
    async fn semantic_build(&self, run: &Run, flag: &CancelFlag) -> semantic::Result<()> {
        let info = transport::inspect(
            self.semantic.transport.as_ref(),
            &run.endpoint,
            &run.index.model,
            flag,
        )
        .await?;
        let storage = self.semantic_storage().await.map_err(storage_failure)?;
        let bound = storage
            .semantic_bind_model(run.clone(), info.digest.clone(), info.dimension)
            .await;
        drop(storage);
        if !bound.map_err(|error| {
            if error == ErrorCode::Conflict {
                SemanticFailure::ModelChanged
            } else {
                SemanticFailure::StorageError
            }
        })? {
            return Err(SemanticFailure::Cancelled);
        }
        loop {
            if flag.is_cancelled() {
                return Err(SemanticFailure::Cancelled);
            }
            let storage = self.semantic_storage().await.map_err(storage_failure)?;
            let target = storage
                .semantic_next(run.clone())
                .await
                .map_err(storage_failure)?;
            drop(storage);
            let Some(target) = target else {
                break;
            };
            let vector = self
                .semantic_embed(
                    &run.endpoint,
                    &info.model,
                    semantic::input(&target.title, &target.summary).0,
                    flag,
                )
                .await?;
            if info
                .dimension
                .is_some_and(|dimension| dimension as usize != vector.len())
            {
                return Err(SemanticFailure::DimensionMismatch);
            }
            let storage = self.semantic_storage().await.map_err(storage_failure)?;
            let committed = storage
                .semantic_commit(run.clone(), target, info.digest.clone(), vector)
                .await;
            drop(storage);
            committed.map_err(|error| {
                if error == ErrorCode::Conflict {
                    SemanticFailure::DimensionMismatch
                } else {
                    SemanticFailure::StorageError
                }
            })?;
        }
        let after = transport::inspect(
            self.semantic.transport.as_ref(),
            &run.endpoint,
            &run.index.model,
            flag,
        )
        .await?;
        if after.digest != info.digest
            || after
                .dimension
                .zip(info.dimension)
                .is_some_and(|(a, b)| a != b)
        {
            return Err(SemanticFailure::ModelChanged);
        }
        Ok(())
    }
    async fn semantic_embed(
        &self,
        endpoint: &str,
        model: &str,
        text: String,
        flag: &CancelFlag,
    ) -> semantic::Result<Vec<f32>> {
        let _serial = tokio::select! { biased;
            _ = flag.cancelled() => return Err(SemanticFailure::Cancelled),
            guard = self.semantic.embeddings.lock() => guard,
        };
        transport::embed(
            self.semantic.transport.as_ref(),
            endpoint,
            model,
            text,
            flag,
        )
        .await
    }
    pub async fn semantic_query(&self, query: SemanticQuery) -> Result<SemanticQueryResult> {
        if query.text.trim().is_empty()
            || query.text.chars().count() > 4096
            || query.text.len() > 16384
            || !(1..=50).contains(&query.top_k)
        {
            return Err(ErrorCode::InvalidMessage);
        }
        let lease = self.semantic.lease(format!(
            "q\0{}\0{}",
            query.profile_id.as_str(),
            query.request_id.as_str()
        ))?;
        let result = self.semantic_query_inner(&query, &lease.flag).await;
        if let Err(failure @ (SemanticFailure::ModelChanged | SemanticFailure::DimensionMismatch)) =
            &result
        {
            let mut control = self.semantic.control.lock().await;
            let storage = self.semantic_storage().await?;
            let changed = storage.semantic_mark_stale(query.clone(), *failure).await?;
            drop(storage);
            if changed {
                self.semantic.cancel(Some(&query.profile_id));
                stop_build(&mut control, &query.profile_id).await;
            }
        }
        let (hits, failure) = match result {
            Ok(hits) => (hits, None),
            Err(failure) => (Vec::new(), Some(failure)),
        };
        Ok(SemanticQueryResult {
            request_id: query.request_id,
            profile_id: query.profile_id,
            source_epoch: query.source_epoch,
            index_id: query.index_id,
            generation: query.generation,
            hits,
            failure: RequiredNullable(failure),
            failure_message: RequiredNullable(failure.map(SemanticFailure::message)),
        })
    }
    async fn semantic_query_inner(
        &self,
        query: &SemanticQuery,
        flag: &CancelFlag,
    ) -> semantic::Result<Vec<SemanticHit>> {
        if flag.is_cancelled() {
            return Err(SemanticFailure::Cancelled);
        }
        let storage = self.semantic_storage().await.map_err(storage_failure)?;
        let config = storage.semantic_config().await.map_err(storage_failure)?;
        let run = storage
            .semantic_run(query.profile_id.clone(), query.source_epoch)
            .await
            .map_err(storage_failure)?;
        drop(storage);
        if !config.enabled {
            return Err(SemanticFailure::Disabled);
        }
        let run = run.ok_or(SemanticFailure::StaleIndex)?;
        if config.endpoint.as_deref() != Some(&run.endpoint)
            || config.model.as_deref() != Some(&run.index.model)
            || run.index.index_id != query.index_id
            || run.index.generation != query.generation
            || run.index.phase == SemanticPhase::Stale
            || run.index.digest.0.is_none()
            || run.index.dimension.0.is_none()
        {
            return Err(SemanticFailure::StaleIndex);
        }
        let info = transport::inspect(
            self.semantic.transport.as_ref(),
            &run.endpoint,
            &run.index.model,
            flag,
        )
        .await?;
        if run.index.digest.0.as_ref().map(Id::as_str) != Some(&info.digest)
            || info
                .dimension
                .zip(run.index.dimension.0)
                .is_some_and(|(a, b)| a != b)
        {
            return Err(SemanticFailure::ModelChanged);
        }
        let vector = transport::embed(
            self.semantic.transport.as_ref(),
            &run.endpoint,
            &info.model,
            query.text.clone(),
            flag,
        )
        .await?;
        if run.index.dimension.0 != Some(vector.len() as u16) {
            return Err(SemanticFailure::DimensionMismatch);
        }
        let after = transport::inspect(
            self.semantic.transport.as_ref(),
            &run.endpoint,
            &run.index.model,
            flag,
        )
        .await?;
        if after.digest != info.digest {
            return Err(SemanticFailure::ModelChanged);
        }
        if after
            .dimension
            .zip(run.index.dimension.0)
            .is_some_and(|(a, b)| a != b)
        {
            return Err(SemanticFailure::DimensionMismatch);
        }
        if flag.is_cancelled() {
            return Err(SemanticFailure::Cancelled);
        }
        let storage = self.semantic_storage().await.map_err(storage_failure)?;
        let result = storage
            .semantic_search(query.clone(), vector, flag.clone())
            .await;
        drop(storage);
        if flag.is_cancelled() {
            return Err(SemanticFailure::Cancelled);
        }
        result.map_err(|error| {
            if error == ErrorCode::Conflict {
                SemanticFailure::StaleIndex
            } else if error == ErrorCode::InvalidMessage {
                SemanticFailure::InvalidVector
            } else {
                SemanticFailure::StorageError
            }
        })
    }
    pub async fn semantic_cancel_query(&self, profile: Id, request: Id) -> Result<()> {
        let flags = self
            .semantic
            .requests
            .flags
            .lock()
            .expect("semantic request mutex");
        if self.semantic.requests.closed.load(Ordering::SeqCst) {
            return Err(ErrorCode::Conflict);
        }
        let key = format!("q\0{}\0{}", profile.as_str(), request.as_str());
        if let Some(flag) = flags.get(&key) {
            flag.cancel();
        } else {
            let mut pending = self
                .semantic
                .requests
                .pending_cancel
                .lock()
                .expect("semantic cancellation mutex");
            if !pending.contains(&key) && pending.len() >= 128 {
                return Err(ErrorCode::LimitExceeded);
            }
            pending.insert(key);
        }
        Ok(())
    }
    pub(super) async fn shutdown_semantic(&self) -> Result<()> {
        let mut control = self.semantic.control.lock().await;
        self.semantic.requests.closed.store(true, Ordering::SeqCst);
        let storage = self.semantic_storage().await?;
        let result = storage.semantic_pause_all().await;
        drop(storage);
        self.semantic.cancel(None);
        control.reviews.clear();
        let mut tasks: Vec<_> = control
            .builds
            .drain()
            .map(|(_, (flag, task))| {
                flag.cancel();
                task
            })
            .collect();
        let joined = tokio::time::timeout(Duration::from_secs(2), async {
            for task in &mut tasks {
                let _ = task.await;
            }
        })
        .await;
        if joined.is_err() {
            for task in &tasks {
                task.abort();
            }
            for task in tasks {
                let _ = task.await;
            }
        }
        let requests = self.semantic.requests.clone();
        let drained = async {
            loop {
                let notified = requests.changed.notified();
                if requests
                    .flags
                    .lock()
                    .expect("semantic request mutex")
                    .is_empty()
                {
                    break;
                }
                notified.await;
            }
        };
        tokio::time::timeout(Duration::from_secs(16), drained)
            .await
            .map_err(|_| ErrorCode::StorageError)?;
        result
    }
}

#[cfg(test)]
mod tests;
