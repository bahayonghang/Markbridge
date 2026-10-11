//! One full-page preview window. Remote pages get no application capability.
use markbridge_protocol::{
    ErrorCode, Id, RequiredNullable, WebPreviewNotice, WebPreviewPhase, WebPreviewState,
};
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
}

impl PreviewHost {
    pub fn new(app_data: PathBuf) -> Result<Self, ErrorCode> {
        let root = app_data.join("preview-sessions");
        if !app_data.is_absolute() {
            return Err(ErrorCode::StorageError);
        }
        std::fs::create_dir_all(&root).map_err(|_| ErrorCode::StorageError)?;
        Ok(Self {
            root,
            inner: std::sync::Mutex::new(Inner {
                generation: 0,
                current: None,
            }),
            op: tokio::sync::Mutex::new(()),
        })
    }

    pub fn snapshot(&self) -> WebPreviewState {
        self.lock().snapshot()
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
        let url = user_navigation_target(raw_url)?;
        let dir = session_directory(&self.root, profile_id.as_str())?;
        std::fs::create_dir_all(&dir).map_err(|_| ErrorCode::StorageError)?;
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
                }
            }
            window
                .navigate(url)
                .map_err(|_| ErrorCode::InvalidMessage)?;
            let _ = window.set_focus();
            return Ok(self.publish(app));
        }
        self.destroy_preview(app).await?;
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
            });
            generation
        };
        if self.build_window(app, &dir, url, generation).is_err() {
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
        match action {
            "back" => history_move(&window, HistoryMove::Back)?,
            "forward" => history_move(&window, HistoryMove::Forward)?,
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
        let owns = self
            .lock()
            .current
            .as_ref()
            .is_some_and(|current| current.open && current.profile_id == profile_id);
        if owns {
            self.destroy_preview(app).await?;
        }
        let cleared = remove_session_dir(&self.root, &dir).await;
        let notice = if cleared {
            WebPreviewNotice::SessionCleared
        } else {
            WebPreviewNotice::SessionBusy
        };
        {
            let mut inner = self.lock();
            let same = inner
                .current
                .as_ref()
                .is_some_and(|current| current.profile_id == profile_id);
            if same && let Some(current) = inner.current.as_mut() {
                current.request_id = request_id;
                current.notice = Some(notice);
                if cleared {
                    current.open = false;
                    current.phase = WebPreviewPhase::Closed;
                    current.can_go_back = false;
                    current.can_go_forward = false;
                }
            }
        }
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

    fn build_window(
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
        let window = WebviewWindowBuilder::new(app, PREVIEW_LABEL, WebviewUrl::External(url))
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
            })
            .build()
            .map_err(|_| ErrorCode::InvalidMessage)?;
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Some(host) = app_close.try_state::<PreviewHost>()
            {
                host.on_destroyed(&app_close, generation);
            }
        });
        attach_load_watch(&window, app.clone(), generation);
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

impl Inner {
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
    let name = hex_encode(id.as_str());
    if name.is_empty() || name.len() > 256 || !name.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ErrorCode::InvalidMessage);
    }
    let path = root.join(&name);
    if path.parent() != Some(root) {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(path)
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

async fn remove_session_dir(root: &Path, dir: &Path) -> bool {
    for _ in 0..30 {
        match remove_session_dir_once(root, dir) {
            Remove::Gone => return true,
            Remove::Busy => tokio::time::sleep(Duration::from_millis(100)).await,
            Remove::Refuse => return false,
        }
    }
    false
}

#[derive(Debug, PartialEq, Eq)]
enum Remove {
    Gone,
    Busy,
    Refuse,
}

fn remove_session_dir_once(root: &Path, dir: &Path) -> Remove {
    if dir == root || dir.parent() != Some(root) {
        return Remove::Refuse;
    }
    if !dir.exists() {
        return Remove::Gone;
    }
    let Ok(root) = root.canonicalize() else {
        return Remove::Busy;
    };
    let Ok(target) = dir.canonicalize() else {
        return Remove::Busy;
    };
    if target.parent() != Some(root.as_path()) {
        return Remove::Refuse;
    }
    match std::fs::remove_dir_all(&target) {
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

fn history_move(window: &WebviewWindow, action: HistoryMove) -> Result<(), ErrorCode> {
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
    #[cfg(not(windows))]
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
    #[cfg(not(windows))]
    {
        let _ = (window, app, generation);
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

#[cfg(windows)]
const SCHEME_GUARD: &str = r#"(function(){if(window.__mbSchemeGuard)return;window.__mbSchemeGuard=1;var busy=false;function bad(value){var text=String(value==null?'':value).replace(/^\s+/,'');var match=/^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text);if(!match)return false;var scheme=match[1].toLowerCase();return scheme!=='http'&&scheme!=='https';}function report(){if(busy)return;busy=true;try{location.assign('markbridge-blocked:scheme');}finally{busy=false;}}try{var desc=Object.getOwnPropertyDescriptor(Location.prototype,'href');if(desc&&desc.set&&desc.configurable){var set=desc.set;Object.defineProperty(Location.prototype,'href',{configurable:true,enumerable:desc.enumerable,get:desc.get,set:function(value){if(!busy&&bad(value)){report();return;}set.call(this,value);}});}}catch(e){}document.addEventListener('click',function(event){var node=event.target&&event.target.closest?event.target.closest('a[href]'):null;if(!node||!bad(node.getAttribute('href')))return;event.preventDefault();event.stopPropagation();report();},true);})();"#;

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

    fn url(raw: &str) -> tauri::Url {
        tauri::Url::parse(raw).unwrap()
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
        let root = std::env::temp_dir().join(format!("mb09-preview-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let path = session_directory(&root, "p:abc").unwrap();
        assert_eq!(path.parent(), Some(root.as_path()));
        assert!(
            path.file_name()
                .unwrap()
                .to_str()
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
        let _ = std::fs::remove_dir_all(&root);
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
