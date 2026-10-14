//! One full-page preview window. Remote pages get no application capability.
use markbridge_protocol::{
    ErrorCode, Id, RequiredNullable, WebPreviewNotice, WebPreviewPhase, WebPreviewState,
};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const PREVIEW_LABEL: &str = "preview-active";

pub fn caller_may_control(label: &str) -> bool {
    label == "main"
}

pub struct PreviewHost {
    root: PathBuf,
    inner: std::sync::Mutex<Inner>,
    op: tokio::sync::Mutex<()>,
    #[cfg(any(target_os = "macos", target_os = "linux", test))]
    clearing: std::sync::Mutex<std::collections::BTreeSet<String>>,
    #[cfg(target_os = "linux")]
    contexts: std::sync::Mutex<
        std::collections::BTreeMap<PathBuf, glib::SendWeakRef<webkit2gtk::WebContext>>,
    >,
}

struct Inner {
    generation: u64,
    current: Option<Current>,
}

struct Current {
    generation: u64,
    profile_id: Id,
    chrome_id: Id,
    request_id: Id,
    selected_url: String,
    current_url: Option<String>,
    phase: WebPreviewPhase,
    can_go_back: bool,
    can_go_forward: bool,
    notice: Option<WebPreviewNotice>,
    open: bool,
    recent_deny: Option<Instant>,
    #[cfg(any(target_os = "macos", target_os = "linux", test))]
    native_sequence: u64,
    #[cfg(any(target_os = "macos", target_os = "linux", test))]
    native_load: Option<NativeLoad>,
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
struct NativeLoad {
    token: NativeNavigation,
    failed: bool,
    // The macOS history watch is the only runtime reader. Linux completes loads from WebKit signals.
    #[cfg(any(target_os = "macos", test))]
    started: Instant,
}
#[cfg(any(target_os = "macos", target_os = "linux", test))]
#[derive(Clone, PartialEq, Eq)]
struct NativeNavigation {
    generation: u64,
    sequence: u64,
    profile_id: Id,
    request_id: Id,
}

impl PreviewHost {
    pub fn new(app_data: PathBuf) -> Result<Self, ErrorCode> {
        let root = app_data.join("preview-sessions");
        if !app_data.is_absolute() {
            return Err(ErrorCode::StorageError);
        }
        reject_redirected_ancestors(&root)?;
        std::fs::create_dir_all(&root).map_err(|_| ErrorCode::StorageError)?;
        Ok(Self {
            root,
            inner: std::sync::Mutex::new(Inner {
                generation: 0,
                current: None,
            }),
            op: tokio::sync::Mutex::new(()),
            #[cfg(any(target_os = "macos", target_os = "linux", test))]
            clearing: std::sync::Mutex::new(std::collections::BTreeSet::new()),
            #[cfg(target_os = "linux")]
            contexts: std::sync::Mutex::new(std::collections::BTreeMap::new()),
        })
    }

    pub fn snapshot(&self) -> WebPreviewState {
        self.lock().snapshot()
    }

    #[cfg(any(target_os = "macos", target_os = "linux", test))]
    fn clear_pending(&self, profile: &str) -> bool {
        self.clearing
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .contains(profile)
    }

    #[cfg(any(target_os = "macos", target_os = "linux", test))]
    fn begin_clear(&self, profile: &str) -> bool {
        self.clearing
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(profile.to_owned())
    }
    #[cfg(any(target_os = "macos", target_os = "linux", test))]
    fn end_clear(&self, profile: &str) {
        self.clearing
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(profile);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    async fn clear_native_session(
        &self,
        app: &AppHandle,
        profile: &Id,
        dir: &Path,
        legacy: Option<&Path>,
    ) -> bool {
        if !self.begin_clear(profile.as_str()) {
            return false;
        }
        let app = app.clone();
        let root = self.root.clone();
        let profile = profile.clone();
        let directories: Vec<PathBuf> = std::iter::once(dir.to_path_buf())
            .chain(legacy.map(Path::to_path_buf))
            .collect();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        // The task survives the caller's bounded wait. A timed-out Profile stays blocked until native completion.
        tauri::async_runtime::spawn(async move {
            let guard_root = root.clone();
            let guard_dirs = directories.clone();
            #[cfg(target_os = "linux")]
            let guard_profile = profile.as_str().to_owned();
            #[cfg(target_os = "linux")]
            let legacy_retained = directories.get(1).is_some_and(|legacy| {
                app.state::<PreviewHost>()
                    .contexts
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .contains_key(legacy)
            });
            #[cfg(not(target_os = "linux"))]
            let legacy_retained = false;
            let guarded = !legacy_retained
                && tauri::async_runtime::spawn_blocking(move || {
                    #[cfg(target_os = "linux")]
                    {
                        // Migrate a closed legacy-only store before creating a context. Both-present conflicts retain both.
                        let target = prepare_session_directory(&guard_root, &guard_profile)?;
                        if guard_dirs.first() != Some(&target) {
                            return Err(ErrorCode::StorageError);
                        }
                    }
                    for dir in &guard_dirs {
                        if owned_directory_present(&guard_root, dir)? {
                            reject_tree_links(dir)?;
                        }
                    }
                    Ok::<_, ErrorCode>(())
                })
                .await
                .is_ok_and(|result| result.is_ok());
            let mut cleared = guarded;
            #[cfg(target_os = "macos")]
            if cleared {
                cleared = match native_store_identifier(
                    root.parent().unwrap_or(&root),
                    "preview",
                    Some(profile.as_str()),
                ) {
                    Ok(identifier) => app.remove_data_store(identifier).await.is_ok(),
                    Err(_) => false,
                };
                if cleared {
                    for dir in &directories {
                        if !remove_session_dir(&root, dir).await {
                            cleared = false;
                            break;
                        }
                    }
                }
            }
            #[cfg(target_os = "linux")]
            if cleared {
                // Never create/rename/delete a retained context at the legacy path.
                for dir in directories.iter().take(1) {
                    if clear_linux_directory(&app, &root, dir).await.is_err() {
                        cleared = false;
                        break;
                    }
                }
            }
            if let Some(host) = app.try_state::<PreviewHost>() {
                host.end_clear(profile.as_str());
            }
            let _ = sender.send(cleared);
        });
        await_native_clear(receiver).await
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn begin_native_load(
        &self,
        app: &AppHandle,
        generation: u64,
        url: Option<String>,
    ) -> Option<NativeNavigation> {
        let url = url.as_deref().and_then(http_url_text)?;
        let token = {
            let mut inner = self.lock();
            let current = inner
                .current
                .as_mut()
                .filter(|current| current.open && current.generation == generation)?;
            current.begin_native(url)
        };
        self.publish(app);
        Some(token)
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn native_token(&self, generation: u64) -> Option<NativeNavigation> {
        let inner = self.lock();
        let current = inner.current.as_ref()?;
        let load = current.native_load.as_ref()?;
        (current.generation == generation && current.accepts_native(&load.token))
            .then(|| load.token.clone())
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn finish_native_load(
        &self,
        app: &AppHandle,
        token: &NativeNavigation,
        success: bool,
        url: Option<String>,
    ) {
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return;
            };
            if !current.finish_native(token, success, url) {
                return;
            }
            inner.snapshot()
        };
        emit(app, &state);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn native_history(
        &self,
        app: &AppHandle,
        token: &NativeNavigation,
        back: bool,
        forward: bool,
        url: Option<String>,
    ) {
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return;
            };
            if !current.accepts_native(token) {
                return;
            }
            current.can_go_back = back;
            current.can_go_forward = forward;
            if let Some(url) = url.as_deref().and_then(http_url_text) {
                current.current_url = Some(url);
            }
            inner.snapshot()
        };
        emit(app, &state);
    }

    pub async fn open_page(
        &self,
        app: &AppHandle,
        profile_id: Id,
        chrome_id: Id,
        request_id: Id,
        raw_url: &str,
    ) -> Result<WebPreviewState, ErrorCode> {
        let _op = self.op.lock().await;
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if self.clear_pending(profile_id.as_str()) {
            return Err(ErrorCode::StorageError);
        }
        let url = user_navigation_target(raw_url)?;
        let dir = session_directory(&self.root, profile_id.as_str())?;
        let reuse = {
            let inner = self.lock();
            inner
                .current
                .as_ref()
                .is_some_and(|current| current.open && current.profile_id == profile_id)
        };
        if reuse && let Some(window) = app.get_webview_window(PREVIEW_LABEL) {
            {
                let mut inner = self.lock();
                if let Some(current) = inner.current.as_mut() {
                    current.chrome_id = chrome_id;
                    current.request_id = request_id;
                    current.selected_url = url.to_string();
                    current.phase = WebPreviewPhase::Loading;
                    current.notice = None;
                    #[cfg(target_os = "macos")]
                    current.begin_native(url.to_string());
                }
            }
            window
                .navigate(url)
                .map_err(|_| ErrorCode::InvalidMessage)?;
            let _ = window.set_focus();
            return Ok(self.publish(app));
        }
        self.destroy_preview(app).await?;
        let root = self.root.clone();
        let profile = profile_id.as_str().to_owned();
        tauri::async_runtime::spawn_blocking(move || prepare_session_directory(&root, &profile))
            .await
            .map_err(|_| ErrorCode::StorageError)??;
        let generation = {
            let mut inner = self.lock();
            inner.generation += 1;
            let generation = inner.generation;
            inner.current = Some(Current {
                generation,
                profile_id,
                chrome_id,
                request_id,
                selected_url: url.to_string(),
                current_url: None,
                phase: WebPreviewPhase::Loading,
                can_go_back: false,
                can_go_forward: false,
                notice: None,
                open: true,
                recent_deny: None,
                #[cfg(any(target_os = "macos", target_os = "linux", test))]
                native_sequence: 0,
                #[cfg(any(target_os = "macos", target_os = "linux", test))]
                native_load: None,
            });
            generation
        };
        #[cfg(target_os = "macos")]
        self.begin_native_load(app, generation, Some(url.to_string()));
        if self.build_window(app, &dir, url, generation).await.is_err() {
            self.mark_closed(generation);
            return Err(ErrorCode::InvalidMessage);
        }
        Ok(self.publish(app))
    }

    pub async fn act(&self, app: &AppHandle, action: &str) -> Result<WebPreviewState, ErrorCode> {
        let _op = self.op.lock().await;
        let Some(window) = app.get_webview_window(PREVIEW_LABEL) else {
            return Ok(self.snapshot());
        };
        let open = self
            .lock()
            .current
            .as_ref()
            .is_some_and(|current| current.open);
        if !open {
            return Ok(self.snapshot());
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if action != "close"
            && let Some(current) = self.lock().current.as_mut()
        {
            current.native_load = None;
            current.phase = WebPreviewPhase::Loading;
            #[cfg(target_os = "macos")]
            current.begin_native(
                current
                    .current_url
                    .clone()
                    .unwrap_or_else(|| current.selected_url.clone()),
            );
        }
        match action {
            "back" => history_move(&window, HistoryMove::Back).await?,
            "forward" => history_move(&window, HistoryMove::Forward).await?,
            "reload" => window.reload().map_err(|_| ErrorCode::InvalidMessage)?,
            "close" => {
                self.destroy_preview(app).await?;
            }
            _ => return Err(ErrorCode::InvalidMessage),
        }
        Ok(self.publish(app))
    }

    pub async fn clear_session(
        &self,
        app: &AppHandle,
        profile_id: Id,
        request_id: Id,
    ) -> Result<WebPreviewState, ErrorCode> {
        let _op = self.op.lock().await;
        let dir = session_directory(&self.root, profile_id.as_str())?;
        let legacy = legacy_session_directory(&self.root, profile_id.as_str())?;
        let owns = self
            .lock()
            .current
            .as_ref()
            .is_some_and(|current| current.open && current.profile_id == profile_id);
        if owns {
            self.destroy_preview(app).await?;
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let cleared = self
            .clear_native_session(app, &profile_id, &dir, legacy.as_deref())
            .await;
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let cleared = remove_session_dir(&self.root, &dir).await
            && match legacy {
                Some(legacy) => remove_session_dir(&self.root, &legacy).await,
                None => true,
            };
        self.lock()
            .finish_session_clear(&profile_id, request_id, cleared)?;
        Ok(self.publish(app))
    }

    fn allow_navigation(&self, app: &AppHandle, generation: u64, url: &tauri::Url) -> bool {
        let allowed = navigation_decision(url);
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return false;
            };
            if current.generation != generation || !current.open {
                return false;
            }
            match allowed {
                Ok(()) => {
                    if url.scheme() != "about" {
                        current.phase = WebPreviewPhase::Loading;
                        current.current_url = bounded_url(url.as_str());
                        #[cfg(target_os = "macos")]
                        current.begin_native(url.to_string());
                    }
                }
                Err(notice) => {
                    current.notice = Some(notice);
                    current.recent_deny = Some(Instant::now());
                    if current.phase == WebPreviewPhase::Loading && current.current_url.is_none() {
                        current.phase = WebPreviewPhase::Blocked;
                    }
                }
            }
            inner.snapshot()
        };
        emit(app, &state);
        matches!(allowed, Ok(()))
    }

    #[cfg(windows)]
    fn finish_navigation(
        &self,
        app: &AppHandle,
        generation: u64,
        success: bool,
        url: Option<String>,
    ) {
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return;
            };
            if current.generation != generation || !current.open {
                return;
            }
            if let Some(url) = url.as_deref().and_then(http_url_text) {
                current.current_url = Some(url);
            }
            let denied = current
                .recent_deny
                .is_some_and(|at| at.elapsed() < Duration::from_secs(1));
            if success {
                current.phase = WebPreviewPhase::Ready;
                if matches!(
                    current.notice,
                    Some(
                        WebPreviewNotice::LoadFailed
                            | WebPreviewNotice::SchemeDenied
                            | WebPreviewNotice::UserinfoDenied
                    )
                ) {
                    current.notice = None;
                }
            } else if !denied {
                current.phase = WebPreviewPhase::Failed;
                current.notice = Some(WebPreviewNotice::LoadFailed);
            }
            inner.snapshot()
        };
        emit(app, &state);
    }

