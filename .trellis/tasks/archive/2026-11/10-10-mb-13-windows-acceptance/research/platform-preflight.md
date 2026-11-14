# Research: Task 14 platform preflight

- Query: Minimal macOS/Linux changes after task 13, using the installed keyring/Tauri/Wry APIs while preserving Windows behavior and the existing safety contracts.
- Scope: mixed; product/source and cached dependency inspection, corroborated with primary documentation. No product edit, task start/status change, Git operation, dependency installation, or native platform test was performed by this research agent.
- Date: 2026-10-13

## Findings

### Authorization and evidence boundary

Task 14 remains dependent on accepted task 13. This preflight belongs to task 13 and does not activate task 14. The user explicitly reports no macOS/Linux native environments and no local embedding endpoint. Their instruction permits all independently executable implementation/check work, then recording task 14's missing evidence and continuing independent task 15. V17 and AC14 native claims remain NOT_RUN; WSL/Windows source checks do not establish macOS or Linux desktop support. Actual sleep/wake is already WAIVED with execution NOT_RUN; do not reinstate it through the older V17 wording referencing V04.

The parent supplied this environment observation: WSL Ubuntu 24.04 has GTK 3.24.41, WebKitGTK 2.52.6 and DISPLAY, but lacks google-chrome, cargo and pnpm. This agent did not rerun that probe. It does not constitute an available full V17 environment, and no environment installation is authorized.

### Files found and responsibility

| File | Purpose / minimal task 14 work |
| --- | --- |
| `crates/core/Cargo.toml:31` | Currently keyring is Windows-only; add target-specific macOS/Linux native stores at the same pinned version. |
| `crates/core/src/bridge/credentials.rs:1` | Preserve the Windows credential target encoding; add native macOS/Linux entry construction and fail-closed error handling. |
| `crates/core/src/mirror/mod.rs:92` | Existing directory enumeration and read-only parser accept a user-selected absolute directory; no Windows root is hardcoded here. |
| `crates/core/src/bridge/file_mirror.rs:63` | Existing explicit-path bridge API and notify recovery can remain; actual FSEvents/inotify behavior requires native checks. |
| `apps/desktop/src/features/settings/ConnectionSettings.tsx:178` | Current explicit directory input is platform-neutral. Add platform-path guidance only if useful, using existing UI design; do not automatically inspect daily profiles. |
| `apps/desktop/src-tauri/Cargo.toml:16` | Add only target-scoped native API dependencies needed below, matching the locked versions. |
| `apps/desktop/src-tauri/src/main.rs:217` | `open_http` rejects non-Windows; add fixed native handoff commands behind OS cfg and preserve URL validation. |
| `apps/desktop/src-tauri/src/main.rs:963` | Main acceptance WebView currently gets an absolute `main-webview` data directory; macOS needs a distinct native data-store identifier. |
| `apps/desktop/src-tauri/src/export.rs:151` | Windows selector exists; non-Windows currently returns ReadOnly. Add native destination selectors, retaining the common atomic writer and results. |
| `apps/desktop/src-tauri/src/preview.rs:64` | Current per-Profile opening/reuse, generation filtering and bounded state stay. |
| `apps/desktop/src-tauri/src/preview.rs:153` | Clear currently destroys a window and deletes its directory. macOS and Linux need native store/context clear completion. |
| `apps/desktop/src-tauri/src/preview.rs:348` | Currently uses only `data_directory`; branch macOS onto `data_store_identifier`. |
| `apps/desktop/src-tauri/src/preview.rs:601` | Non-Windows history uses page JavaScript; add native history state/feedback. |
| `apps/desktop/src-tauri/src/preview.rs:642` | Native load/history/failure feedback is Windows-only; non-Windows hook is empty at line 725. |
| `apps/desktop/src-tauri/capabilities/main.json:1` | Keep only `main`; no preview capability or frontend dialog/file permission. |
| `scripts/native-build.mjs:11` | Current path/secret scanner and Windows-only artifact selection; extend for ELF/Mach-O without weakening Windows checks. |
| `scripts/native-package.mjs:66` | Current remapped release build plus unsigned NSIS bundle and packaged-exe comparison; add native bundle branches. |
| `scripts/native-artifact.test.mjs:5` | Add POSIX build-path leakage and platform artifact selection/target-directory counterexamples. |
| `.github/workflows/ci.yml:9` | Currently Windows only; scoped platform checks may be added, but an unexecuted workflow is NOT_RUN. |
| `apps/desktop/src-tauri/tauri.conf.json:1` | Bundle currently disabled; use platform-specific bundle selection and macOS minimum version, retaining no automatic release/install/signing. |

