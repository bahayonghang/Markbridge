//! Authenticated loopback bridge. Browser mutations are sent to the extension; this process does not call Chrome.
mod ai;
mod batch_edit;
pub mod credentials;
mod edit;
mod history;
mod semantic;
pub use history::ExportSnapshot;
mod file_mirror;
mod maintenance;
mod organization;
mod sync;
mod tags;
mod transport;

use crate::preview::Gate;
use crate::storage::{PairedOrigin, Profile, Storage};
use credentials::CredentialStore;
use markbridge_protocol::*;
use rand::{TryRngCore, rngs::OsRng};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, mpsc, watch};

type Result<T> = std::result::Result<T, ErrorCode>;

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
    preview: Gate,
    links: Gate,
    link_net: Arc<std::sync::Mutex<Arc<dyn crate::preview::Network>>>,
}
struct Pending {
    view: PendingPairing,
    credential: String,
    approved: bool,
}
struct ActiveProfile {
    identity: Profile,
    view: BridgeProfile,
    revoked: bool,
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
// Cancellation after an OS write must not leave an unreferenced usable credential.
struct NewCredential {
    store: Arc<dyn CredentialStore>,
    reference: Id,
    committed: bool,
}
impl Drop for NewCredential {
    fn drop(&mut self) {
        if !self.committed {
            let _ = self.store.delete(self.reference.as_str());
        }
    }
}
struct Inner {
    edit_previews: HashMap<String, batch_edit::Prepared>,
    storage: Option<Storage>,
    profiles: BTreeMap<String, ActiveProfile>,
    pending: BTreeMap<String, Pending>,
    mirrors: BTreeMap<String, file_mirror::ActiveMirror>,
    listener: Option<Listener>,
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
                connection: if stored.revoked {
                    BridgeConnection::Unpaired
                } else {
                    BridgeConnection::CachedReadOnly
                },
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
                    revoked: stored.revoked,
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
            pending: BTreeMap::new(),
            mirrors,
            listener: None,
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
            preview: Gate::default(),
            links: Gate::default(),
            link_net: Arc::new(std::sync::Mutex::new(Arc::new(
                crate::preview::SystemNetwork,
            ))),
        };
        bridge.arm_saved_watches().await;
        Ok(bridge)
    }
    pub fn subscribe(&self) -> watch::Receiver<BridgeState> {
        self.state.subscribe()
    }
    pub async fn state(&self) -> BridgeState {
        let mut inner = self.inner.lock().await;
        if inner.expire() {
            self.publish(&mut inner);
        }
        inner.view()
    }
    fn publish(&self, inner: &mut Inner) {
        inner.revision += 1;
        self.state.send_replace(inner.view());
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
        Ok(inner.view())
    }
    pub async fn begin_pairing(&self, display_name: String) -> Result<PairingOffer> {
        let display_name = DisplayName::new(display_name)?;
        let mut inner = self.inner.lock().await;
        inner.expire();
        let port = inner.port.ok_or(ErrorCode::ReadOnly)?;
        if inner.pending.len() >= 8 {
            return Err(ErrorCode::LimitExceeded);
        }
        let profile_id = random_id("p")?;
        let credential = random_secret()?;
        let expires_at = Counter::new(now()? + 120_000)?;
        let pairing_code = serde_json::json!({ "protocolVersion": 1, "port": port, "profileId": profile_id, "credential": credential, "expiresAt": expires_at }).to_string();
        inner.pending.insert(
            profile_id.as_str().to_owned(),
            Pending {
                view: PendingPairing {
                    profile_id: profile_id.clone(),
                    display_name,
                    instance_id: RequiredNullable(None),
                    origin: RequiredNullable(None),
                    expires_at,
                },
                credential,
                approved: false,
            },
        );
        self.publish(&mut inner);
        Ok(PairingOffer {
            profile_id,
            pairing_code,
            expires_at,
        })
    }
    pub async fn confirm_pairing(&self, profile_id: Id, instance_id: Id) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        inner.expire();
        let pending = inner
            .pending
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::Unpaired)?;
        if pending.view.instance_id.0.as_ref() != Some(&instance_id)
            || pending.view.origin.0.is_none()
        {
            return Err(ErrorCode::WrongProfile);
        }
        pending.approved = true;
        self.publish(&mut inner);
        Ok(inner.view())
    }
    pub async fn cancel_pairing(&self, profile_id: Id) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        inner.pending.remove(profile_id.as_str());
        self.publish(&mut inner);
        Ok(inner.view())
    }
    pub async fn revoke_pairing(&self, profile_id: Id) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        let profile = inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        profile.revoked = true;
        profile.disconnect();
        let reference = profile.identity.credential_reference.clone();
        self.publish(&mut inner);
        // In-memory authority ends before either persistent operation can fail.
        inner.storage()?.revoke_profile(profile_id.clone()).await?;
        inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?
            .identity
            .credential_reference = None;
        if let Some(reference) = reference {
            self.delete_credential(reference).await?;
        }
        Ok(inner.view())
    }
    pub async fn reconnect_profile(&self, profile_id: Id) -> Result<BridgeState> {
        let mut inner = self.inner.lock().await;
        let profile = inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::WrongProfile)?;
        if profile.revoked {
            return Err(ErrorCode::Unpaired);
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
        let listener = {
            let mut inner = self.inner.lock().await;
            inner.port = None;
            inner.pending.clear();
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
    async fn delete_credential(&self, reference: Id) -> Result<()> {
        let store = self.credentials.clone();
        tokio::task::spawn_blocking(move || store.delete(reference.as_str()))
            .await
            .map_err(|_| ErrorCode::StorageError)?
    }
    async fn pair(&self, origin: &PairedOrigin, message: &WireMessage) -> Result<Option<String>> {
        let WireMessage::Pair {
            profile_id,
            payload,
            ..
        } = message
        else {
            return Err(ErrorCode::InvalidMessage);
        };
        let mut inner = self.inner.lock().await;
        inner.expire();
        let pending = inner
            .pending
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::Unpaired)?;
        if !constant_equal(&pending.credential, payload.credential.as_str()) {
            return Err(ErrorCode::Unpaired);
        }
        if let Some(instance) = &pending.view.instance_id.0 {
            if instance != &payload.instance_id
                || pending.view.origin.0.as_deref() != Some(origin.as_str())
            {
                return Err(ErrorCode::WrongProfile);
            }
        } else {
            pending.view.instance_id.0 = Some(payload.instance_id.clone());
            pending.view.origin.0 = Some(origin.as_str().to_owned());
        }
        if !pending.approved {
            self.publish(&mut inner);
            return Ok(None);
        }
        let display_name = pending.view.display_name.clone();
        let secret = random_secret()?;
        let reference = random_id("credential")?;
        let store = self.credentials.clone();
        let key = reference.clone();
        let value = secret.clone();
        let mut credential = tokio::task::spawn_blocking(move || {
            store.set(key.as_str(), &value)?;
            Ok::<_, ErrorCode>(NewCredential {
                store,
                reference: key,
                committed: false,
            })
        })
        .await
        .map_err(|_| ErrorCode::StorageError)??;
        let identity = Profile {
            id: profile_id.clone(),
            instance_id: payload.instance_id.clone(),
            source_epoch: SourceEpoch::new(1)?,
            display_name: display_name.clone(),
            paired_origin: origin.clone(),
            credential_reference: Some(reference.clone()),
        };
        inner.storage()?.create_profile(identity.clone()).await?;
        credential.committed = true;
        let view = BridgeProfile {
            profile_id: profile_id.clone(),
            instance_id: payload.instance_id.clone(),
            display_name,
            connection: BridgeConnection::Connecting,
            node_count: Counter::new(0)?,
            revision: Counter::new(0)?,
            last_synced_at: RequiredNullable(None),
            error_code: RequiredNullable(None),
        };
        inner.profiles.insert(
            profile_id.as_str().to_owned(),
            ActiveProfile {
                identity,
                view,
                revoked: false,
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
        inner.pending.remove(profile_id.as_str());
        self.publish(&mut inner);
        Ok(Some(secret))
    }
    async fn authenticate(
        &self,
        origin: &PairedOrigin,
        message: &WireMessage,
    ) -> Result<(SourceEpoch, watch::Receiver<bool>)> {
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
        let profile = inner
            .profiles
            .get_mut(profile_id.as_str())
            .ok_or(ErrorCode::Unpaired)?;
        if profile.revoked
            || profile.identity.instance_id != payload.instance_id
            || profile.identity.paired_origin != *origin
        {
            return Err(ErrorCode::WrongProfile);
        }
        let reference = profile
            .identity
            .credential_reference
            .clone()
            .ok_or(ErrorCode::Unpaired)?;
        let store = self.credentials.clone();
        let secret = tokio::task::spawn_blocking(move || store.get(reference.as_str()))
            .await
            .map_err(|_| ErrorCode::StorageError)??;
        if !constant_equal(&secret, payload.credential.as_str()) {
            return Err(ErrorCode::Unpaired);
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
        let epoch = profile.identity.source_epoch;
        self.publish(&mut inner);
        Ok((epoch, closed))
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
    fn disconnect(&mut self) {
        if let Some(close) = self.close.take() {
            close.send_replace(true);
        }
        self.session = None;
        self.awaiting_tree = None;
        self.outbound = None;
        self.busy = false;
        self.view.connection = if self.revoked {
            BridgeConnection::Unpaired
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
        if profile.revoked || profile.session.as_ref() != Some(session_id) {
            return Err(ErrorCode::WrongProfile);
        }
        Ok(profile)
    }
    fn expire(&mut self) -> bool {
        let before = self.pending.len();
        let now = now().unwrap_or(u64::MAX);
        self.pending
            .retain(|_, pending| pending.view.expires_at.get() > now);
        self.pending.len() != before
    }
    fn view(&self) -> BridgeState {
        BridgeState {
            protocol_version: Version::new(1).expect("constant"),
            revision: Counter::new(self.revision).expect("process revision fits"),
            port: RequiredNullable(self.port),
            error_code: RequiredNullable(self.error),
            profiles: self.profiles.values().map(|p| p.view.clone()).collect(),
            pending: self.pending.values().map(|p| p.view.clone()).collect(),
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
fn constant_equal(a: &str, b: &str) -> bool {
    bool::from(a.as_bytes().ct_eq(b.as_bytes()))
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