    #[cfg(windows)]
    fn note_history(
        &self,
        app: &AppHandle,
        generation: u64,
        back: bool,
        forward: bool,
        url: Option<String>,
    ) {
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return;
            };
            if current.generation != generation || !current.open {
                return;
            }
            current.can_go_back = back;
            current.can_go_forward = forward;
            if let Some(url) = url.as_deref().and_then(http_url_text) {
                current.current_url = Some(url);
            }
            inner.snapshot()
        };
        emit(app, &state);
    }

    #[cfg(windows)]
    fn note_scheme(&self, app: &AppHandle, generation: u64) {
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return;
            };
            if current.generation != generation || !current.open {
                return;
            }
            current.notice = Some(WebPreviewNotice::SchemeDenied);
            current.recent_deny = Some(Instant::now());
            inner.snapshot()
        };
        emit(app, &state);
    }

    fn note(&self, app: &AppHandle, generation: u64, notice: WebPreviewNotice) {
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return;
            };
            if current.generation != generation || !current.open {
                return;
            }
            current.notice = Some(notice);
            inner.snapshot()
        };
        emit(app, &state);
    }

    fn on_destroyed(&self, app: &AppHandle, generation: u64) {
        let state = {
            let mut inner = self.lock();
            let Some(current) = inner.current.as_mut() else {
                return;
            };
            if current.generation != generation {
                return;
            }
            current.open = false;
            current.phase = WebPreviewPhase::Closed;
            current.can_go_back = false;
            current.can_go_forward = false;
            inner.snapshot()
        };
        emit(app, &state);
    }

    async fn destroy_preview(&self, app: &AppHandle) -> Result<(), ErrorCode> {
        let Some(window) = app.get_webview_window(PREVIEW_LABEL) else {
            return Ok(());
        };
        {
            let mut inner = self.lock();
            inner.generation += 1;
            if let Some(current) = inner.current.as_mut() {
                current.open = false;
                current.phase = WebPreviewPhase::Closed;
                current.can_go_back = false;
                current.can_go_forward = false;
            }
        }
        window.destroy().map_err(|_| ErrorCode::InvalidMessage)?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while app.get_webview_window(PREVIEW_LABEL).is_some() {
            if tokio::time::Instant::now() >= deadline {
                return Err(ErrorCode::InvalidMessage);
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        Ok(())
    }

    async fn build_window(
        &self,
        app: &AppHandle,
        dir: &Path,
        url: tauri::Url,
        generation: u64,
    ) -> Result<WebviewWindow, ErrorCode> {
        let app_nav = app.clone();
        let app_popup = app.clone();
        let app_download = app.clone();
        let app_close = app.clone();
        #[cfg(windows)]
        let initial = url.clone();
        #[cfg(not(windows))]
        let initial = tauri::Url::parse("about:blank").map_err(|_| ErrorCode::InvalidMessage)?;
        let builder = WebviewWindowBuilder::new(app, PREVIEW_LABEL, WebviewUrl::External(initial))
            .title("Markbridge 网页预览")
            .inner_size(1100.0, 760.0)
            .position(80.0, 60.0)
            .data_directory(dir.to_path_buf())
            .on_navigation(move |target| {
                app_nav
                    .try_state::<PreviewHost>()
                    .is_some_and(|host| host.allow_navigation(&app_nav, generation, target))
            })
            .on_new_window(move |_target, _features| {
                if let Some(host) = app_popup.try_state::<PreviewHost>() {
                    host.note(&app_popup, generation, WebPreviewNotice::PopupBlocked);
                }
                tauri::webview::NewWindowResponse::Deny
            })
            .on_download(move |_webview, event| {
                if matches!(event, tauri::webview::DownloadEvent::Requested { .. })
                    && let Some(host) = app_download.try_state::<PreviewHost>()
                {
                    host.note(&app_download, generation, WebPreviewNotice::DownloadBlocked);
                }
                false
            });
        #[cfg(target_os = "macos")]
        let builder = {
            ensure_native_store_supported()?;
            let profile = self
                .lock()
                .current
                .as_ref()
                .ok_or(ErrorCode::InvalidMessage)?
                .profile_id
                .clone();
            let builder = builder.data_store_identifier(native_store_identifier(
                self.root.parent().ok_or(ErrorCode::StorageError)?,
                "preview",
                Some(profile.as_str()),
            )?);
            attach_mac_page_events(builder, app.clone(), generation)
        };
        #[cfg(not(windows))]
        let builder = builder.initialization_script(SCHEME_GUARD);
        let window = builder.build().map_err(|_| ErrorCode::InvalidMessage)?;
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Some(host) = app_close.try_state::<PreviewHost>()
            {
                host.on_destroyed(&app_close, generation);
            }
        });
        #[cfg(windows)]
        attach_load_watch(&window, app.clone(), generation);
        #[cfg(target_os = "linux")]
        if attach_linux_watch(&window, app.clone(), dir.to_path_buf(), generation)
            .await
            .is_err()
        {
            let _ = window.destroy();
            return Err(ErrorCode::StorageError);
        }
        #[cfg(target_os = "macos")]
        start_mac_history_watch(&window, app.clone(), generation);
        #[cfg(not(windows))]
        if window.navigate(url).is_err() {
            let _ = window.destroy();
            return Err(ErrorCode::InvalidMessage);
        }
        let _ = window.set_focus();
        Ok(window)
    }

    fn mark_closed(&self, generation: u64) {
        let mut inner = self.lock();
        if let Some(current) = inner.current.as_mut()
            && current.generation == generation
        {
            current.open = false;
            current.phase = WebPreviewPhase::Closed;
        }
    }

    fn publish(&self, app: &AppHandle) -> WebPreviewState {
        let state = self.snapshot();
        emit(app, &state);
        state
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
impl Current {
    #[cfg(any(target_os = "macos", test))]
    fn native_load_timed_out(&self, now: Instant) -> bool {
        self.phase == WebPreviewPhase::Loading
            && self.native_load.as_ref().is_some_and(|load| {
                self.accepts_native(&load.token)
                    && now.saturating_duration_since(load.started) >= Duration::from_secs(30)
            })
    }
    fn begin_native(&mut self, url: String) -> NativeNavigation {
        self.native_sequence += 1;
        let token = NativeNavigation {
            generation: self.generation,
            sequence: self.native_sequence,
            profile_id: self.profile_id.clone(),
            request_id: self.request_id.clone(),
        };
        self.native_load = Some(NativeLoad {
            token: token.clone(),
            failed: false,
            #[cfg(any(target_os = "macos", test))]
            started: Instant::now(),
        });
        self.phase = WebPreviewPhase::Loading;
        self.notice = None;
        self.recent_deny = None;
        self.current_url = Some(url);
        token
    }
    fn accepts_native(&self, token: &NativeNavigation) -> bool {
        self.open
            && self.generation == token.generation
            && self.profile_id == token.profile_id
            && self.request_id == token.request_id
            && self
                .native_load
                .as_ref()
                .is_some_and(|load| load.token == *token)
    }
    fn finish_native(
        &mut self,
        token: &NativeNavigation,
        success: bool,
        url: Option<String>,
    ) -> bool {
        if !self.accepts_native(token) {
            return false;
        }
        if let Some(url) = url.as_deref().and_then(http_url_text) {
            if self
                .current_url
                .as_ref()
                .is_some_and(|expected| expected != &url)
            {
                return false;
            }
            self.current_url = Some(url);
        }
        let denied = self
            .recent_deny
            .is_some_and(|at| at.elapsed() < Duration::from_secs(1));
        let load = self.native_load.as_mut().unwrap();
        if success {
            if load.failed || denied {
                return false;
            }
            self.phase = WebPreviewPhase::Ready;
            if matches!(
                self.notice,
                Some(
                    WebPreviewNotice::LoadFailed
                        | WebPreviewNotice::SchemeDenied
                        | WebPreviewNotice::UserinfoDenied
                )
            ) {
                self.notice = None;
            }
        } else if !denied {
            load.failed = true;
            self.phase = WebPreviewPhase::Failed;
            self.notice = Some(WebPreviewNotice::LoadFailed);
        }
        true
    }
}

impl Inner {
    fn finish_session_clear(
        &mut self,
        profile_id: &Id,
        request_id: Id,
        cleared: bool,
    ) -> Result<(), ErrorCode> {
        let current = self
            .current
            .as_mut()
            .filter(|current| current.profile_id == *profile_id);
        if let Some(current) = current {
            current.request_id = request_id;
            current.notice = Some(if cleared {
                WebPreviewNotice::SessionCleared
            } else {
                WebPreviewNotice::SessionBusy
            });
            if cleared {
                current.open = false;
                current.phase = WebPreviewPhase::Closed;
                current.can_go_back = false;
                current.can_go_forward = false;
            }
        } else if !cleared {
            // Another profile's window cannot carry this clear operation's notice.
            return Err(ErrorCode::StorageError);
        }
        Ok(())
    }

    fn snapshot(&self) -> WebPreviewState {
        let Some(current) = &self.current else {
            return empty_state();
        };
        WebPreviewState {
            request_id: RequiredNullable(Some(current.request_id.clone())),
            profile_id: RequiredNullable(Some(current.profile_id.clone())),
            chrome_id: RequiredNullable(Some(current.chrome_id.clone())),
            url: RequiredNullable(Some(current.selected_url.clone())),
            current_url: RequiredNullable(current.current_url.clone()),
            phase: if current.open {
                current.phase
            } else {
                WebPreviewPhase::Closed
            },
            can_go_back: current.open && current.can_go_back,
            can_go_forward: current.open && current.can_go_forward,
            notice: RequiredNullable(current.notice),
            notice_message: RequiredNullable(
                current.notice.map(|notice| notice.message().to_owned()),
            ),
        }
    }
}

fn empty_state() -> WebPreviewState {
    WebPreviewState {
        request_id: RequiredNullable(None),
        profile_id: RequiredNullable(None),
        chrome_id: RequiredNullable(None),
        url: RequiredNullable(None),
        current_url: RequiredNullable(None),
        phase: WebPreviewPhase::Closed,
        can_go_back: false,
        can_go_forward: false,
        notice: RequiredNullable(None),
        notice_message: RequiredNullable(None),
    }
}

fn emit(app: &AppHandle, state: &WebPreviewState) {
    let _ = app.emit_to("main", "web-preview", state);
}

pub fn navigation_decision(url: &tauri::Url) -> Result<(), WebPreviewNotice> {
    if !url.username().is_empty() || url.password().is_some() {
        return Err(WebPreviewNotice::UserinfoDenied);
    }
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => Ok(()),
        "about" if url.path() == "blank" => Ok(()),
        _ => Err(WebPreviewNotice::SchemeDenied),
    }
}