### Installed version baseline

`Cargo.lock` currently selects keyring **3.6.1**, Tauri **2.12.3**, tauri-runtime-wry **2.12.1**, Wry **0.57.0**, tauri-utils **2.10.1**, gtk **0.18.2**, webkit2gtk **2.0.2**, objc2-web-kit **0.3.2**, objc2-app-kit **0.3.2**, and objc2-foundation **0.3.2**. Workspace Cargo uses resolver 2 and Rust 1.99. Do not copy a keyring 4.x API or change the stack to solve this task.

Cached sources inspected are under `C:/Users/lyh/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`. The references below use `<registry>/...` as that read-only source root. Target APIs in cached source are verified present; compilation/linking/runtime on the absent target platforms is still NOT_RUN.

### 1. Native credentials, without plaintext or mock fallback

Minimal Cargo additions alongside the existing Windows target section:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
keyring = { version = "=3.6.1", default-features = false, features = ["apple-native"] }

[target.'cfg(target_os = "linux")'.dependencies]
keyring = { version = "=3.6.1", default-features = false, features = ["sync-secret-service", "crypto-rust"] }
```

`<registry>/keyring-3.6.1/src/lib.rs:65` documents that no enabled store on the target falls back to the in-memory mock store; features are therefore a security contract, not cosmetic configuration. `Cargo.toml:105` provides apple-native, line 115 crypto-rust, and line 128 sync-secret-service. Linux synchronous calls can use encrypted D-Bus transport with crypto-rust; do not enable both sync and async Secret Service features. Plain linux-native uses kernel keyutils and is not the task's requested persistent Secret Service backend.

Windows `OsCredentialStore::entry` at `credentials.rs:25` deliberately uses a short service/user with a long unique target to avoid the Credential Manager comment limit; keep its identity mapping exactly. **Do not extend `Entry::new_with_target("Markbridge/...", ...)` to macOS**: `<registry>/keyring-3.6.1/src/macos.rs:136` interprets target as a Keychain domain, and line 228 accepts only user/system/common/dynamic. The existing Windows string would be invalid. For macOS/Linux, `Entry::new(namespace, reference)` gives distinct service/account entries and preserves `Markbridge.Pairing`, `Markbridge.Model` and disposable acceptance namespaces. Validate nonempty/NUL-free identifiers without logging the reference or secret.

Native store absence, D-Bus/session-bus absence, locked/denied Keychain or Secret Service failure must return stable errors and leave previous credential/configuration references intact. Never write a secret into SQLite, JSON, React, logs or environment as a workaround. UI must explain unavailable secure storage and prevent claiming a key was saved. A mock-store roundtrip is deterministic test evidence only. Preserve Windows actual-store tests; use the existing CredentialStore injection pattern for failure tests without globally replacing keyring's default builder.

Linux build dependencies include libdbus headers/linking for sync-secret-service unless explicitly vendored; runtime still needs an available, unlocked desktop Secret Service and session bus. Adding these features changes lockfile resolution, even when the current machine is Windows. This research did not resolve/fetch/build new dependencies.

Primary references: [keyring 3.6.1 feature flags](https://docs.rs/crate/keyring/3.6.1/features), [versioned crate documentation](https://docs.rs/crate/keyring/3.6.1), [Secret Service specification](https://specifications.freedesktop.org/secret-service/latest/).

### 2. Chrome Profile paths and watcher behavior

Existing APIs already accept explicit absolute paths: `file_mirror.rs:63`, `mirror/mod.rs:92`, and `mirror/mod.rs:341` (require absolute path, canonicalize and require directory). They enumerate `Local State` profile keys and read `Bookmarks`; the same relative structure works on macOS/Linux. DirectoryKey traversal protection stays unchanged. There is currently no production automatic OS-root discovery; do not describe that as already implemented.

Document these stable-Chrome user-data roots, allowing an explicit custom root:

| Platform | Default Chrome root |
| --- | --- |
| Windows | `%LOCALAPPDATA%/Google/Chrome/User Data` |
| macOS | `~/Library/Application Support/Google/Chrome` |
| Linux | `~/.config/google-chrome` |

On Linux Chrome honors CHROME_CONFIG_HOME or XDG_CONFIG_HOME for the config base, and CHROME_USER_DATA_DIR may override the complete root. `--user-data-dir` wins. Custom channels/Chromium have distinct names; do not silently substitute them. A user can inspect `chrome://version` and supply the parent of Profile Path. Keep browsing/enumeration explicit to avoid probing daily profiles during acceptance or startup. Platform path guidance plus current generic reader is a smaller change than a new scanner/DTO framework.

