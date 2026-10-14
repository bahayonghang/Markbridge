# Backend Quality Guidelines

Child 01 provides Cargo manifests and foundation tests. Bootstrap validation remains historical document evidence; child 01 records product command results separately.

Foundation Rust gates are `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace --locked`. Core and protocol unit tests are in `crates/core/src/lib.rs` and `crates/protocol/src/lib.rs`. `scripts/protocol.test.mjs` checks generated TypeScript and JSON Schema drift using temporary copies.

Child 02 protocol behavior tests are in `crates/protocol/src/wire_tests.rs`; storage and migration tests are in `crates/core/src/storage/tests.rs`. Run the Rust tests and protocol generation against the current source. A cached exporter result alone does not establish that the current Rust source compiles. The TypeScript wire tests also invoke the Rust fixture executable and compare acceptance of shared input frames.

Use synthetic fixtures and disposable profiles. Cover identity isolation, dynamic roots, managed nodes, event gaps, lost acknowledgments, worker restart, migration failure, interrupted batch, and rollback conflicts.

Check fetch restrictions at every redirect and address resolution. A remote preview must fail to invoke protected commands.

Record timestamps, fixture size, runtime, and machine for latency claims. Compare semantic structure and order for rollback; recreated node IDs can differ.

Native Chrome, WebView isolation, secret storage, and installed behavior require native evidence. A build or mock is insufficient. Record absent environments as NOT_RUN.

Child 09 unit tests cover navigation policy, session-directory containment, the main capability file, and the trusted-label check on registered commands. `open_http` uses `rundll32 url.dll,FileProtocolHandler`. Acceptance may set `MARKBRIDGE_OPEN_HTTP_SUSPEND=1` and an absolute `MARKBRIDGE_OPEN_HTTP_PIDFILE` so a probe can read that suspended process and terminate it before `url.dll` runs. Those tests do not mark parent V11 passed. V11 needs a native preview window, profile isolation, and denial receipts. Preview history buttons follow the WebView2 `HistoryChanged` event. The preview window cancels a non-http(s) navigation in its own `NavigationStarting` handler. A document script turns a silent `javascript:` or `file:` assignment into that cancelled navigation so the main window can show `SchemeDenied`.

## Native foundation release gate

### 1. Scope and trigger

AC01-4 covers native release assets as well as Web assets. Child 01 found absolute build-machine source paths in an otherwise successful release build. Compilation alone does not satisfy the artifact gate.

### 2. Signatures

`pnpm build:native` runs `scripts/native-build.mjs`. It verifies Node platform/architecture against `rustc --version --verbose` host and calls the installed Node Tauri CLI with `build --target <native-host> --no-bundle -- --locked`. Configured targets are Windows x64 MSVC, macOS arm64, and Linux x64 GNU. Scan the actual PE/ELF/Mach-O executable for that host. `pnpm build` retains its Web build scope; source support for a host is not native acceptance.

### 3. Contract

The script computes source prefixes from the workspace, Cargo home, Rustup home, target directory and build-user home, including actual canonical aliases. Command-scoped `CARGO_ENCODED_RUSTFLAGS` adds `--remap-path-prefix` values to existing flags. Tracked configuration must not contain machine-specific absolute prefixes. Remapped prefixes are virtual source locations. The command does not create an installer or install the application.

Resolve `CARGO_TARGET_DIR` once to an absolute base; relative values use the workspace root. Pass that base to both build and scanner. Explicit `--target` overrides inherited Cargo target settings; `releaseDirectory` is `<base>/<native-host>/release`, and the artifact is `markbridge-desktop.exe` on Windows or `markbridge-desktop` elsewhere. Do not scan the previous unqualified release directory. The default base is workspace `target`.

### 4. Validation and errors

| Condition | Result |
|---|---|
| Release build succeeds and UTF-8/UTF-16LE scans find no configured pattern | Exit 0 with artifact byte count and SHA256 |
| Build fails or artifact is absent | Nonzero exit; no artifact PASS |
| Absolute Windows/POSIX user path, actual configured build prefix, private-key header, or known API-key pattern matches | Nonzero exit; report the pattern label without printing matched data |
| Runtime platform/architecture, Rust host or binary format/architecture disagrees | Reject; no stale or cross-target artifact PASS |