pub fn user_navigation_target(raw: &str) -> Result<tauri::Url, ErrorCode> {
    if raw.len() > 16_384 {
        return Err(ErrorCode::InvalidMessage);
    }
    let url = tauri::Url::parse(raw).map_err(|_| ErrorCode::InvalidMessage)?;
    if navigation_decision(&url).is_err() || !matches!(url.scheme(), "http" | "https") {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(url)
}

fn bounded_url(raw: &str) -> Option<String> {
    http_url_text(raw)
}

fn http_url_text(raw: &str) -> Option<String> {
    if raw.chars().count() > 16_384 {
        return None;
    }
    let url = tauri::Url::parse(raw).ok()?;
    if matches!(url.scheme(), "http" | "https") && navigation_decision(&url).is_ok() {
        Some(url.to_string())
    } else {
        None
    }
}

fn session_directory(root: &Path, profile_id: &str) -> Result<PathBuf, ErrorCode> {
    let id = Id::new(profile_id).map_err(|_| ErrorCode::InvalidMessage)?;
    let mut digest = Sha256::new();
    digest.update(b"markbridge:preview-session:v1\0");
    digest.update(id.as_str().as_bytes());
    let path = root.join(format!("v1-{:x}", digest.finalize()));
    validate_windows_session_path(&path)?;
    Ok(path)
}

fn legacy_session_directory(root: &Path, profile_id: &str) -> Result<Option<PathBuf>, ErrorCode> {
    let id = Id::new(profile_id).map_err(|_| ErrorCode::InvalidMessage)?;
    let name = hex_encode(id.as_str());
    // The previous 256-character maximum exceeds the supported legacy component limit.
    Ok((name.len() <= 255).then(|| root.join(name)))
}

fn validate_windows_session_path(path: &Path) -> Result<(), ErrorCode> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        // Bound the measured persistent-store family, including the longest LevelDB leaf.
        // This does not promise that every future Chromium subpath fits MAX_PATH.
        let leaf = path.join("EBWebView/Default/Local Storage/leveldb/MANIFEST-000001");
        if leaf.as_os_str().encode_wide().count() + 1 > 260 {
            return Err(ErrorCode::StorageError);
        }
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

// The caller holds the preview operation lock and has closed the old window.
fn prepare_session_directory(root: &Path, profile_id: &str) -> Result<PathBuf, ErrorCode> {
    let target = session_directory(root, profile_id)?;
    let legacy = legacy_session_directory(root, profile_id)?;
    let target_present = owned_directory_present(root, &target)?;
    let legacy_present = legacy
        .as_ref()
        .map(|path| owned_directory_present(root, path))
        .transpose()?
        .unwrap_or(false);
    match (target_present, legacy.filter(|_| legacy_present)) {
        (true, Some(_)) => return Err(ErrorCode::StorageError),
        (false, Some(legacy)) => {
            reject_tree_links(&legacy)?;
            rename_session_without_replace(&legacy, &target)?;
        }
        (false, None) => {
            std::fs::create_dir(&target).map_err(|_| ErrorCode::StorageError)?;
        }
        (true, None) => {}
    }
    Ok(target)
}

fn redirected(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn reject_redirected_ancestors(path: &Path) -> Result<(), ErrorCode> {
    if !path.is_absolute() {
        return Err(ErrorCode::StorageError);
    }
    for ancestor in path.ancestors().filter(|path| path.is_absolute()) {
        match std::fs::symlink_metadata(ancestor) {
            Ok(metadata) if !redirected(&metadata) && metadata.is_dir() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(ErrorCode::StorageError),
        }
    }
    Ok(())
}

fn owned_directory_present(root: &Path, path: &Path) -> Result<bool, ErrorCode> {
    if path == root || path.parent() != Some(root) {
        return Err(ErrorCode::StorageError);
    }
    reject_redirected_ancestors(root)?;
    let root = root.canonicalize().map_err(|_| ErrorCode::StorageError)?;
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Ok(metadata) if !redirected(&metadata) && metadata.is_dir() => {
            let canonical = path.canonicalize().map_err(|_| ErrorCode::StorageError)?;
            if canonical.parent() != Some(root.as_path()) {
                return Err(ErrorCode::StorageError);
            }
            Ok(true)
        }
        _ => Err(ErrorCode::StorageError),
    }
}

fn reject_tree_links(path: &Path) -> Result<(), ErrorCode> {
    for entry in std::fs::read_dir(path).map_err(|_| ErrorCode::StorageError)? {
        let entry = entry.map_err(|_| ErrorCode::StorageError)?;
        let metadata =
            std::fs::symlink_metadata(entry.path()).map_err(|_| ErrorCode::StorageError)?;
        if redirected(&metadata) {
            return Err(ErrorCode::StorageError);
        }
        if metadata.is_dir() {
            reject_tree_links(&entry.path())?;
        }
    }
    Ok(())
}

fn rename_session_without_replace(source: &Path, target: &Path) -> Result<(), ErrorCode> {
    let source = source.canonicalize().map_err(|_| ErrorCode::StorageError)?;
    let parent = target
        .parent()
        .ok_or(ErrorCode::StorageError)?
        .canonicalize()
        .map_err(|_| ErrorCode::StorageError)?;
    if source.parent() != Some(parent.as_path()) {
        return Err(ErrorCode::StorageError);
    }
    let target = parent.join(target.file_name().ok_or(ErrorCode::StorageError)?);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        // Canonical source/parent yield extended absolute paths, including long legacy names.
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            windows_sys::Win32::Storage::FileSystem::MoveFileW(source.as_ptr(), target.as_ptr())
        } == 0
        {
            return Err(ErrorCode::StorageError);
        }
        Ok(())
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::os::unix::ffi::OsStrExt;
        let source = std::ffi::CString::new(source.as_os_str().as_bytes())
            .map_err(|_| ErrorCode::StorageError)?;
        let target = std::ffi::CString::new(target.as_os_str().as_bytes())
            .map_err(|_| ErrorCode::StorageError)?;
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                source.as_ptr(),
                libc::AT_FDCWD,
                target.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        #[cfg(target_os = "macos")]
        let result =
            unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };
        if result == 0 {
            Ok(())
        } else {
            Err(ErrorCode::StorageError)
        }
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = (source, target);
        Err(ErrorCode::StorageError)
    }
}