Notify's existing recommended watcher, debounce, periodic metadata comparison and restart path can be reused. Native checks must cover Chrome atomic replacement, missing/unreadable paths, offline cached view and restart recovery on each OS; a Windows fixture does not prove FSEvents/inotify behavior. Preserve read-only file access and live-cache precedence.

Primary reference: [Chromium user-data-directory documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md).

### 3. External HTTP opening and native saving

Keep `validate_http_url` and trusted-main caller checks. Windows rundll32 handoff and its suspension/PID acceptance hooks remain Windows-only. macOS may use a fixed `/usr/bin/open` command; Linux may use fixed xdg-open with one already validated HTTP(S) URL argument. Never use a shell or interpolate URLs into command strings. Test command/argument selection using a fake executable, not the user's daily browser. A spawn/handoff receipt is not proof that a page loaded; native default-browser behavior remains a target-platform check. Handle launch failure without logging the full URL.

The existing export writer at `export.rs:64`/`:99` captures body before the dialog, writes a temporary file, syncs and atomically replaces. Unix replacement already uses rename at line 147. Keep SaveGuard, destination preservation, cancellation vs failure, fixed error codes, and no path/body in IPC.

The smallest native selectors can use dependencies already in Tauri's native stack, rather than adding a new frontend plugin/permission:

- Linux: `window.gtk_window()` returns gtk::ApplicationWindow (`<registry>/tauri-2.12.3/src/webview/webview_window.rs:1980`). gtk 0.18.2 FileChooserNative::new is at `src/auto/file_chooser_native.rs:24`; NativeDialogExt::run at `src/auto/native_dialog.rs:87`; FileChooserExt::filename/set_current_name/set_do_overwrite_confirmation at `src/auto/file_chooser.rs:181`/`:527`/`:537`. Run/create/parent it on the GTK thread, distinguish an accepted destination, cancellation and unexpected response/selector failure. Add target-scoped gtk dependency only.
- macOS: `window.ns_window()` is at Tauri `webview_window.rs:1954`. Cached objc2-app-kit 0.3.2 NSSavePanel provides savePanel (line 107), URL (113), setTitle (302), setNameFieldStringValue (331), beginSheetModalForWindow_completionHandler (415), and runModal (435). Use the trusted main NSWindow as owner and the main thread; treat OK with missing URL as failure, and explicit cancel as cancellation. Target-scoped objc2/AppKit/Foundation plus block2 if using a sheet callback is enough.

An alternative rfd 0.17.2 is cached but **not in this project's lockfile**. Its `FileDialog::save_file` returns Option<PathBuf>; backend None can conflate non-OK failures and cancellation. The common export contract requires truthful failure/cancel results, so assess that limitation before choosing it. A large dialog/plugin migration is unnecessary, and Windows selector behavior need not change.

### 4. Main/preview/Profile data stores and clearing

Current `.data_directory(dir)` at preview.rs:365 and `main-webview` override at main.rs:974 work for the existing Windows approach. Native isolation requires OS-specific branches:

- **macOS 14+**: use WebviewWindowBuilder::data_store_identifier([u8;16]) (`<registry>/tauri-2.12.3/src/webview/webview_window.rs:1200`). Wry uses WKWebsiteDataStore::dataStoreForIdentifier (`<registry>/wry-0.57.0/src/wkwebview/mod.rs:220`–`:246`). WKWebView does not use the filesystem data_directory to isolate cookies. Derive stable distinct identifiers from a domain-separated main/preview name, application-data root and Profile identity; use a collision-resistant 128-bit portion of a hash, with deterministic tests for profile/role/root separation and restart stability. Do not use a new random ID on each open. Acceptance root must differ from normal app root. Do not enumerate/remove other app stores.
- **Linux**: retain one contained absolute data directory per Profile and a distinct trusted-main directory. Wry's WebContextImpl::new maps data/cache directories and persistent cookie storage (`<registry>/wry-0.57.0/src/webkitgtk/web_context.rs:32`). Tauri keys contexts by data_directory (`<registry>/tauri-runtime-wry-2.12.1/src/lib.rs:4714`), so equal directories share context. Preserve distinct paths for every role/Profile.

macOS minimum version must be 14.0 for this isolation design. Wry **silently uses the default data store below 14** (`wkwebview/mod.rs:244`); do not report isolated sessions on those systems. Bundle minimumSystemVersion is ignored in tauri dev, so a development/runtime guard is also needed before constructing persistent preview stores on older macOS. Record support as implementation pending native validation.

Clearing cannot simply reuse filesystem deletion:

- macOS: first destroy/drop any preview using the selected identifier, then await `AppHandle::remove_data_store(uuid)` (`<registry>/tauri-2.12.3/src/app.rs:456`). It dispatches onto the main thread and waits for the native completion result. Wry rejects a store still in use. A bounded failure/timeout must report SessionBusy/StorageError, never SessionCleared. This works for a closed Profile without constructing a visible remote window.
- Linux: current runtime deliberately **retains WebContexts for the app lifetime** after their windows close (`<registry>/tauri-runtime-wry-2.12.1/src/lib.rs:2391`–`:2413`). Destroying a window and deleting the directory does not guarantee that in-memory cookies/context data are gone. Keep/find only that Profile's context, stop navigation, invoke WebsiteDataManagerExtManual::clear with ALL/zero timespan, and await its callback before reporting success or reusing the context. The manual clear API is at `<registry>/webkit2gtk-2.0.2/src/website_data_manager.rs:18` and requires the v2_16 feature (already encompassed by Wry's newer feature set; verify direct dependency features). A closed Profile needs a Rust-owned route to its retained context or a hidden capability-free WebView in the exact directory; do not clear whichever other Profile is currently open.

Tauri `clear_all_browsing_data()` exists, but its return does **not** establish deletion completion: `tauri-2.12.3/src/webview/mod.rs:2384` explicitly documents asynchronous clearing. Wry Linux/Apple implementations discard completion errors (`webkitgtk/mod.rs:919`, `wkwebview/mod.rs:832`). Use the underlying callback when the UI result promises SessionCleared. Existing containment/symlink tests remain meaningful; add target-context isolation tests and native cookie/localStorage receipts later.