### 5. Cases

Good: a native executable with only virtual source prefixes passes. Base: Windows CI builds/scans; task14 adds Ubuntu24.04 x64/macOS15 arm64 build/package CI with actual architecture assertions. macOS15 is the maintained build runner; runtime/bundle minimum14 and native minimum-version NOT_RUN remain unchanged. Bad: source-path leaks, wrong architecture, ELF relocatable objects, or an inherited target pointing to an old artifact fail.

### 6. Required tests

`scripts/native-artifact.test.mjs` checks encodings, path/secret counterexamples, virtual prefixes, host/format selection, target-root consistency and package extraction boundaries. `pnpm test` includes it. `native-package.mjs` invokes the same native build, then bundles the same host with no signing/binary patching request and scans the actual packaged program, requiring strict byte equality with the post-bundle release. NSIS uses 7-Zip, DMG uses readonly hdiutil mount/exact detach, deb extracts only its regular program member, AppImage uses type2 runtime extraction without AppRun. Recursive cleanup requires a canonical exclusive temporary root and no linked/mounted descendants; a failed detach preserves the root. Record real hashes/results; unexecuted CI/target tools remain NOT_RUN, and pattern scanning is not proof against arbitrary secret encodings.

### 7. Incorrect and correct usage

Incorrect: use Web asset scanning or a debug executable to approve the native release asset. Correct: build the release executable with path remapping, then scan that exact artifact. Native rendering and normal-close evidence remain a separate gate.

Native acceptance uses MARKBRIDGE_APP_DATA to isolate SQLite/preview and trusted main. Validate the absolute override before window creation. With an override, suppress automatic `main.create`, initialize services, then create only main from its original WindowConfig with an explicit builder directory. Windows without an override preserves normal automatic/default behavior. Task14 macOS/Linux also suppress automatic main without an override and explicitly isolate it under the resolved app-data root; macOS additionally requires a stable native store identifier and runtime14+ guard. The locked Tauri2.12.3/runtime2.12.1 automatic conversion drops data_directory; config mutation alone is ineffective, as task13 real OS traces proved. Do not set global WEBVIEW2_USER_DATA_FOLDER. Verify actual native main/preview stores before mutations and close all owned windows normally. Source/config/embedded strings do not establish store isolation. PowerShell5.1 uses a legacy code page; pass Unicode titles as arguments.

Regression: desktop `acceptance_data_directory_isolates_only_the_main_webview` plus SDK conversion and window-property preservation tests. The new autostart suppression assertion was run red on the original implementation and green on the explicit builder fix. Compilation or embedded `main-webview` strings do not prove isolation; retain the new binary's actual process directory receipt. Test harness probes must bind responses to the current page instance/path, so a closing preview cannot answer a later Profile's query.

## Main WebView override contract

### 1. Scope / trigger

Acceptance with an explicit app-data override must never fall back to the ordinary main WebView store. This is a startup/runtime contract, not an optional test display setting.

### 2. Signatures

`configure_data_directory(&mut tauri::Config, Option<PathBuf>) -> Result<Option<PathBuf>, &'static str>` validates the override and disables automatic main creation. Setup uses `WebviewWindowBuilder::from_config(app, original_main_config)?.data_directory(override.join("main-webview")).build()?` after managed services exist.

### 3. Contracts

`MARKBRIDGE_APP_DATA` is command-local and absolute. Only main automatic creation is disabled; original title, size, minimums and other fields are preserved. Preview owns its per-Profile store. Windows without override preserves automatic/default paths. macOS/Linux always use explicit main creation for isolation, including ordinary startup; macOS uses stable domain/role/root/Profile-separated identifiers and refuses systems below14 before constructing stores. No global WebView2 data-folder variable is permitted.

### 4. Validation / errors