fn hex_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(value.len() * 2);
    for byte in value.bytes() {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
async fn await_native_clear(receiver: tokio::sync::oneshot::Receiver<bool>) -> bool {
    tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
pub fn ensure_native_store_supported() -> Result<(), ErrorCode> {
    use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};
    if NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: 14,
        minorVersion: 0,
        patchVersion: 0,
    }) {
        Ok(())
    } else {
        Err(ErrorCode::StorageError)
    }
}

#[cfg(any(target_os = "macos", test))]
pub fn native_store_identifier(
    root: &Path,
    role: &str,
    profile: Option<&str>,
) -> Result<[u8; 16], ErrorCode> {
    if !root.is_absolute() || !matches!((role, profile), ("main", None) | ("preview", Some(_))) {
        return Err(ErrorCode::StorageError);
    }
    if let Some(profile) = profile {
        Id::new(profile).map_err(|_| ErrorCode::InvalidMessage)?;
    }
    let root = root.canonicalize().map_err(|_| ErrorCode::StorageError)?;
    let mut digest = Sha256::new();
    digest.update(b"markbridge:webview-store:v1\0");
    for component in [
        root.as_os_str().as_encoded_bytes(),
        role.as_bytes(),
        profile.unwrap_or("").as_bytes(),
    ] {
        digest.update((component.len() as u64).to_be_bytes());
        digest.update(component);
    }
    let hash = digest.finalize();
    let mut identifier = [0; 16];
    identifier.copy_from_slice(&hash[..16]);
    Ok(identifier)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn native_ui<T: Send + 'static>(
    window: &WebviewWindow,
    f: impl FnOnce(tauri::webview::PlatformWebview) -> T + Send + 'static,
) -> Result<T, ErrorCode> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |platform| {
            let _ = sender.send(f(platform));
        })
        .map_err(|_| ErrorCode::InvalidMessage)?;
    tokio::time::timeout(Duration::from_secs(2), receiver)
        .await
        .map_err(|_| ErrorCode::InvalidMessage)?
        .map_err(|_| ErrorCode::InvalidMessage)
}

#[cfg(target_os = "linux")]
fn linux_history(view: &webkit2gtk::WebView, app: &AppHandle, generation: u64) {
    use webkit2gtk::WebViewExt;
    if let Some(host) = app.try_state::<PreviewHost>()
        && let Some(token) = host.native_token(generation)
    {
        host.native_history(
            app,
            &token,
            view.can_go_back(),
            view.can_go_forward(),
            view.uri().map(|url| url.to_string()),
        );
    }
}

#[cfg(target_os = "linux")]
async fn attach_linux_watch(
    window: &WebviewWindow,
    app: AppHandle,
    dir: PathBuf,
    generation: u64,
) -> Result<(), ErrorCode> {
    use gtk::prelude::ObjectExt;
    use webkit2gtk::WebViewExt;
    native_ui(window, move |platform| {
        let view = platform.inner();
        let context = linux_context(&view, &dir)?;
        app.state::<PreviewHost>()
            .contexts
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(dir, context.downgrade().into());
        let token = std::rc::Rc::new(std::cell::RefCell::new(None::<NativeNavigation>));
        let load_app = app.clone();
        let load_token = token.clone();
        view.connect_load_changed(move |view, event| {
            if let Some(host) = load_app.try_state::<PreviewHost>() {
                match event {
                    webkit2gtk::LoadEvent::Started => {
                        *load_token.borrow_mut() = host.begin_native_load(
                            &load_app,
                            generation,
                            view.uri().map(|url| url.to_string()),
                        );
                    }
                    webkit2gtk::LoadEvent::Finished => {
                        if let Some(token) = load_token.borrow().as_ref() {
                            host.finish_native_load(
                                &load_app,
                                token,
                                true,
                                view.uri().map(|url| url.to_string()),
                            );
                        }
                    }
                    _ => {}
                }
            }
            linux_history(view, &load_app, generation);
        });
        let fail_app = app.clone();
        let fail_token = token;
        view.connect_load_failed(move |_, _, uri, error| {
            // A superseded load's cancellation is not a failure of the new request.
            if !error.matches(webkit2gtk::NetworkError::Cancelled)
                && let Some(host) = fail_app.try_state::<PreviewHost>()
                && let Some(token) = fail_token.borrow().as_ref()
            {
                host.finish_native_load(&fail_app, token, false, Some(uri.to_owned()));
            }
            true
        });
        let uri_app = app.clone();
        view.connect_uri_notify(move |view| linux_history(view, &uri_app, generation));
        if let Some(list) = view.back_forward_list() {
            let weak_view = view.downgrade();
            let history_app = app.clone();
            list.connect_local("changed", false, move |_| {
                if let Some(view) = weak_view.upgrade() {
                    linux_history(&view, &history_app, generation);
                }
                None
            });
        }
        Ok::<_, ErrorCode>(())
    })
    .await?
}

#[cfg(target_os = "macos")]
fn attach_mac_page_events<'a>(
    builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
    app: AppHandle,
    generation: u64,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let token = std::sync::Arc::new(std::sync::Mutex::new(None::<NativeNavigation>));
    builder.on_page_load(move |webview, payload| {
        if !matches!(payload.url().scheme(), "http" | "https") {
            return;
        }
        match payload.event() {
            tauri::webview::PageLoadEvent::Started => {
                *token.lock().unwrap_or_else(|error| error.into_inner()) = app
                    .try_state::<PreviewHost>()
                    .and_then(|host| host.native_token(generation));
            }
            tauri::webview::PageLoadEvent::Finished => {
                let Some(token) = token
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .clone()
                else {
                    return;
                };
                let app = app.clone();
                let url = payload.url().to_string();
                let _ = webview.with_webview(move |platform| {
                    let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
                    if !unsafe { view.isLoading() }
                        && let Some(host) = app.try_state::<PreviewHost>()
                    {
                        host.finish_native_load(&app, &token, true, Some(url));
                    }
                });
            }
        }
    })
}