Primary references: [Tauri WindowConfig](https://v2.tauri.app/reference/config/#windowconfig), [Apple WKWebsiteDataStore initializer](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/init(foridentifier:)). API details above were verified directly in the installed Rust sources; Apple web text extraction was unavailable.

### 5. Navigation/history/failure feedback

The current non-Windows hook at preview.rs:725 does nothing. `history.back()`/`history.forward()` can move a page, but canGoBack/canGoForward remain false and Loading never becomes Ready from this hook. Preserve the existing HTTP(S)/userinfo policy, native navigation cancellation, popup/download denial, caller-label guard and generation checks. Do not grant a remote page application IPC to supply status.

Use `on_page_load` for available progress events plus a small native platform observer:

- Linux `PlatformWebview::inner()` returns webkit2gtk::WebView (`<registry>/tauri-2.12.3/src/webview/mod.rs:177`). Native methods can_go_back/can_go_forward/uri/go_back/go_forward and connect_load_changed/connect_load_failed are present in webkit2gtk 2.0.2 `src/auto/web_view.rs:751`/`:760`/`:1219`/`:1284`/`:1291`/`:2287`/`:2316`. Read history/URI on navigation, page-load, URI notification and list changes. The native BackForwardList::changed signal exists, but **the typed Rust connect_changed is omitted** (`src/auto/back_forward_list.rs:120`); use GLib ObjectExt::connect_local("changed", ...) or an equally small observer, not a nonexistent method. GTK objects remain on the main thread and should not be stored directly in Send/Sync PreviewHost.
- **GTK load-failed is followed by load-changed FINISHED even on failure.** Wry forwards Finished (`webkitgtk/mod.rs:481`). Do not unconditionally call finish_navigation(success=true) on Finished after recording a failure. Maintain failure/denial status for the current navigation attempt; cancelled forbidden schemes must not become an unrelated LoadFailed.
- macOS PlatformWebview::inner() returns a raw WKWebView pointer (`tauri-2.12.3/src/webview/mod.rs:204`); use matching objc2-web-kit bindings on the main thread. WKWebView::canGoBack/canGoForward/isLoading/URL and native back/forward methods are available. Read actual native state after page events/actions, and observe history properties for same-document pushState/back/forward, where full page-load events may not fire.
- Wry 0.57.0's WKNavigationDelegate implements didCommit/didFinish, **but no didFail callback** (`wkwebview/class/wry_navigation_delegate.rs:71`, `wkwebview/navigation.rs:17`). Tauri's high-level page-load callback alone cannot prove a failed navigation is detected. Do not replace Wry's navigationDelegate and accidentally remove navigation policy, popup/download plumbing, and script initialization. A small forward-preserving native observer, or a conservative bounded failure timeout with truthful failed state, must cover this gap. This choice and real error-path behavior remain an implementation/native-check concern; do not infer success merely from isLoading=false.

Callbacks for a prior window/navigation cannot overwrite the currently selected Profile or request. Preserve bounded URLs and never log full URL/title/native error strings. Current Windows event handlers and scheme guard remain unchanged.

Primary reference: [WebKitGTK load-failed semantics](https://www.webkitgtk.org/reference/webkit2gtk/stable/signal.WebView.load-failed.html).

### 6. Native builds, bundles and Windows regression

`nativeReleaseContext` already computes command-scoped remap prefixes for workspace, Cargo, Rustup and user home, merges existing encoded flags, resolves CARGO_TARGET_DIR once and passes the exact absolute target to the CLI. Keep this contract. Use the installed Node/Tauri CLI with an argument array and desktop cwd, as in the current dev/build scripts; do not introduce shell:true (the Windows JSON-argument failure is already fixed and covered by foundation.test.mjs).

Minimal changes:

1. Choose `release/markbridge-desktop.exe` on Windows and `release/markbridge-desktop` on macOS/Linux. Reject unsupported OS/architecture targets explicitly. Target-directory and artifact tests should inject a platform without needing a native build.
2. Retain UTF-8/UTF-16LE Windows path and secret checks. Add checks for the actual configured POSIX source/home/cache prefixes and relevant `/Users/...`/`/home/...` source leakage, including UTF-8. Avoid rejecting every POSIX absolute path: legitimate platform library/resource paths and virtual `/workspace`, `/cargo-home`, `/rustup-home`, `/build-home` are allowed. Report pattern labels only. Keep known-prefix detection distinct from proof against arbitrary secret encodings.
3. Build the unbundled remapped release first; bundle that artifact locally with Windows nsis, macOS app/dmg, Linux deb/appimage. CLI BundleType supports all these names (`<registry>/tauri-utils-2.10.1/src/config.rs:132`). Reuse no-sign/no-binary-patching handling where supported and record actual bundle behavior. On macOS native code-sign/bundle tooling may change bytes; do not falsely assert matching pre-bundle hashes without an actual check.
4. Scan/list the actual shipped executable and metadata from each bundle, not only the compressed installer bytes. Mac `.app` executable is beneath Contents/MacOS; Linux `.deb` data archive and AppImage need contained extraction. Verify installed executable/hash/version/assets and data retention later on their native hosts. No extraction or package scan performed here.
5. Keep the current Windows CI/gates. Additional platform CI should install only documented build dependencies in its isolated runner and run fmt/clippy/tests/current protocol checks/native build/scan. Select a genuine arm64 macOS runner for the design target; do not assume a runner label's architecture. Configuring CI is source evidence until it runs; even successful CI compilation cannot satisfy V17 desktop/Chrome/install receipts.

Linux build guidance should specify GTK3/WebKitGTK **4.1** development libraries, libdbus-1-dev, and the existing Tauri prerequisites. Verify runtime WebKitGTK/GTK/Chrome versions on the actual desktop; package presence and DISPLAY alone are insufficient. Windows native behavior must be regressed after changing shared helpers.

Native cfg compile pitfalls to check before claiming source completion:

- main.rs currently declares CREATE_NO_WINDOW/CREATE_SUSPENDED, suspend_requested, open_http_creation_flags and absolute_pidfile without Windows cfg; non-Windows builds may produce dead_code under clippy -D warnings. Scope declarations and their tests/imports consistently, preserving Windows suspension tests.
- preview.rs finish_navigation/note_history/note_scheme have mainly Windows-only callers today; non-Windows implementation must either use them or correctly cfg the truly Windows-only helpers. Do not silence all lint warnings globally.
- Target-scoped direct gtk/WebKit/objc dependencies must match Tauri's locked type versions. Linux gtk::glib and webkit2gtk's glib types must be the same version. Native objects/raw pointers cannot cross worker threads unsafely.
- Native store operations need asynchronous replies; do not block the main event loop waiting for a callback scheduled on that loop. Tauri with_webview executes a closure on the UI thread; return through oneshot and await off that thread.
- Source checks executed on Windows do not type-check cfg-excluded platform code. Cross target checks, if available, only establish compilation, never native behavior. Record any unavailable check separately.

Primary references: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux), [bundle configuration](https://v2.tauri.app/reference/config/#bundleconfig), [distribution formats](https://v2.tauri.app/distribute/).

### Related specs and task contracts

- `.trellis/spec/project-baseline.md`: sole SQLite/browser writers; separate native evidence; no plaintext key fallback or preview IPC; sleep waiver.
- `.trellis/spec/backend/quality-guidelines.md:15`: native Chrome, secret storage, isolation and installed behavior require native receipts. The existing Windows-only native-build spec must be updated with task 14's actual script contract when implemented.
- `.trellis/spec/backend/quality-guidelines.md:56`: main acceptance-data isolation and forbidden global WEBVIEW2_USER_DATA_FOLDER override.
- `.trellis/spec/backend/error-handling.md:31`: cancelled/failed/saved native export distinction and destination preservation.
- `.trellis/spec/backend/logging-guidelines.md`: fixed diagnostic/error fields; no credentials, content, full titles/URLs or private paths in logs/IPC results.
- `.trellis/tasks/10-10-mb-14-cross-platform/{prd,design,implement}.md`: native macOS 14+ arm64 and Ubuntu 24.04 x64 targets; Keychain/Secret Service; main/preview/Profile isolation; native install/rollback; Windows regression; missing host leaves task incomplete.
- `.trellis/tasks/10-10-markbridge-workspace/verification.md:36`: V17; task 15 remains independent of task 14.
- `docs/next-session-prompt.md:16`: finish independent source work, report target environments NOT_RUN, clear active pointer before independent 15; no support claim or silent task closure.

## Caveats / Not Found

- No macOS/Linux native test or build was run, and no dependencies or environment were installed. V17 and AC14-1/2/3 target behavior remain NOT_RUN. This file is a technical handoff, not acceptance evidence.
- The WSL component versions/tool absence above are parent-provided observations. User explicitly declined supplying native hosts. No claim that WSL can satisfy the required desktop evidence.
- High-level Tauri has no complete generic native history/error observer. In particular, current Wry macOS load failures need a deliberate conservative implementation; source presence of a native API does not prove its callback works in this application.
- Cached source provides synchronous native dialog APIs. rfd is cached but not selected in this project's lockfile; its failure/cancellation ambiguity is a reason to prefer the narrow native selectors.
- The Apple documentation page required JavaScript; its Markdown endpoint and some versioned docs.rs/WebKitGTK pages were inaccessible to web extraction. Exact APIs above were checked in installed crate sources, with accessible Tauri/keyring/Chromium/WebKitGTK primary references retained.
- Task 13 status and the gate for activating 14 are coordinated by the main session; this researcher did not assess or change them. No real-model or remaining-task audit is duplicated here.
