//! Authenticated loopback bridge. Browser mutations are sent to the extension; this process does not call Chrome.
mod ai;
mod batch_edit;
pub mod credentials;
mod edit;
mod history;
mod semantic;
pub use history::ExportSnapshot;
mod file_mirror;
mod local_watch;
mod maintenance;
mod organization;
mod sync;
mod tags;
mod transport;

use crate::preview::Gate;
use crate::storage::{PairedOrigin, Profile, ProfileOrigin, Storage, StoredIdentity};
use credentials::CredentialStore;
use markbridge_protocol::*;
use rand::{TryRngCore, rngs::OsRng};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, mpsc, watch};

type Result<T> = std::result::Result<T, ErrorCode>;

#[derive(Debug)]
pub(super) struct AuthSession {
    pub profile_id: Id,
    pub display_name: DisplayName,
    pub source_epoch: SourceEpoch,
    pub write_paused: bool,
    pub closed: watch::Receiver<bool>,
}

#[derive(Clone)]
pub struct Bridge {
    inner: Arc<Mutex<Inner>>,
    state: watch::Sender<BridgeState>,
    credentials: Arc<dyn CredentialStore>,
    model_credentials: Arc<dyn CredentialStore>,
    model_transport: Arc<dyn crate::ai::ModelTransport>,
    ai_gate: crate::ai::Gate,
    semantic: Arc<semantic::Runtime>,
    ai_audit: crate::ai::Audit,
    lifecycle: Arc<Mutex<()>>,
    watches: Arc<Mutex<BTreeMap<String, file_mirror::Watch>>>,
    local_watch: Arc<Mutex<Option<local_watch::Watch>>>,
    preview: Gate,
    links: Gate,
    link_net: Arc<std::sync::Mutex<Arc<dyn crate::preview::Network>>>,
    allowed_origin: Arc<std::sync::Mutex<PairedOrigin>>,
}
struct ActiveProfile {
    identity: StoredIdentity,
    view: BridgeProfile,
    ignored: bool,
    session: Option<Id>,
    close: Option<watch::Sender<bool>>,
    nodes: Vec<BookmarkNode>,
    seq: u64,
    awaiting_tree: Option<Id>,
    outbound: Option<mpsc::UnboundedSender<WireMessage>>,
    busy: bool,
    writes_blocked: bool,
    batch_hold: Option<Id>,
}
struct Listener {
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}
struct Inner {
    edit_previews: HashMap<String, batch_edit::Prepared>,
    storage: Option<Storage>,
    profiles: BTreeMap<String, ActiveProfile>,
    mirrors: BTreeMap<String, file_mirror::ActiveMirror>,
    listener: Option<Listener>,
    retired_closes: Vec<watch::Sender<bool>>,
    revision: u64,
    port: Option<u16>,
    error: Option<ErrorCode>,
    backup_dir: std::path::PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheTreeNode {
    pub node: BookmarkNode,
    pub children: Vec<CacheTreeNode>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachePage {
    pub items: Vec<BookmarkNode>,
    pub total: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheNode {
    pub node: BookmarkNode,
    pub ancestors: Vec<Title>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheCount {
    pub folders: u64,
    pub bookmarks: u64,
}

impl Bridge {
    pub async fn open(
        path: impl AsRef<Path>,
        credentials: Arc<dyn CredentialStore>,
    ) -> Result<Self> {
        Self::open_with_ai(
            path,
            credentials,
            Arc::new(ai::EmptyCredentials),
            Arc::new(crate::ai::IdleTransport),
        )
        .await
    }

    /// Production model store. The service name is `MODEL_CREDENTIAL_SERVICE`, not the pairing namespace.
    pub async fn open_with_model_store(
        path: impl AsRef<Path>,
        credentials: Arc<dyn CredentialStore>,
        models: Arc<dyn CredentialStore>,
    ) -> Result<Self> {
        let transport = Arc::new(crate::ai::ReqwestTransport::new()?);
        Self::open_with_ai(path, credentials, models, transport).await
    }

    pub(crate) async fn open_with_ai(
        path: impl AsRef<Path>,
        credentials: Arc<dyn CredentialStore>,
        model_credentials: Arc<dyn CredentialStore>,
        model_transport: Arc<dyn crate::ai::ModelTransport>,
    ) -> Result<Self> {
        let path = path.as_ref();
        let backup_dir = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("backups");
        let storage = Storage::open(path).await?;
        storage.freeze_inflight().await?;
        storage.semantic_restart().await?;
        let blocked = storage.blocked_profiles().await?;
        let mut profiles = BTreeMap::new();
        for stored in storage.profiles().await? {
            let profile = stored.profile;
            let nodes: Vec<_> = storage
                .bookmarks(profile.id.clone(), profile.source_epoch)
                .await?
                .into_iter()
                .filter(|row| row.deleted_at.is_none())
                .map(|row| row.node)
                .collect();
            let cursor = storage.cursor(profile.id.clone()).await?;
            let writes_blocked = blocked.iter().any(|item| item == &profile.id);
            let view = BridgeProfile {
                profile_id: profile.id.clone(),
                instance_id: profile.instance_id.clone(),
                display_name: profile.display_name.clone(),
                connection: match &profile.origin {
                    ProfileOrigin::LocalSkills => BridgeConnection::Local,
                    ProfileOrigin::Chrome(_) if stored.ignored => BridgeConnection::Ignored,
                    ProfileOrigin::Chrome(_) => BridgeConnection::CachedReadOnly,
                },
                write_paused: stored.write_paused,
                ignored: stored.ignored,
                node_count: Counter::new(nodes.len() as u64)?,
                revision: cursor
                    .as_ref()
                    .map_or(Counter::new(0)?, |cursor| cursor.revision),
                last_synced_at: RequiredNullable(stored.last_synced_at),
                error_code: RequiredNullable(None),
            };
            profiles.insert(
                profile.id.as_str().to_owned(),
                ActiveProfile {
                    identity: profile,
                    view,
                    ignored: stored.ignored,
                    session: None,
                    close: None,
                    nodes,
                    seq: 0,
                    awaiting_tree: None,
                    outbound: None,
                    busy: false,
                    writes_blocked,
                    batch_hold: None,
                },
            );
        }
        let mirrors = file_mirror::load_mirrors(&storage).await?;
        let inner = Inner {
            edit_previews: HashMap::new(),
            storage: Some(storage),
            profiles,
            mirrors,
            listener: None,
            retired_closes: Vec::new(),
            revision: 0,
            port: None,
            error: None,
            backup_dir,
        };
        let (state_tx, _) = watch::channel(inner.view());
        let bridge = Self {
            inner: Arc::new(Mutex::new(inner)),
            state: state_tx,
            credentials,
            model_credentials,
            model_transport,
            ai_gate: crate::ai::Gate::default(),
            semantic: Arc::new(semantic::Runtime::new()?),
            ai_audit: crate::ai::Audit::default(),
            lifecycle: Arc::new(Mutex::new(())),
            watches: Arc::new(Mutex::new(BTreeMap::new())),
            local_watch: Arc::new(Mutex::new(None)),
            preview: Gate::default(),
            links: Gate::default(),
            link_net: Arc::new(std::sync::Mutex::new(Arc::new(
                crate::preview::SystemNetwork,
            ))),
            allowed_origin: Arc::new(std::sync::Mutex::new(PairedOrigin::new(
                OFFICIAL_EXTENSION_ORIGIN,
            )?)),
        };
        bridge.arm_saved_watches().await;
        bridge.arm_local_watch(path).await;
        Ok(bridge)
    }
    pub(super) fn allowed_origin(&self) -> PairedOrigin {
        self.allowed_origin
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
    #[cfg(test)]
    pub(crate) fn set_allowed_origin(&self, origin: PairedOrigin) {
        *self
            .allowed_origin
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = origin;
    }
    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) async fn open_with_allowed_origin(
        path: impl AsRef<Path>,
        credentials: Arc<dyn CredentialStore>,
        origin: PairedOrigin,
    ) -> Result<Self> {
        let bridge = Self::open(path, credentials).await?;
        bridge.set_allowed_origin(origin);
        Ok(bridge)
    }
    pub fn subscribe(&self) -> watch::Receiver<BridgeState> {
        self.state.subscribe()
    }
    pub async fn state(&self) -> BridgeState {
        self.inner.lock().await.view()
    }
    fn publish(&self, inner: &mut Inner) {
        inner.revision += 1;
        self.state.send_replace(inner.view());
    }
    pub async fn start_auto(&self) -> Result<BridgeState> {
        let _lifecycle = self.lifecycle.lock().await;
        {
            let inner = self.inner.lock().await;
            if inner.storage.is_none() {
                return Err(ErrorCode::Cancelled);
            }
            if inner.listener.is_some() {
                return Ok(inner.view());
            }
        }
        let candidates = match std::env::var("MARKBRIDGE_BRIDGE_PORT") {
            Ok(raw) if !raw.trim().is_empty() => match raw.trim().parse::<u16>() {
                Ok(port) if port != 0 => vec![port],
                _ => {
                    let mut inner = self.inner.lock().await;
                    inner.port = None;
                    inner.error = Some(ErrorCode::InvalidMessage);
                    self.publish(&mut inner);
                    return Err(ErrorCode::InvalidMessage);
                }
            },
            Ok(_) | Err(std::env::VarError::NotPresent) => {
                (BRIDGE_PORT_START..=BRIDGE_PORT_END).collect()
            }
            Err(_) => {
                let mut inner = self.inner.lock().await;
                inner.port = None;
                inner.error = Some(ErrorCode::InvalidMessage);
                self.publish(&mut inner);
                return Err(ErrorCode::InvalidMessage);
            }
        };
        let mut bound = None;
        for port in candidates {
            if let Ok(socket) =
                tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await
            {
                bound = Some((port, socket));
                break;
            }
        }
        let Some((port, socket)) = bound else {
            let mut inner = self.inner.lock().await;
            inner.port = None;
            inner.error = Some(ErrorCode::PortExhausted);
            self.publish(&mut inner);
            return Err(ErrorCode::PortExhausted);
        };
        Ok(self.spawn_listener(port, socket).await)
    }
    pub async fn start(&self, port: u16) -> Result<BridgeState> {
        let _lifecycle = self.lifecycle.lock().await;
        if port == 0 {
            return Err(ErrorCode::InvalidMessage);
        }
        {
            let inner = self.inner.lock().await;
            if inner.port == Some(port) {
                return Ok(inner.view());
            }
            if inner.listener.is_some() {
                return Err(ErrorCode::Conflict);
            }
            if inner.storage.is_none() {
                return Err(ErrorCode::Cancelled);
            }
        }
        let socket =
            match tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await {
                Ok(socket) => socket,
                Err(_) => {
                    let mut inner = self.inner.lock().await;
                    inner.error = Some(ErrorCode::Conflict);
                    self.publish(&mut inner);
                    return Err(ErrorCode::Conflict);
                }
            };
        Ok(self.spawn_listener(port, socket).await)
    }
    async fn spawn_listener(&self, port: u16, socket: tokio::net::TcpListener) -> BridgeState {
        let mut inner = self.inner.lock().await;
        let (stop, stopped) = watch::channel(false);
        let bridge = self.clone();
        let task = tokio::spawn(async move {
            transport::serve(bridge, socket, stopped).await;
        });
        inner.listener = Some(Listener { stop, task });
        inner.port = Some(port);
        inner.error = None;
        self.publish(&mut inner);
        inner.view()
    }
    pub async fn rename_profile(
        &self,
        profile_id: Id,
        display_name: String,
    ) -> Result<BridgeState> {
        let trimmed = display_name.trim().to_owned();
        if trimmed == crate::storage::LOCAL_SKILLS_PROFILE_ID {
            return Err(ErrorCode::InvalidMessage);
        }
        let display_name = DisplayName::new(trimmed)?;
        let mut inner = self.inner.lock().await;
        {
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            if matches!(profile.identity.origin, ProfileOrigin::LocalSkills) {
                return Err(ErrorCode::ReadOnly);
            }
        }
        inner
            .storage()?
            .rename_profile(profile_id.clone(), display_name.clone())
            .await?;
        let profile = inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        profile.identity.display_name = display_name.clone();
        profile.view.display_name = display_name;
        self.publish(&mut inner);
        Ok(inner.view())
    }
    pub async fn set_write_paused(&self, profile_id: Id, paused: bool) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        {
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            if matches!(profile.identity.origin, ProfileOrigin::LocalSkills) {
                return Err(ErrorCode::ReadOnly);
            }
        }
        inner
            .storage()?
            .set_write_paused(profile_id.clone(), paused)
            .await?;
        let profile = inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        profile.view.write_paused = paused;
        self.publish(&mut inner);
        Ok(inner.view())
    }
    pub async fn ignore_profile(&self, profile_id: Id) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        {
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            if matches!(profile.identity.origin, ProfileOrigin::LocalSkills) {
                return Err(ErrorCode::ReadOnly);
            }
        }
        inner
            .storage()?
            .set_ignored(profile_id.clone(), true)
            .await?;
        inner.retired_closes.retain(|tx| !tx.is_closed());
        let mut retired = None;
        {
            let profile = inner
                .profiles
                .get_mut(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            profile.ignored = true;
            profile.view.ignored = true;
            profile.view.connection = BridgeConnection::Ignored;
            profile.view.error_code.0 = None;
            profile.identity.credential_reference = None;
            if let (Some(session), Some(sender)) = (profile.session.take(), profile.outbound.take())
            {
                let pause = envelope(
                    "pause_sync",
                    &profile_id,
                    &session,
                    Some(random_id("pause")?),
                    serde_json::json!({ "reason": ErrorCode::ProfileIgnored }),
                )?;
                let _ = sender.send(pause);
                // Keep `close` alive until `authenticated_loop` flushes `PauseSync` and exits.
                retired = profile.close.take();
                profile.awaiting_tree = None;
                profile.busy = false;
            } else {
                profile.disconnect();
            }
        }
        if let Some(close) = retired {
            inner.retired_closes.push(close);
        }
        self.publish(&mut inner);
        Ok(inner.view())
    }
    pub async fn resume_profile(&self, profile_id: Id) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        {
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            if matches!(profile.identity.origin, ProfileOrigin::LocalSkills) {
                return Err(ErrorCode::ReadOnly);
            }
        }
        inner
            .storage()?
            .set_ignored(profile_id.clone(), false)
            .await?;
        let profile = inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        let was_ignored = profile.ignored || profile.view.ignored;
        profile.ignored = false;
        profile.view.ignored = false;
        if was_ignored {
            profile.view.connection = BridgeConnection::CachedReadOnly;
            profile.view.error_code.0 = None;
        }
        self.publish(&mut inner);
        Ok(inner.view())
    }
    pub async fn reconnect_profile(&self, profile_id: Id) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        let profile = inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if matches!(profile.identity.origin, ProfileOrigin::LocalSkills) {
            return Err(ErrorCode::ReadOnly);
        }
        if profile.ignored {
            return Err(ErrorCode::ProfileIgnored);
        }
        // Explicit reconnect closes the old session. The extension reconnects with a new session.
        profile.disconnect();
        profile.view.connection = BridgeConnection::Reconciling;
        self.publish(&mut inner);
        Ok(inner.view())
    }
    pub async fn content_preview(
        &self,
        profile_id: Id,
        chrome_id: Id,
        request_id: Id,
    ) -> Result<markbridge_protocol::ContentPreview> {
        if !self
            .inner
            .lock()
            .await
            .profiles
            .contains_key(profile_id.as_str())
        {
            return Err(ErrorCode::WrongProfile);
        }
        let flag = self.preview.begin(&request_id).await;
        let storage = self.inner.lock().await.storage()?.share();
        crate::preview::load_content_preview(
            &storage,
            profile_id,
            chrome_id,
            request_id,
            &flag,
            &crate::preview::SystemNetwork,
        )
        .await
    }
    pub async fn cancel_content_preview(&self, request_id: Id) -> Result<()> {
        self.preview.cancel(&request_id).await;
        Ok(())
    }
    pub async fn shutdown(&self) -> Result<()> {
        let _lifecycle = self.lifecycle.lock().await;
        let semantic_result = self.shutdown_semantic().await;
        self.preview.cancel_all().await;
        self.links.cancel_all().await;
        self.ai_gate.cancel_all().await;
        self.stop_watches().await;
        self.stop_local_watch().await;
        let listener = {
            let mut inner = self.inner.lock().await;
            inner.port = None;
            for close in inner.retired_closes.drain(..) {
                close.send_replace(true);
            }
            for profile in inner.profiles.values_mut() {
                profile.disconnect();
            }
            self.publish(&mut inner);
            inner.listener.take()
        };
        if let Some(listener) = listener {
            listener.stop.send_replace(true);
            listener.task.await.map_err(|_| ErrorCode::StorageError)?;
        }
        let storage = self.inner.lock().await.storage.take();
        if let Some(storage) = storage {
            storage.close().await?;
        }
        semantic_result
    }
    /// Local Rust consumers only. Never exposed by the production WebSocket listener.
    pub async fn cache(
        &self,
        profile_id: Id,
    ) -> Result<(Vec<BookmarkNode>, Option<crate::storage::Cursor>)> {
        let inner = self.inner.lock().await;
        let profile = inner
            .profiles
            .get(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        Ok((
            profile.nodes.clone(),
            inner.storage()?.cursor(profile_id).await?,
        ))
    }
    // Local cache reads. Not WebSocket messages.
    // depth None or 0 is the whole subtree. Search is a case-sensitive title or URL substring.
    pub async fn tree(
        &self,
        profile_id: Id,
        folder_id: Option<Id>,
        depth: Option<u64>,
    ) -> Result<Vec<CacheTreeNode>> {
        let inner = self.inner.lock().await;
        read_tree(
            profile_nodes(&inner, &profile_id)?,
            folder_id.as_ref(),
            depth.unwrap_or(0),
        )
    }
    pub async fn list(
        &self,
        profile_id: Id,
        folder_id: Id,
        offset: u64,
        limit: u64,
    ) -> Result<CachePage> {
        let inner = self.inner.lock().await;
        read_list(
            profile_nodes(&inner, &profile_id)?,
            &folder_id,
            offset,
            limit,
        )
    }
    pub async fn query_library(
        &self,
        profile_id: Id,
        query: LibraryQuery,
    ) -> Result<LibraryQueryPage> {
        query.validate()?;
        let storage = {
            let inner = self.inner.lock().await;
            profile_nodes(&inner, &profile_id)?;
            inner.storage()?.share()
        };
        storage.query_library(profile_id, query).await
    }
    pub async fn search(
        &self,
        profile_id: Id,
        query: &str,
        folder_id: Option<Id>,
        limit: u64,
    ) -> Result<Vec<BookmarkNode>> {
        let inner = self.inner.lock().await;
        read_search(
            profile_nodes(&inner, &profile_id)?,
            query,
            folder_id.as_ref(),
            limit,
        )
    }
    pub async fn get(&self, profile_id: Id, chrome_id: Id) -> Result<CacheNode> {
        let inner = self.inner.lock().await;
        read_get(profile_nodes(&inner, &profile_id)?, &chrome_id)
    }
    pub async fn count(&self, profile_id: Id, folder_id: Option<Id>) -> Result<CacheCount> {
        let inner = self.inner.lock().await;
        read_count(profile_nodes(&inner, &profile_id)?, folder_id.as_ref())
    }
    async fn connect_extension(
        &self,
        origin: &PairedOrigin,
        message: &WireMessage,
    ) -> Result<AuthSession> {
        let _keep_credentials_field_live = &self.credentials;
        let WireMessage::Hello {
            profile_id,
            session_id,
            payload,
            ..
        } = message
        else {
            return Err(ErrorCode::InvalidMessage);
        };
        let mut inner = self.inner.lock().await;
        let existing_key = inner
            .profiles
            .iter()
            .find(|(_, profile)| {
                !matches!(profile.identity.origin, ProfileOrigin::LocalSkills)
                    && profile.identity.instance_id == payload.instance_id
            })
            .map(|(key, _)| key.clone());
        let resolved_key = if let Some(key) = existing_key {
            if profile_id.as_str() != "pending" && profile_id.as_str() != key {
                return Err(ErrorCode::WrongProfile);
            }
            key
        } else {
            if profile_id.as_str() == crate::storage::LOCAL_SKILLS_PROFILE_ID
                || (profile_id.as_str() != "pending"
                    && inner.profiles.contains_key(profile_id.as_str()))
            {
                return Err(ErrorCode::WrongProfile);
            }
            let new_profile_id = random_id("p")?;
            let display_name =
                pick_chrome_display_name(&inner.profiles, payload.display_name_hint.as_ref());
            let identity = Profile {
                id: new_profile_id.clone(),
                instance_id: payload.instance_id.clone(),
                source_epoch: SourceEpoch::new(1)?,
                display_name: display_name.clone(),
                paired_origin: origin.clone(),
                credential_reference: None,
            };
            inner.storage()?.create_profile(identity.clone()).await?;
            let view = BridgeProfile {
                profile_id: new_profile_id.clone(),
                instance_id: payload.instance_id.clone(),
                display_name,
                connection: BridgeConnection::Connecting,
                write_paused: false,
                ignored: false,
                node_count: Counter::new(0)?,
                revision: Counter::new(0)?,
                last_synced_at: RequiredNullable(None),
                error_code: RequiredNullable(None),
            };
            let key = new_profile_id.as_str().to_owned();
            inner.profiles.insert(
                key.clone(),
                ActiveProfile {
                    identity: identity.into(),
                    view,
                    ignored: false,
                    session: None,
                    close: None,
                    nodes: vec![],
                    seq: 0,
                    awaiting_tree: None,
                    outbound: None,
                    busy: false,
                    writes_blocked: false,
                    batch_hold: None,
                },
            );
            key
        };
        let (ignored_now, profile_origin, stored_id) = {
            let profile = inner
                .profiles
                .get(&resolved_key)
                .ok_or(ErrorCode::WrongProfile)?;
            (
                profile.ignored,
                profile.identity.origin.clone(),
                profile.identity.id.clone(),
            )
        };
        if profile_origin != ProfileOrigin::Chrome(origin.clone()) {
            return Err(ErrorCode::WrongProfile);
        }
        if ignored_now {
            if !payload.user_initiated {
                return Err(ErrorCode::ProfileIgnored);
            }
            inner.storage()?.set_ignored(stored_id, false).await?;
        }
        let profile = inner
            .profiles
            .get_mut(&resolved_key)
            .ok_or(ErrorCode::WrongProfile)?;
        if ignored_now && payload.user_initiated {
            profile.ignored = false;
            profile.view.ignored = false;
        }
        // A session ID cannot be reused by a second transport.
        if profile.session.as_ref() == Some(session_id) {
            return Err(ErrorCode::Conflict);
        }
        profile.disconnect();
        let (close, closed) = watch::channel(false);
        profile.session = Some(session_id.clone());
        profile.seq = 0;
        profile.close = Some(close);
        profile.view.connection = BridgeConnection::Reconciling;
        profile.view.error_code.0 = None;
        let auth = AuthSession {
            profile_id: profile.identity.id.clone(),
            display_name: profile.identity.display_name.clone(),
            source_epoch: profile.identity.source_epoch,
            write_paused: profile.view.write_paused,
            closed,
        };
        self.publish(&mut inner);
        Ok(auth)
    }
    async fn request_tree(&self, profile_id: &Id, session_id: &Id) -> Result<Option<WireMessage>> {
        let mut inner = self.inner.lock().await;
        let profile = inner.authenticated(profile_id, session_id)?;
        if profile.awaiting_tree.is_some() {
            return Ok(None);
        }
        profile.view.connection = BridgeConnection::Reconciling;
        let request_id = random_id("tree")?;
        profile.awaiting_tree = Some(request_id.clone());
        self.publish(&mut inner);
        envelope(
            "get_tree",
            profile_id,
            session_id,
            Some(request_id),
            serde_json::json!({}),
        )
        .map(Some)
    }
    async fn receive(&self, message: WireMessage) -> Result<bool> {
        let (profile_id, session_id) = message.identity();
        let mut inner = self.inner.lock().await;
        if let WireMessage::OperationReceipt { payload, .. } = &message {
            inner.authenticated(profile_id, session_id)?;
            let receipt = payload.as_ref().clone();
            edit::accept_receipt(&mut inner, profile_id, &receipt).await?;
            organization::on_receipt(self, &mut inner, profile_id, &receipt.operation_id).await?;
            batch_edit::on_receipt(self, &mut inner, profile_id, &receipt.operation_id).await?;
            self.publish(&mut inner);
            return Ok(false);
        }
        let profile = inner.authenticated(profile_id, session_id)?;
        let (mut snapshot, needs_resync) = match &message {
            WireMessage::TreeFull {
                payload,
                request_id,
                ..
            } => {
                if request_id.0 != profile.awaiting_tree {
                    return Err(ErrorCode::InvalidMessage);
                }
                if payload.barrier_seq.get() < profile.seq {
                    profile.awaiting_tree = None;
                    return Ok(true);
                }
                (payload.clone(), false)
            }
            WireMessage::Event { seq, payload, .. } => {
                if payload.source_epoch != profile.identity.source_epoch {
                    return Err(ErrorCode::WrongProfile);
                }
                if profile.view.connection != BridgeConnection::Live {
                    return Ok(false);
                }
                let seq = seq.0.ok_or(ErrorCode::InvalidMessage)?.get();
                if seq <= profile.seq {
                    return Ok(false);
                }
                if seq != profile.seq + 1 {
                    return Ok(true);
                }
                let mut nodes = profile.nodes.clone();
                let resync = sync::apply_event(&mut nodes, &payload.event).is_err();
                (
                    TreeSnapshot {
                        source_epoch: payload.source_epoch,
                        revision: profile.view.revision,
                        barrier_seq: Counter::new(seq)?,
                        nodes,
                    },
                    resync,
                )
            }
            _ => return Err(ErrorCode::ReadOnly),
        };
        if needs_resync {
            return Ok(true);
        }
        if snapshot.source_epoch != profile.identity.source_epoch {
            return Err(ErrorCode::WrongProfile);
        }
        snapshot.revision = Counter::new(profile.view.revision.get() + 1)?;
        if snapshot.validate().is_err() {
            return Ok(true);
        }
        let id = profile_id.clone();
        let session = session_id.clone();
        if matches!(message, WireMessage::Event { .. }) {
            let previous = profile.nodes.clone();
            inner
                .storage()?
                .replace_tree_delta(id.clone(), session, previous, snapshot.clone())
                .await?;
        } else {
            inner
                .storage()?
                .replace_tree(id.clone(), session, snapshot.clone())
                .await?;
        }
        let became_live = {
            let profile = inner
                .profiles
                .get_mut(id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            let became_live = profile.view.connection != BridgeConnection::Live;
            profile.nodes = snapshot.nodes;
            profile.seq = snapshot.barrier_seq.get();
            profile.view.node_count = Counter::new(profile.nodes.len() as u64)?;
            profile.view.revision = snapshot.revision;
            profile.view.last_synced_at.0 = Some(Counter::new(now()?)?);
            profile.view.connection = BridgeConnection::Live;
            profile.view.error_code.0 = None;
            profile.awaiting_tree = None;
            became_live
        };
        if let Ok(storage) = inner.storage() {
            let _ = storage
                .copy_mapped_metadata(id.clone(), snapshot.source_epoch, now()?)
                .await;
        }
        if became_live {
            edit::queue_status(&mut inner, &id).await;
        }
        self.publish(&mut inner);
        Ok(false)
    }
    async fn disconnected(&self, profile_id: &Id, session_id: &Id, error: Option<ErrorCode>) {
        let mut inner = self.inner.lock().await;
        let matched = inner
            .profiles
            .get(profile_id.as_str())
            .is_some_and(|profile| profile.session.as_ref() == Some(session_id));
        if !matched {
            return;
        }
        if let Some(profile) = inner.profiles.get_mut(profile_id.as_str()) {
            profile.disconnect();
            profile.view.error_code.0 = error;
        }
        let frozen = match inner.storage() {
            Ok(storage) => storage
                .freeze_profile(profile_id.clone())
                .await
                .unwrap_or(0),
            Err(_) => 0,
        };
        if frozen > 0
            && let Some(profile) = inner.profiles.get_mut(profile_id.as_str())
        {
            profile.writes_blocked = true;
            profile.batch_hold = None;
        }
        self.publish(&mut inner);
    }
}
impl ActiveProfile {
    pub(super) fn check_browser_writable(&self) -> Result<()> {
        if matches!(self.identity.origin, ProfileOrigin::LocalSkills) {
            return Err(ErrorCode::ReadOnly);
        }
        if self.ignored || self.view.ignored {
            return Err(ErrorCode::ProfileIgnored);
        }
        if self.view.write_paused {
            return Err(ErrorCode::WritePaused);
        }
        if self.view.connection != BridgeConnection::Live {
            return Err(ErrorCode::ReadOnly);
        }
        Ok(())
    }
    fn disconnect(&mut self) {
        if let Some(close) = self.close.take() {
            close.send_replace(true);
        }
        self.session = None;
        self.awaiting_tree = None;
        self.outbound = None;
        self.busy = false;
        self.view.connection = if self.ignored {
            BridgeConnection::Ignored
        } else {
            BridgeConnection::CachedReadOnly
        };
    }
}
impl Inner {
    fn storage(&self) -> Result<&Storage> {
        self.storage.as_ref().ok_or(ErrorCode::Cancelled)
    }
    fn authenticated(&mut self, profile_id: &Id, session_id: &Id) -> Result<&mut ActiveProfile> {
        let profile = self
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::Unpaired)?;
        if profile.ignored || profile.session.as_ref() != Some(session_id) {
            return Err(ErrorCode::WrongProfile);
        }
        Ok(profile)
    }
    fn view(&self) -> BridgeState {
        BridgeState {
            protocol_version: Version::new(1).expect("constant"),
            revision: Counter::new(self.revision).expect("process revision fits"),
            port: RequiredNullable(self.port),
            error_code: RequiredNullable(self.error),
            profiles: self.profiles.values().map(|p| p.view.clone()).collect(),
            mirrors: self
                .mirrors
                .values()
                .map(|mirror| mirror.view.clone())
                .collect(),
        }
    }
}
pub(crate) fn now() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::StorageError)?
        .as_millis() as u64)
}
fn random_secret() -> Result<String> {
    let mut bytes = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| ErrorCode::StorageError)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn random_id(prefix: &str) -> Result<Id> {
    Id::new(format!("{prefix}:{}", random_secret()?))
}
fn pick_chrome_display_name(
    profiles: &BTreeMap<String, ActiveProfile>,
    hint: Option<&DisplayName>,
) -> DisplayName {
    let used: HashSet<&str> = profiles
        .values()
        .filter(|item| !matches!(item.identity.origin, ProfileOrigin::LocalSkills))
        .map(|item| item.identity.display_name.as_str())
        .collect();
    if let Some(hint) = hint {
        let trimmed = hint.as_str().trim();
        if !trimmed.is_empty()
            && trimmed != crate::storage::LOCAL_SKILLS_PROFILE_ID
            && !used.contains(trimmed)
            && let Ok(valid) = DisplayName::new(trimmed)
        {
            return valid;
        }
    }
    let mut index = 1_usize;
    loop {
        let candidate = format!("Chrome 资料 {index}");
        if !used.contains(candidate.as_str()) {
            return DisplayName::new(candidate).expect("default name fits 128 chars");
        }
        index += 1;
    }
}
fn profile_nodes<'a>(inner: &'a Inner, profile_id: &Id) -> Result<&'a [BookmarkNode]> {
    inner
        .profiles
        .get(profile_id.as_str())
        .map(|profile| profile.nodes.as_slice())
        .ok_or(ErrorCode::WrongProfile)
}
struct CacheIndex<'a> {
    by_id: HashMap<&'a str, &'a BookmarkNode>,
    children: HashMap<&'a str, Vec<&'a BookmarkNode>>,
    roots: Vec<&'a BookmarkNode>,
}
impl<'a> CacheIndex<'a> {
    fn children_of(&self, parent: &str) -> &[&'a BookmarkNode] {
        self.children.get(parent).map(Vec::as_slice).unwrap_or(&[])
    }
}
fn cache_index(nodes: &[BookmarkNode]) -> Result<CacheIndex<'_>> {
    let mut by_id = HashMap::with_capacity(nodes.len());
    for node in nodes {
        if by_id.insert(node.chrome_id.as_str(), node).is_some() {
            return Err(ErrorCode::InvalidTree);
        }
    }
    let mut children: HashMap<&str, Vec<&BookmarkNode>> = HashMap::new();
    let mut roots = Vec::new();
    for node in nodes {
        let Some(parent) = &node.parent_id else {
            roots.push(node);
            continue;
        };
        let parent_node = *by_id.get(parent.as_str()).ok_or(ErrorCode::InvalidTree)?;
        if parent_node.kind != NodeKind::Folder {
            return Err(ErrorCode::InvalidTree);
        }
        children.entry(parent.as_str()).or_default().push(node);
    }
    roots.sort_by_key(|node| node.position.get());
    for group in children.values_mut() {
        group.sort_by_key(|node| node.position.get());
    }
    Ok(CacheIndex {
        by_id,
        children,
        roots,
    })
}
fn read_tree(
    nodes: &[BookmarkNode],
    folder_id: Option<&Id>,
    depth: u64,
) -> Result<Vec<CacheTreeNode>> {
    let index = cache_index(nodes)?;
    let roots = match folder_id {
        Some(id) => vec![*index.by_id.get(id.as_str()).ok_or(ErrorCode::InvalidTree)?],
        None => index.roots.clone(),
    };
    let mut tree = Vec::with_capacity(roots.len());
    for node in roots {
        tree.push(cache_branch(&index, node, depth, 0, &mut HashSet::new())?);
    }
    Ok(tree)
}
fn cache_branch<'a>(
    index: &CacheIndex<'a>,
    node: &'a BookmarkNode,
    depth: u64,
    level: u64,
    stack: &mut HashSet<&'a str>,
) -> Result<CacheTreeNode> {
    if !stack.insert(node.chrome_id.as_str()) {
        return Err(ErrorCode::InvalidTree);
    }
    let mut children = Vec::new();
    if depth == 0 || level < depth {
        for child in index.children_of(node.chrome_id.as_str()) {
            children.push(cache_branch(index, child, depth, level + 1, stack)?);
        }
    }
    stack.remove(node.chrome_id.as_str());
    Ok(CacheTreeNode {
        node: node.clone(),
        children,
    })
}
fn read_list(nodes: &[BookmarkNode], folder_id: &Id, offset: u64, limit: u64) -> Result<CachePage> {
    let index = cache_index(nodes)?;
    let folder = *index
        .by_id
        .get(folder_id.as_str())
        .ok_or(ErrorCode::InvalidTree)?;
    if folder.kind != NodeKind::Folder {
        return Err(ErrorCode::InvalidTree);
    }
    let children = index.children_of(folder_id.as_str());
    let total = u64::try_from(children.len()).unwrap_or(u64::MAX);
    let start = usize::try_from(offset)
        .unwrap_or(usize::MAX)
        .min(children.len());
    let end = start
        .saturating_add(usize::try_from(limit).unwrap_or(usize::MAX))
        .min(children.len());
    Ok(CachePage {
        items: children[start..end].iter().copied().cloned().collect(),
        total,
    })
}
fn read_search(
    nodes: &[BookmarkNode],
    query: &str,
    folder_id: Option<&Id>,
    limit: u64,
) -> Result<Vec<BookmarkNode>> {
    if query.is_empty() {
        return Err(ErrorCode::InvalidMessage);
    }
    let index = cache_index(nodes)?;
    let roots = if let Some(id) = folder_id {
        let folder = *index.by_id.get(id.as_str()).ok_or(ErrorCode::InvalidTree)?;
        if folder.kind != NodeKind::Folder {
            return Err(ErrorCode::InvalidTree);
        }
        vec![folder]
    } else {
        index.roots.clone()
    };
    let mut found = Vec::new();
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    let mut stack = HashSet::new();
    for root in roots {
        search_branch(&index, root, query, limit, &mut found, &mut stack)?;
        if found.len() >= limit {
            break;
        }
    }
    Ok(found)
}
fn search_hit(node: &BookmarkNode, query: &str) -> bool {
    node.title.as_str().contains(query)
        || node
            .url
            .as_ref()
            .is_some_and(|url| url.as_str().contains(query))
}
fn search_branch<'a>(
    index: &CacheIndex<'a>,
    node: &'a BookmarkNode,
    query: &str,
    limit: usize,
    found: &mut Vec<BookmarkNode>,
    stack: &mut HashSet<&'a str>,
) -> Result<()> {
    if found.len() >= limit {
        return Ok(());
    }
    if !stack.insert(node.chrome_id.as_str()) {
        return Err(ErrorCode::InvalidTree);
    }
    if search_hit(node, query) {
        found.push(node.clone());
    }
    if found.len() < limit {
        for child in index.children_of(node.chrome_id.as_str()) {
            search_branch(index, child, query, limit, found, stack)?;
            if found.len() >= limit {
                break;
            }
        }
    }
    stack.remove(node.chrome_id.as_str());
    Ok(())
}
fn read_get(nodes: &[BookmarkNode], chrome_id: &Id) -> Result<CacheNode> {
    let index = cache_index(nodes)?;
    let node = *index
        .by_id
        .get(chrome_id.as_str())
        .ok_or(ErrorCode::InvalidTree)?;
    let mut ancestors = Vec::new();
    let mut current = node;
    let mut seen = HashSet::new();
    while let Some(parent_id) = &current.parent_id {
        if !seen.insert(current.chrome_id.as_str()) {
            return Err(ErrorCode::InvalidTree);
        }
        let parent = *index
            .by_id
            .get(parent_id.as_str())
            .ok_or(ErrorCode::InvalidTree)?;
        ancestors.push(parent.title.clone());
        current = parent;
    }
    ancestors.reverse();
    Ok(CacheNode {
        node: node.clone(),
        ancestors,
    })
}
fn read_count(nodes: &[BookmarkNode], folder_id: Option<&Id>) -> Result<CacheCount> {
    let index = cache_index(nodes)?;
    let mut count = CacheCount {
        folders: 0,
        bookmarks: 0,
    };
    if let Some(id) = folder_id {
        let folder = *index.by_id.get(id.as_str()).ok_or(ErrorCode::InvalidTree)?;
        if folder.kind != NodeKind::Folder {
            return Err(ErrorCode::InvalidTree);
        }
        let mut stack = HashSet::from([folder.chrome_id.as_str()]);
        count_descendants(&index, folder.chrome_id.as_str(), &mut count, &mut stack)?;
    } else {
        for node in nodes {
            tally(&mut count, node);
        }
    }
    Ok(count)
}
fn count_descendants<'a>(
    index: &CacheIndex<'a>,
    parent: &str,
    count: &mut CacheCount,
    stack: &mut HashSet<&'a str>,
) -> Result<()> {
    for child in index.children_of(parent) {
        if !stack.insert(child.chrome_id.as_str()) {
            return Err(ErrorCode::InvalidTree);
        }
        tally(count, child);
        count_descendants(index, child.chrome_id.as_str(), count, stack)?;
        stack.remove(child.chrome_id.as_str());
    }
    Ok(())
}
fn tally(count: &mut CacheCount, node: &BookmarkNode) {
    match node.kind {
        NodeKind::Folder => count.folders += 1,
        NodeKind::Bookmark => count.bookmarks += 1,
    }
}
fn envelope(
    kind: &str,
    profile: &Id,
    session: &Id,
    request: Option<Id>,
    payload: serde_json::Value,
) -> Result<WireMessage> {
    let message: WireMessage = serde_json::from_value(serde_json::json!({"type":kind, "protocolVersion":1, "profileId":profile, "sessionId":session, "requestId":request, "seq":null, "payload":payload})).map_err(|_| ErrorCode::InvalidMessage)?;
    message.validate()?;
    Ok(message)
}

#[cfg(test)]
mod tests;