#[cfg(target_os = "macos")]
fn start_mac_history_watch(window: &WebviewWindow, app: AppHandle, generation: u64) {
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(host) = app.try_state::<PreviewHost>() {
            if !host
                .lock()
                .current
                .as_ref()
                .is_some_and(|current| current.open && current.generation == generation)
            {
                break;
            }
            let token = host.native_token(generation);
            if let Some(token) = token {
                let expired = host
                    .lock()
                    .current
                    .as_ref()
                    .is_some_and(|current| current.native_load_timed_out(Instant::now()));
                if expired {
                    host.finish_native_load(&app, &token, false, None);
                }
                if let Ok((back, forward, url)) = native_ui(&window, |platform| {
                    let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
                    unsafe {
                        (
                            view.canGoBack(),
                            view.canGoForward(),
                            view.URL()
                                .and_then(|url| url.absoluteString())
                                .map(|url| url.to_string()),
                        )
                    }
                })
                .await
                {
                    host.native_history(&app, &token, back, forward, url);
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    });
}

#[cfg(target_os = "linux")]
fn linux_context(
    view: &webkit2gtk::WebView,
    dir: &Path,
) -> Result<webkit2gtk::WebContext, ErrorCode> {
    use webkit2gtk::{WebContextExt, WebViewExt, WebsiteDataManagerExt};
    let context = view.context().ok_or(ErrorCode::StorageError)?;
    let manager = context
        .website_data_manager()
        .ok_or(ErrorCode::StorageError)?;
    if manager
        .base_data_directory()
        .as_ref()
        .is_none_or(|path| Path::new(path.as_str()) != dir)
        || manager
            .base_cache_directory()
            .as_ref()
            .is_none_or(|path| Path::new(path.as_str()) != dir)
    {
        return Err(ErrorCode::StorageError);
    }
    Ok(context)
}

#[cfg(target_os = "linux")]
async fn clear_linux_directory(app: &AppHandle, root: &Path, dir: &Path) -> Result<(), ErrorCode> {
    use gtk::prelude::ObjectExt;
    use webkit2gtk::{WebContextExt, WebsiteDataManagerExt, WebsiteDataManagerExtManual};
    let known = app
        .state::<PreviewHost>()
        .contexts
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains_key(dir);
    let check_root = root.to_path_buf();
    let check_dir = dir.to_path_buf();
    let present = tauri::async_runtime::spawn_blocking(move || {
        owned_directory_present(&check_root, &check_dir)
    })
    .await
    .map_err(|_| ErrorCode::StorageError)??;
    if !present && !known {
        return Ok(());
    }
    let label = format!(
        "preview-clear-{:x}",
        Sha256::digest(dir.as_os_str().as_encoded_bytes())
    );
    let hidden = if known {
        None
    } else {
        let window = WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::External(
                tauri::Url::parse("about:blank").map_err(|_| ErrorCode::InvalidMessage)?,
            ),
        )
        .visible(false)
        .data_directory(dir.to_path_buf())
        .on_navigation(|url| url.as_str() == "about:blank")
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .build()
        .map_err(|_| ErrorCode::StorageError)?;
        let app_copy = app.clone();
        let directory = dir.to_path_buf();
        let registered = native_ui(&window, move |platform| {
            let context = linux_context(&platform.inner(), &directory)?;
            app_copy
                .state::<PreviewHost>()
                .contexts
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .insert(directory, context.downgrade().into());
            Ok::<_, ErrorCode>(())
        })
        .await;
        if !matches!(registered, Ok(Ok(()))) {
            let _ = window.destroy();
            return Err(ErrorCode::StorageError);
        }
        Some(window)
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let app_copy = app.clone();
    let directory = dir.to_path_buf();
    let dispatched = app.run_on_main_thread(move || {
        let context = app_copy
            .state::<PreviewHost>()
            .contexts
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&directory)
            .and_then(|weak| weak.upgrade());
        let Some(context) = context else {
            let _ = sender.send(Err(ErrorCode::StorageError));
            return;
        };
        let Some(manager) = context.website_data_manager() else {
            let _ = sender.send(Err(ErrorCode::StorageError));
            return;
        };
        if manager
            .base_data_directory()
            .as_ref()
            .is_none_or(|path| Path::new(path.as_str()) != directory)
            || manager
                .base_cache_directory()
                .as_ref()
                .is_none_or(|path| Path::new(path.as_str()) != directory)
        {
            let _ = sender.send(Err(ErrorCode::StorageError));
            return;
        }
        manager.clear(
            webkit2gtk::WebsiteDataTypes::all(),
            glib::TimeSpan::from_microseconds(0),
            None::<&webkit2gtk::gio::Cancellable>,
            move |result| {
                let _ = sender.send(result.map_err(|_| ErrorCode::StorageError));
            },
        );
    });
    let result = if dispatched.is_ok() {
        receiver.await.unwrap_or(Err(ErrorCode::StorageError))
    } else {
        Err(ErrorCode::StorageError)
    };
    if let Some(window) = hidden {
        window.destroy().map_err(|_| ErrorCode::StorageError)?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while app.get_webview_window(&label).is_some() {
            if tokio::time::Instant::now() >= deadline {
                return Err(ErrorCode::StorageError);
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    }
    result
}

#[cfg(not(target_os = "linux"))]
async fn remove_session_dir(root: &Path, dir: &Path) -> bool {
    for _ in 0..30 {
        let root = root.to_path_buf();
        let dir = dir.to_path_buf();
        let result =
            tauri::async_runtime::spawn_blocking(move || remove_session_dir_once(&root, &dir))
                .await
                .unwrap_or(Remove::Refuse);
        match result {
            Remove::Gone => return true,
            Remove::Busy => tokio::time::sleep(Duration::from_millis(100)).await,
            Remove::Refuse => return false,
        }
    }
    false
}

#[cfg(any(not(target_os = "linux"), test))]
#[derive(Debug, PartialEq, Eq)]
enum Remove {
    Gone,
    Busy,
    Refuse,
}

#[cfg(any(not(target_os = "linux"), test))]
fn remove_session_dir_once(root: &Path, dir: &Path) -> Remove {
    let present = match owned_directory_present(root, dir) {
        Ok(present) => present,
        Err(_) => return Remove::Refuse,
    };
    if !present {
        return Remove::Gone;
    }
    if reject_tree_links(dir).is_err() {
        return Remove::Refuse;
    }
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Remove::Gone,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Remove::Gone,
        Err(_) => Remove::Busy,
    }
}

#[derive(Clone, Copy)]
enum HistoryMove {
    Back,
    Forward,
}

async fn history_move(window: &WebviewWindow, action: HistoryMove) -> Result<(), ErrorCode> {
    #[cfg(windows)]
    {
        on_ui(window, move |platform| {
            let controller = platform.controller();
            let webview =
                unsafe { controller.CoreWebView2() }.map_err(|_| ErrorCode::InvalidMessage)?;
            let result = unsafe {
                match action {
                    HistoryMove::Back => webview.GoBack(),
                    HistoryMove::Forward => webview.GoForward(),
                }
            };
            result.map_err(|_| ErrorCode::InvalidMessage)
        })?
    }
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::WebViewExt;
        native_ui(window, move |platform| {
            let view = platform.inner();
            match action {
                HistoryMove::Back => view.go_back(),
                HistoryMove::Forward => view.go_forward(),
            };
            Ok(())
        })
        .await?
    }
    #[cfg(target_os = "macos")]
    {
        native_ui(window, move |platform| {
            let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
            unsafe {
                match action {
                    HistoryMove::Back => view.goBack(),
                    HistoryMove::Forward => view.goForward(),
                };
            }
            Ok(())
        })
        .await?
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let script = match action {
            HistoryMove::Back => "history.back()",
            HistoryMove::Forward => "history.forward()",
        };
        window.eval(script).map_err(|_| ErrorCode::InvalidMessage)
    }
}

#[cfg(windows)]
fn on_ui<T: Send + 'static>(
    window: &WebviewWindow,
    f: impl FnOnce(tauri::webview::PlatformWebview) -> T + Send + 'static,
) -> Result<T, ErrorCode> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let _ = tx.send(f(webview));
        })
        .map_err(|_| ErrorCode::InvalidMessage)?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| ErrorCode::InvalidMessage)
}

#[cfg(windows)]
fn attach_load_watch(window: &WebviewWindow, app: AppHandle, generation: u64) {
    #[cfg(windows)]
    {
        let app = app.clone();
        let _ = window.with_webview(move |platform| {
            let Ok(webview) = (unsafe { platform.controller().CoreWebView2() }) else {
                return;
            };
            let mut token = 0_i64;
            let completed = webview2_com::NavigationCompletedEventHandler::create(Box::new({
                let app = app.clone();
                move |webview, args| {
                    let Some(webview) = webview else {
                        return Ok(());
                    };
                    let success = args
                        .as_ref()
                        .and_then(|args| {
                            let mut ok = windows_core::BOOL(0);
                            unsafe { args.IsSuccess(&mut ok) }.ok()?;
                            Some(ok.as_bool())
                        })
                        .unwrap_or(false);
                    let url = webview_source(&webview);
                    if let Some(host) = app.try_state::<PreviewHost>() {
                        host.finish_navigation(&app, generation, success, url);
                    }
                    Ok(())
                }
            }));
            let _ = unsafe { webview.add_NavigationCompleted(&completed, &mut token) };
            let history = webview2_com::HistoryChangedEventHandler::create(Box::new({
                let app = app.clone();
                move |webview, _args| {
                    let Some(webview) = webview else {
                        return Ok(());
                    };
                    let mut back = windows_core::BOOL(0);
                    let mut forward = windows_core::BOOL(0);
                    let _ = unsafe { webview.CanGoBack(&mut back) };
                    let _ = unsafe { webview.CanGoForward(&mut forward) };
                    let url = webview_source(&webview);
                    if let Some(host) = app.try_state::<PreviewHost>() {
                        host.note_history(&app, generation, back.as_bool(), forward.as_bool(), url);
                    }
                    Ok(())
                }
            }));
            let _ = unsafe { webview.add_HistoryChanged(&history, &mut token) };
            let starting = webview2_com::NavigationStartingEventHandler::create(Box::new({
                let app = app.clone();
                move |_webview, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let mut raw = windows_core::PWSTR::null();
                    if unsafe { args.Uri(&mut raw) }.is_err() {
                        let _ = unsafe { args.SetCancel(true) };
                        return Ok(());
                    }
                    let uri = webview2_com::take_pwstr(raw);
                    let parsed = tauri::Url::parse(&uri);
                    let allow = parsed
                        .as_ref()
                        .is_ok_and(|url| navigation_decision(url).is_ok());
                    if !allow {
                        if let Some(host) = app.try_state::<PreviewHost>() {
                            match &parsed {
                                Ok(url) => {
                                    let _ = host.allow_navigation(&app, generation, url);
                                }
                                Err(_) => host.note_scheme(&app, generation),
                            }
                        }
                        let _ = unsafe { args.SetCancel(true) };
                    }
                    Ok(())
                }
            }));
            let _ = unsafe { webview.add_NavigationStarting(&starting, &mut token) };
            install_scheme_guard(&webview, app, generation);
        });
    }
}