| Condition | Result |
|---|---|
| Relative override or missing main config | Startup fails before creating main |
| Explicit builder/native directory fails | Startup fails; no default-directory retry |
| Actual OS user-data argument differs | Native acceptance fails before pairing/editing |
| No override | Windows preserves automatic startup; macOS/Linux explicitly isolate main under ordinary app-data root |

### 5. Good / base / bad

Good: actual WebView2 process uses the fresh fixture's `app-data/main-webview`. Base: preview retains its independent Profile directory. Bad: infer isolation from a config field or embedded binary string while the runtime uses its default store.

### 6. Required tests

Desktop tests cover relative rejection, auto-main suppression, unchanged other windows/absent override, original window-property preservation and the actual SDK conversion omission. Retain the red run on old startup code. Native receipts must capture actual main/preview directory agreement before mutations and normal closure of every owned window; historical receipt hashes cannot replace that check.

### 7. Wrong / correct

Wrong: only mutate `WindowConfig.data_directory`. Correct: prevent unsafe automatic creation and pass the directory explicitly to the runtime builder, then verify the real process.

Normal-close harnesses must verify the executable/PID and close only exact known main/preview window roles. Do not send WM_CLOSE to every `IsWindowVisible` HWND: Tao's visually empty internal event target has WS_VISIBLE and closing it breaks the event loop. Inspect other/message-only windows without posting. Task13 same-hash stage probe `current-startup-4eab32c3-...` failed after ExitRequested with broad closing; `current-startup-3ee19ba4-...` passed real exit0 after only known main was closed. These diagnostic-hash receipts do not replace final-package acceptance. Forced recovery of failed copied probes is recorded separately and never counts as normal-exit PASS.

## Preview persistent directory contract

### 1. Scope / trigger

Opening or clearing a Profile preview must preserve the intended native session and never select another Profile through an alias. Task13's same-exe short/66-character identity native pair exposed storage loss with the old full-id hex path; directory existence alone did not prove persistence.

### 2. Signatures

`session_directory(root, profile_id)` returns the validated versioned hash path. `prepare_session_directory` checks new/legacy ownership and performs closed-session migration; `rename_session_without_replace` provides Windows MoveFileW semantics. Existing `remove_session_dir_once` must refuse redirected roots, selected aliases and linked descendants. Async open/clear offload recursive filesystem work with owned arguments under the operation lock.

### 3. Contracts

The exact component is `v1-` + SHA256(`b"markbridge:preview-session:v1\0"` + Profile UTF-8), 67 lowercase characters and disjoint from legacy pure hex. Profile IDs and DTOs do not change. Before creating a Windows candidate, the known `EBWebView/Default/Local Storage/leveldb/MANIFEST-000001` leaf plus NUL must fit 260 UTF-16 units; supplementary Unicode counts twice. This addresses the measured path family, not arbitrary future Chromium filenames. An unsupported preview path must not disable unrelated main/SQLite use or retry a default store.

### 4. Validation / errors

| Case | Required outcome |
|---|---|
| Valid 66-/128-character Id | Fixed-size isolated component |
| Only owned closed legacy directory exists | Atomic rename to absent target, contents retained |
| Both namespaces exist / destination appears | StorageError; no merge/overwrite |
| Root/selected directory/descendant link or reparse | Refuse migration/clear; preserve sibling/outside/main data |
| Known Windows leaf exceeds budget | StorageError before candidate/WebView creation |
| Unix closed legacy migration | Linux renameat2(RENAME_NOREPLACE) / macOS renamex_np(RENAME_EXCL); errors/conflicts preserve content; native target execution still separately required |
| Blocking job join fails | Stable error/refusal; no invented success |

### 5. Good / base / bad

Good: reopen a fresh production-length Profile and verify its actual cookie/localStorage. Base: an unchanged short identity passes while the old 132-character directory fails. Bad: infer persistence from an OS folder match, or treat a lifetime-retaining COM observer as proof for an uninstrumented binary.

### 6. Required tests