#[cfg(windows)]
fn install_scheme_guard(
    webview: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    app: AppHandle,
    generation: u64,
) {
    let script: windows_core::HSTRING = SCHEME_GUARD.into();
    let added = webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
        Box::new(|_status, _id| Ok(())),
    );
    let _ = unsafe { webview.AddScriptToExecuteOnDocumentCreated(&script, &added) };
    let ran =
        webview2_com::ExecuteScriptCompletedHandler::create(Box::new(|_status, _result| Ok(())));
    let _ = unsafe { webview.ExecuteScript(&script, &ran) };
    let events = webview2_com::DevToolsProtocolEventReceivedEventHandler::create(Box::new(
        move |_webview, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut raw = windows_core::PWSTR::null();
            unsafe { args.ParameterObjectAsJson(&mut raw) }?;
            let json = webview2_com::take_pwstr(raw);
            if blocked_scheme_json(&json)
                && let Some(host) = app.try_state::<PreviewHost>()
            {
                host.note_scheme(&app, generation);
            }
            Ok(())
        },
    ));
    for name in ["Page.frameStartedNavigating", "Log.entryAdded"] {
        let wide: windows_core::HSTRING = name.into();
        let Ok(receiver) = (unsafe { webview.GetDevToolsProtocolEventReceiver(&wide) }) else {
            continue;
        };
        let mut token = 0_i64;
        if unsafe { receiver.add_DevToolsProtocolEventReceived(&events, &mut token) }.is_ok() {
            std::mem::forget(receiver);
        }
    }
    let enabled = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
        |_status, _result| Ok(()),
    ));
    for method in ["Page.enable", "Log.enable"] {
        let wide: windows_core::HSTRING = method.into();
        let params: windows_core::HSTRING = "{}".into();
        let _ = unsafe { webview.CallDevToolsProtocolMethod(&wide, &params, &enabled) };
    }
}

const SCHEME_GUARD: &str = r#"(function(){if(window.__mbSchemeGuard)return;window.__mbSchemeGuard=1;var busy=false;function bad(value){var text=String(value==null?'':value).replace(/^\s+/,'');var match=/^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text);if(!match)return false;var scheme=match[1].toLowerCase();return scheme!=='http'&&scheme!=='https';}function report(){if(busy)return;busy=true;try{location.assign('markbridge-blocked:scheme');}finally{busy=false;}}try{var desc=Object.getOwnPropertyDescriptor(Location.prototype,'href');if(desc&&desc.set&&desc.configurable){var set=desc.set;Object.defineProperty(Location.prototype,'href',{configurable:true,enumerable:desc.enumerable,get:desc.get,set:function(value){if(!busy&&bad(value)){report();return;}set.call(this,value);}});}}catch(e){}document.addEventListener('click',function(event){var node=event.target&&event.target.closest?event.target.closest('a[href]'):null;if(!node||!bad(node.getAttribute('href')))return;event.preventDefault();event.stopPropagation();report();},true);})();"#;

#[cfg(any(windows, test))]
fn blocked_scheme_json(json: &str) -> bool {
    let compact: String = json
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace())
        .collect();
    let lower = compact.to_ascii_lowercase();
    lower.contains("\"url\":\"javascript:")
        || lower.contains("\"url\":\"file:")
        || lower.contains("notallowedtoloadlocalresource")
}

#[cfg(windows)]
fn webview_source(
    webview: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
) -> Option<String> {
    let mut raw = windows_core::PWSTR::null();
    if unsafe { webview.Source(&mut raw) }.is_err() {
        return None;
    }
    let value = webview2_com::take_pwstr(raw);
    if value.is_empty() { None } else { Some(value) }
}

#[tauri::command]
pub async fn open_web_preview(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, PreviewHost>,
    profile_id: Id,
    chrome_id: Id,
    request_id: Id,
    url: String,
) -> Result<WebPreviewState, ErrorCode> {
    if !caller_may_control(window.label()) {
        return Err(ErrorCode::ReadOnly);
    }
    host.open_page(&app, profile_id, chrome_id, request_id, &url)
        .await
}

#[tauri::command]
pub async fn web_preview_action(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, PreviewHost>,
    action: String,
) -> Result<WebPreviewState, ErrorCode> {
    if !caller_may_control(window.label()) {
        return Err(ErrorCode::ReadOnly);
    }
    host.act(&app, &action).await
}

#[tauri::command]
pub async fn clear_web_preview_session(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, PreviewHost>,
    profile_id: Id,
    request_id: Id,
) -> Result<WebPreviewState, ErrorCode> {
    if !caller_may_control(window.label()) {
        return Err(ErrorCode::ReadOnly);
    }
    host.clear_session(&app, profile_id, request_id).await
}

#[tauri::command]
pub fn web_preview_state(
    window: WebviewWindow,
    host: tauri::State<'_, PreviewHost>,
) -> Result<WebPreviewState, ErrorCode> {
    if !caller_may_control(window.label()) {
        return Err(ErrorCode::ReadOnly);
    }
    Ok(host.snapshot())
}

#[cfg(test)]
mod tests {
    use super::{
        PREVIEW_LABEL, Remove, navigation_decision, remove_session_dir_once, session_directory,
        user_navigation_target,
    };

    use markbridge_protocol::{ErrorCode, WebPreviewNotice};

    fn native_fixture() -> tempfile::TempDir {
        // System temporary paths can contain platform aliases such as macOS /var.
        let parent = std::env::temp_dir().canonicalize().unwrap();
        tempfile::tempdir_in(parent).unwrap()
    }

    fn url(raw: &str) -> tauri::Url {
        tauri::Url::parse(raw).unwrap()
    }

    fn native_current() -> super::Current {
        super::Current {
            generation: 7,
            profile_id: markbridge_protocol::Id::new("profile-a").unwrap(),
            chrome_id: markbridge_protocol::Id::new("node-a").unwrap(),
            request_id: markbridge_protocol::Id::new("request-a").unwrap(),
            selected_url: "https://example.com/a".into(),
            current_url: None,
            phase: markbridge_protocol::WebPreviewPhase::Loading,
            can_go_back: false,
            can_go_forward: false,
            notice: None,
            open: true,
            recent_deny: None,
            native_sequence: 0,
            native_load: None,
        }
    }

    #[test]
    fn native_finished_cannot_erase_failure_or_a_newer_request() {
        use markbridge_protocol::{Id, WebPreviewPhase};
        let mut current = native_current();
        let first = current.begin_native("https://example.com/a".into());
        assert!(
            current.native_load.as_ref().unwrap().started.elapsed()
                < std::time::Duration::from_secs(30)
        );
        assert!(current.finish_native(&first, false, Some("https://example.com/a".into())));
        assert!(!current.finish_native(&first, true, Some("https://example.com/a".into())));
        assert_eq!(current.phase, WebPreviewPhase::Failed);
        assert_eq!(current.notice, Some(WebPreviewNotice::LoadFailed));
        current.request_id = Id::new("request-b").unwrap();
        assert!(!current.finish_native(&first, true, None));
        let second = current.begin_native("https://example.com/b".into());
        assert!(!current.finish_native(&first, false, None));
        assert!(!current.finish_native(&second, true, Some("https://example.com/a".into())));
        assert!(current.finish_native(&second, true, Some("https://example.com/b".into())));
        assert_eq!(current.phase, WebPreviewPhase::Ready);
        current.profile_id = Id::new("profile-other").unwrap();
        assert!(!current.finish_native(&second, false, None));
        current.profile_id = second.profile_id.clone();
        current.generation += 1;
        assert!(!current.finish_native(&second, false, None));
    }

    #[test]
    fn native_timeout_only_fails_the_current_unresolved_loading_attempt() {
        let mut current = native_current();
        let token = current.begin_native("https://example.com/a".into());
        let started = current.native_load.as_ref().unwrap().started;
        assert!(!current.native_load_timed_out(started + std::time::Duration::from_secs(29)));
        assert!(current.native_load_timed_out(started + std::time::Duration::from_secs(30)));
        assert!(current.finish_native(&token, true, Some("https://example.com/a".into())));
        assert!(!current.native_load_timed_out(started + std::time::Duration::from_secs(60)));
        current.begin_native("https://example.com/b".into());
        let deadline =
            current.native_load.as_ref().unwrap().started + std::time::Duration::from_secs(30);
        assert!(current.native_load_timed_out(deadline));
        current.request_id = markbridge_protocol::Id::new("request-new").unwrap();
        assert!(!current.native_load_timed_out(deadline));
        current.open = false;
        assert!(!current.native_load_timed_out(deadline));
    }

    #[test]
    fn native_finished_keeps_current_denials_and_new_load_resets_only_old_attempt_state() {
        let mut current = native_current();
        let token = current.begin_native("https://example.com/a".into());
        current.recent_deny = Some(std::time::Instant::now());
        current.notice = Some(WebPreviewNotice::SchemeDenied);
        assert!(!current.finish_native(&token, true, None));
        assert_eq!(current.notice, Some(WebPreviewNotice::SchemeDenied));
        let next = current.begin_native("https://example.com/b".into());
        assert!(current.recent_deny.is_none());
        current.notice = Some(WebPreviewNotice::PopupBlocked);
        assert!(current.finish_native(&next, true, Some("https://example.com/b".into())));
        assert_eq!(current.notice, Some(WebPreviewNotice::PopupBlocked));
        let failed = current.begin_native("https://example.com/c".into());
        assert!(current.finish_native(&failed, false, Some("https://example.com/c".into())));
        assert_eq!(current.notice, Some(WebPreviewNotice::LoadFailed));
    }

    #[tokio::test(start_paused = true)]
    async fn timed_out_clear_blocks_only_its_profile_until_native_completion() {
        let fixture = native_fixture();
        let host = super::PreviewHost::new(fixture.path().to_path_buf()).unwrap();
        assert!(host.begin_clear("profile-a"));
        assert!(!host.begin_clear("profile-a"));
        let (sender, receiver) = tokio::sync::oneshot::channel();
        assert!(!super::await_native_clear(receiver).await);
        assert!(host.clear_pending("profile-a"));
        assert!(!host.clear_pending("profile-b"));
        host.end_clear("profile-a");
        assert!(sender.send(true).is_err());
        assert!(!host.clear_pending("profile-a"));
        assert!(host.begin_clear("profile-a"));
    }

    #[test]
    fn persistent_native_store_identity_separates_roles_profiles_and_roots() {
        let root = native_fixture();
        let other = native_fixture();
        let main = super::native_store_identifier(root.path(), "main", None).unwrap();
        let a = super::native_store_identifier(root.path(), "preview", Some("profile-a")).unwrap();
        let b = super::native_store_identifier(root.path(), "preview", Some("profile-b")).unwrap();
        assert_eq!(
            a,
            super::native_store_identifier(root.path(), "preview", Some("profile-a")).unwrap()
        );
        assert_ne!(main, a);
        assert_ne!(a, b);
        assert_ne!(
            a,
            super::native_store_identifier(other.path(), "preview", Some("profile-a")).unwrap()
        );
        assert!(super::native_store_identifier(root.path(), "main", Some("profile-a")).is_err());
        assert!(super::native_store_identifier(root.path(), "preview", None).is_err());
        assert!(super::native_store_identifier(root.path(), "preview", Some("../other")).is_err());
    }

    #[test]
    fn preview_label_is_not_the_trusted_window() {
        assert!(super::caller_may_control("main"));
        assert!(!super::caller_may_control(PREVIEW_LABEL));
        assert!(PREVIEW_LABEL.starts_with("preview-"));
    }

    #[test]
    fn navigation_allows_http_and_initial_blank_only() {
        assert!(navigation_decision(&url("https://example.com/a")).is_ok());
        assert!(navigation_decision(&url("http://127.0.0.1:9/a")).is_ok());
        assert!(navigation_decision(&url("about:blank")).is_ok());
        assert_eq!(
            navigation_decision(&url("javascript:alert(1)")),
            Err(WebPreviewNotice::SchemeDenied)
        );
        assert_eq!(
            navigation_decision(&url("file:///C:/Windows/win.ini")),
            Err(WebPreviewNotice::SchemeDenied)
        );
        assert_eq!(
            navigation_decision(&url("markbridge-blocked:scheme")),
            Err(WebPreviewNotice::SchemeDenied)
        );
        assert!(super::blocked_scheme_json(
            r#"{"url":"javascript:void(0)"}"#
        ));
        assert!(super::blocked_scheme_json(
            r#"{"url": "file:///C:/Windows/win.ini"}"#
        ));
        assert!(!super::blocked_scheme_json(
            r#"{"url":"http://127.0.0.1/a"}"#
        ));
        assert_eq!(
            navigation_decision(&url("data:text/html,hi")),
            Err(WebPreviewNotice::SchemeDenied)
        );
        assert_eq!(
            navigation_decision(&url("https://user:secret@example.com/a")),
            Err(WebPreviewNotice::UserinfoDenied)
        );
        assert!(user_navigation_target("https://example.com/a").is_ok());
        assert_eq!(
            user_navigation_target("about:blank"),
            Err(ErrorCode::InvalidMessage)
        );
        assert_eq!(
            user_navigation_target("javascript:alert(1)"),
            Err(ErrorCode::InvalidMessage)
        );
        assert_eq!(
            user_navigation_target("file:///C:/Windows"),
            Err(ErrorCode::InvalidMessage)
        );
    }

    #[test]
    fn session_directory_cannot_escape_the_preview_root() {
        let fixture = native_fixture();
        let root = fixture.path().join("preview-sessions");
        std::fs::create_dir(&root).unwrap();
        let path = session_directory(&root, "p:abc").unwrap();
        assert_eq!(path.parent(), Some(root.as_path()));
        assert!(
            path.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .strip_prefix("v1-")
                .unwrap()
                .chars()
                .all(|c| c.is_ascii_hexdigit())
        );
        let colon = session_directory(&root, "C:windows").unwrap();
        assert_eq!(colon.parent(), Some(root.as_path()));
        assert_ne!(colon.file_name().unwrap(), "C:windows");
        assert!(session_directory(&root, "..").is_err());
        assert!(session_directory(&root, "a/b").is_err());
        assert!(session_directory(&root, "a\\b").is_err());
        assert_eq!(remove_session_dir_once(&root, &root), Remove::Refuse);
    }

    #[test]
    fn production_and_maximum_id_session_components_are_fixed_and_separate() {
        let fixture = native_fixture();
        let root = fixture.path().join("preview-sessions");
        std::fs::create_dir(&root).unwrap();
        let a = format!("p:{}", "a".repeat(64));
        let b = format!("p:{}", "b".repeat(64));
        let maximum = "m".repeat(128);
        let a_path = session_directory(&root, &a).unwrap();
        assert_eq!(
            a_path.file_name().unwrap().to_str().unwrap(),
            "v1-1e8b1719ad8820ff052aad43fffc0161b789f8e67db43ed3d05c94dd40b345f7"
        );
        for id in [&a, &b, &maximum] {
            let path = session_directory(&root, id).unwrap();
            let component = path.file_name().unwrap().to_str().unwrap();
            assert_eq!(component.len(), 67);
            assert!(component.starts_with("v1-"));
            assert!(component[3..].bytes().all(|byte| byte.is_ascii_hexdigit()));
            assert_eq!(path.parent(), Some(root.as_path()));
            assert_eq!(super::prepare_session_directory(&root, id).unwrap(), path);
        }
        assert_eq!(a_path, session_directory(&root, &a).unwrap());
        assert_ne!(a_path, session_directory(&root, &b).unwrap());
    }

    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    #[test]
    fn legacy_migration_preserves_files_and_never_replaces_an_existing_target() {
        let fixture = native_fixture();
        let root = fixture.path().join("preview-sessions");
        std::fs::create_dir(&root).unwrap();
        let profile = format!("p:{}", "a".repeat(64));
        let legacy = super::legacy_session_directory(&root, &profile)
            .unwrap()
            .unwrap();
        std::fs::create_dir_all(legacy.join("Default/Local Storage")).unwrap();
        std::fs::write(legacy.join("Default/Cookies"), b"synthetic-cookie-file").unwrap();
        std::fs::write(
            legacy.join("Default/Local Storage/canary"),
            b"synthetic-local-file",
        )
        .unwrap();
        let other = super::prepare_session_directory(&root, "profile-b").unwrap();
        std::fs::write(other.join("canary"), b"other-profile").unwrap();

        let target = super::prepare_session_directory(&root, &profile).unwrap();
        assert!(!legacy.exists());
        assert_eq!(
            std::fs::read(target.join("Default/Cookies")).unwrap(),
            b"synthetic-cookie-file"
        );
        assert_eq!(
            std::fs::read(target.join("Default/Local Storage/canary")).unwrap(),
            b"synthetic-local-file"
        );
        assert_eq!(
            std::fs::read(other.join("canary")).unwrap(),
            b"other-profile"
        );

        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("canary"), b"legacy-preserved").unwrap();
        assert_eq!(
            super::prepare_session_directory(&root, &profile),
            Err(ErrorCode::StorageError)
        );
        assert_eq!(
            std::fs::read(legacy.join("canary")).unwrap(),
            b"legacy-preserved"
        );
        assert_eq!(
            std::fs::read(target.join("Default/Cookies")).unwrap(),
            b"synthetic-cookie-file"
        );