`preview.rs` tests pin domain/hash bytes, fixed lengths/identity separation, nested legacy preservation, no-replace conflicts, long-root/UTF-16 rejection and actual owned junction counterexamples including A→B aliases inside the same root. The helper's `current-preview-path-contract.test.ps1` cross-checks Node/.NET/Rust vectors and rejects wrong Profile/legacy/arbitrary suffixes. Native probes retain red short/long comparisons and require fresh repaired executable production-length/legacy-roundtrip and installed lifecycle evidence. Source tests and native results are separate; final hashes remain mandatory.

### 7. Wrong / correct

Wrong: hex-expand arbitrary IDs, remove the canonical sibling reached by a link, overwrite an existing migration target, or block network workers on a large cache walk. Correct: bounded opaque components, exact contained link-free ownership, no-replace migration, dedicated blocking jobs and actual persistent-store verification.

## Task14 native store and navigation completion

macOS requires runtime14+ and bundle minimum14.0 before store creation. `native_store_identifier` hashes the canonical absolute app-data root, main/preview role and optional validated Profile with `markbridge:webview-store:v1\0`, length-prefixed components and a stable128-bit SHA256 prefix. Main, two Profiles and two temporary roots must differ; reopening must retain the same identifier. Never silently use WKWebKit default storage on older systems.

Linux migrates closed legacy-only storage before constructing any WebContext; both-present conflicts preserve data and fail. Never create a retained old-path context and then rename/delete beneath it. Record only the selected v1 WebContext as SendWeakRef, upgrade/use it on the UI thread and check exact data/cache directories. Closed stores lacking a recorded context use a hidden capability-free about:blank view bound only to v1. Clear native WebsiteDataManager with callback completion, without filesystem removal beneath retained Linux contexts; macOS uses completed remove_data_store. No fire-and-forget clear may produce SessionCleared. Caller timeout returns failure while the selected Profile remains blocked until the surviving native job finishes; reopening cannot race a late clear. Canonicalize temporary fixture roots on macOS before link-ancestry checks; do not relax production link guards for the system /var alias.

Native history/URI feedback is bound to window generation and navigation identity. GTK load-failed followed by Finished preserves failure; macOS keeps Wry's delegate and only actual Finished supplies success, with conservative bounded timeout for missing failure feedback. Inspect native objects only on the UI thread. Native dialogs use the trusted main parent, distinguish accepted/cancelled/failed and retain the common SaveGuard/atomic writer; the frontend receives no destination path or new permission. Cross-platform source and deterministic guard tests cannot establish native API completion/type/link/runtime, which remain NOT_RUN without target hosts.

## Native receipt process identity and SQLite inspection

Test harness shutdown observations identify a previously owned WebView by PID plus its original UTC process creation ticks as a lossless decimal string. A reused PID is a different process; do not inspect or act on its command line/executable to justify closing it. Unknown creation time/query fails closed. Require the actual main exit code 0 and owned-root/listener absence separately. Never infer the historical WebView exit code from a later reused PID. Task13 helpers `current-native-system.ps1` and `current-native-driver.mjs`, transport/negative tests and original7acc FAIL retain this distinction.

SQLite `mode=ro`/`query_only` restrict SQL mutations but do not promise unchanged WAL/SHM filesystem bytes. Inspect stopped fixtures through exclusive byte copies of the DB and every existing WAL/SHM/journal, outside app-data; verify original file facts before/after copy and reading, and preserve WAL contents. Do not use `immutable` to ignore existing WAL or silently remove auxiliary equality guards. Task13 `current-fixture-credential-cleanup.mjs` retains the first fd93 failure, separate exact auxiliary-file audit and final copied-reader ce221 cleanup receipt. No failure may be rewritten as PASS after a harness correction.

## Conditional undo of created folders

When undoing creation, check the current tree after simulating earlier inverse steps: a folder must be empty before planning its removal. External descendants produce an existence conflict, not a recursive delete. Bind the empty folder as the complete single-node `expectedSubtree` so the extension rechecks it and uses non-recursive removal at the actual effect. Keep valid create-then-move inverse ordering. Regressions: `crates/core/src/editing/tests.rs` and `apps/extension/src/executor.test.ts`.