        // The primitive itself also rejects an existing empty directory, including a race winner.
        let empty = root.join("empty-target");
        std::fs::create_dir(&empty).unwrap();
        assert_eq!(
            super::rename_session_without_replace(&legacy, &empty),
            Err(ErrorCode::StorageError)
        );
        assert_eq!(
            std::fs::read(legacy.join("canary")).unwrap(),
            b"legacy-preserved"
        );
        assert_eq!(std::fs::read_dir(&empty).unwrap().count(), 0);
    }

    fn directory_link(target: &std::path::Path, link: &std::path::Path) {
        #[cfg(windows)]
        {
            let result = std::process::Command::new("cmd.exe")
                .args(["/c", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "test junction could not be created"
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[test]
    fn migration_rejects_root_source_target_and_nested_links_without_touching_outside() {
        for kind in ["root", "source", "target", "nested"] {
            let fixture = native_fixture();
            let root = fixture.path().join("preview-sessions");
            let outside = fixture.path().join("outside");
            std::fs::create_dir(&outside).unwrap();
            std::fs::write(outside.join("canary"), b"outside-preserved").unwrap();
            let legacy = super::legacy_session_directory(&root, "profile-a")
                .unwrap()
                .unwrap();
            let target = session_directory(&root, "profile-a").unwrap();
            if kind == "root" {
                directory_link(&outside, &root);
                assert!(super::PreviewHost::new(root.join("app-data")).is_err());
                assert!(!outside.join("app-data").exists());
            } else {
                std::fs::create_dir(&root).unwrap();
                if kind == "source" {
                    directory_link(&outside, &legacy);
                } else if kind == "target" {
                    directory_link(&outside, &target);
                } else {
                    std::fs::create_dir(&legacy).unwrap();
                    directory_link(&outside, &legacy.join("nested"));
                }
            }
            assert_eq!(
                super::prepare_session_directory(&root, "profile-a"),
                Err(ErrorCode::StorageError)
            );
            assert_eq!(
                std::fs::read(outside.join("canary")).unwrap(),
                b"outside-preserved"
            );
            let selected = if kind == "target" { &target } else { &legacy };
            assert_eq!(remove_session_dir_once(&root, selected), Remove::Refuse);
        }
    }

    #[test]
    fn clear_refuses_same_root_sibling_aliases_for_hash_and_legacy_names() {
        for hashed in [true, false] {
            let fixture = native_fixture();
            let root = fixture.path().join("preview-sessions");
            std::fs::create_dir(&root).unwrap();
            let sibling = super::prepare_session_directory(&root, "profile-b").unwrap();
            std::fs::write(sibling.join("canary"), b"sibling-profile-preserved").unwrap();
            let selected = if hashed {
                session_directory(&root, "profile-a").unwrap()
            } else {
                super::legacy_session_directory(&root, "profile-a")
                    .unwrap()
                    .unwrap()
            };
            directory_link(&sibling, &selected);
            assert_eq!(remove_session_dir_once(&root, &selected), Remove::Refuse);
            assert_eq!(
                std::fs::read(sibling.join("canary")).unwrap(),
                b"sibling-profile-preserved"
            );
        }
    }

    #[test]
    fn clear_removes_only_the_selected_profiles_hash_and_legacy_directories() {
        let fixture = native_fixture();
        let root = fixture.path().join("preview-sessions");
        std::fs::create_dir(&root).unwrap();
        let a = super::prepare_session_directory(&root, "profile-a").unwrap();
        let legacy_a = super::legacy_session_directory(&root, "profile-a")
            .unwrap()
            .unwrap();
        std::fs::create_dir(&legacy_a).unwrap();
        let b = super::prepare_session_directory(&root, "profile-b").unwrap();
        let main = fixture.path().join("main-webview");
        std::fs::create_dir(&main).unwrap();
        std::fs::write(b.join("canary"), b"profile-b-preserved").unwrap();
        std::fs::write(main.join("canary"), b"main-preserved").unwrap();
        assert_eq!(remove_session_dir_once(&root, &a), Remove::Gone);
        assert_eq!(remove_session_dir_once(&root, &legacy_a), Remove::Gone);
        assert!(!a.exists() && !legacy_a.exists());
        assert_eq!(
            std::fs::read(b.join("canary")).unwrap(),
            b"profile-b-preserved"
        );
        assert_eq!(
            std::fs::read(main.join("canary")).unwrap(),
            b"main-preserved"
        );
        assert_eq!(remove_session_dir_once(&root, &main), Remove::Refuse);
        assert_eq!(remove_session_dir_once(&root, &root), Remove::Refuse);
    }

    #[cfg(windows)]
    #[test]
    fn persistent_store_budget_counts_utf16_and_rejects_before_creation() {
        use std::os::windows::ffi::OsStrExt;
        let suffix = "EBWebView/Default/Local Storage/leveldb/MANIFEST-000001";
        let boundary = std::path::PathBuf::from("C:/").join("a".repeat(200));
        assert_eq!(
            boundary.join(suffix).as_os_str().encode_wide().count() + 1,
            260
        );
        assert_eq!(super::validate_windows_session_path(&boundary), Ok(()));
        assert_eq!(
            super::validate_windows_session_path(&boundary.join("a")),
            Err(ErrorCode::StorageError)
        );
        let unicode =
            std::path::PathBuf::from("C:/").join(format!("{}{}", "😀".repeat(40), "a".repeat(130)));
        assert!(unicode.join(suffix).to_string_lossy().chars().count() < 260);
        assert!(unicode.join(suffix).as_os_str().encode_wide().count() + 1 > 260);
        assert_eq!(
            super::validate_windows_session_path(&unicode),
            Err(ErrorCode::StorageError)
        );

        let fixture = native_fixture();
        let long_app_data = fixture.path().join("a".repeat(180));
        assert!(super::PreviewHost::new(long_app_data.clone()).is_ok());
        let long_root = long_app_data.join("preview-sessions");
        assert_eq!(
            super::prepare_session_directory(&long_root, "profile-a"),
            Err(ErrorCode::StorageError)
        );
        assert_eq!(std::fs::read_dir(&long_root).unwrap().count(), 0);
    }

    #[test]
    fn clearing_another_profile_cannot_report_success_after_directory_failure() {
        use super::{Current, Inner};
        use markbridge_protocol::{Id, WebPreviewPhase};

        let id = |value| Id::new(value).unwrap();
        let mut inner = Inner {
            generation: 1,
            current: Some(Current {
                generation: 1,
                profile_id: id("profile-b"),
                chrome_id: id("node-b"),
                request_id: id("request-b"),
                selected_url: "https://example.com/b".into(),
                current_url: Some("https://example.com/b".into()),
                phase: WebPreviewPhase::Ready,
                can_go_back: true,
                can_go_forward: false,
                notice: None,
                open: true,
                recent_deny: None,
                native_sequence: 0,
                native_load: None,
            }),
        };
        let before = inner.snapshot();
        assert_eq!(
            inner.finish_session_clear(&id("profile-a"), id("clear-a"), false),
            Err(ErrorCode::StorageError)
        );
        assert_eq!(inner.snapshot(), before);
        assert_eq!(
            inner.finish_session_clear(&id("profile-a"), id("clear-a"), true),
            Ok(())
        );
        assert_eq!(inner.snapshot(), before);
        assert_eq!(
            inner.finish_session_clear(&id("profile-b"), id("clear-b"), false),
            Ok(())
        );
        assert_eq!(
            inner.snapshot().notice.0,
            Some(WebPreviewNotice::SessionBusy)
        );
        assert_eq!(inner.snapshot().phase, WebPreviewPhase::Ready);
        inner.current = None;
        assert_eq!(
            inner.finish_session_clear(&id("profile-a"), id("clear-a"), false),
            Err(ErrorCode::StorageError)
        );
    }

    #[test]
    fn capability_lists_only_the_main_window() {
        let main = include_str!("../capabilities/main.json");
        assert!(main.contains("\"windows\": [\"main\"]"));
        assert!(!main.contains("\"remote\""));
        assert!(!main.contains("preview-"));
        let conf = include_str!("../tauri.conf.json");
        assert!(conf.contains("\"capabilities\": [\"main\"]"));
    }

    #[test]
    fn every_registered_command_checks_the_caller_window() {
        let main = include_str!("main.rs");
        let preview = include_str!("preview.rs");
        let start = main.find("generate_handler![").expect("handler");
        let rest = &main[start + "generate_handler![".len()..];
        let end = rest.find("])").expect("handler end");
        let names: Vec<&str> = rest[..end]
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .collect();
        assert!(names.contains(&"open_web_preview"));
        assert!(names.contains(&"web_preview_action"));
        assert!(names.contains(&"clear_web_preview_session"));
        assert!(names.contains(&"web_preview_state"));
        assert!(names.contains(&"open_http_url"));
        assert!(names.contains(&"content_preview"));
        assert!(names.contains(&"save_diagnostics"));
        for name in names {
            let marker = format!("fn {name}(");
            let source = if main.contains(&marker) {
                main
            } else {
                preview
            };
            let at = source
                .find(&marker)
                .unwrap_or_else(|| panic!("missing {name}"));
            let body = &source[at..at.saturating_add(1800).min(source.len())];
            assert!(
                body.contains("trusted(&window)?") || body.contains("caller_may_control"),
                "{name} does not check the caller window"
            );
        }
    }
}
