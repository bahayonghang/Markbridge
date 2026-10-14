# Backend Directory Structure

## Current state

Child 01 creates the Rust workspace. Child 02 adds shared wire DTOs and the storage worker. Child 03 adds the read-only bridge. The current source owners are listed below.

| Source path | Current responsibility; later ownership |
|---|---|
| `apps/desktop/src-tauri/` | Tauri lifecycle, main-window IPC guard, Bridge setup and main-only state events; later fetch |
| `crates/protocol/` | Startup, connection and versioned wire DTOs, bounds, tree checks and schema exporter |
| `crates/core/` | Startup state; SQLite worker and numbered migrations under src/storage; authenticated read-only transport/sync/OS credentials under src/bridge |
| `apps/extension/` | MV3 read-only Chrome events, pairing, recovery and popup/options |

Domain logic must not require a GUI process. Commands validate input and delegate. Blocking storage work must not block the asynchronous network runtime. Create shared helpers only for proven repeated behavior.

The extension is the browser writer. Rust is the SQLite writer. The frontend consumes safe DTOs. Remote previews receive no application permissions. Sensitive commands verify the calling webview label.

Foundation sources: `apps/desktop/src-tauri/src/main.rs`, `crates/core/src/lib.rs`, `crates/protocol/src/lib.rs`, and `crates/protocol/src/bin/export-schema.rs`. The core and protocol libraries contain Rust unit tests. The startup DTO contract is documented in [frontend type safety](../frontend/type-safety.md).

Bridge sources: crates/core/src/bridge/mod.rs owns authenticated profile state, transport.rs owns the bounded loopback WebSocket listener, sync.rs applies events, and credentials.rs owns the OS credential adapter. Tests live in bridge/tests.rs. examples/bridge_harness.rs is a separate stdio acceptance executable; no harness command belongs in the product listener.

Child 07: `crates/core/src/bridge/tags.rs` reads the tag catalog and builds a title-encoding preview. A confirmed title write reuses `commit_planned` in `crates/core/src/bridge/edit.rs`. `apps/desktop/src-tauri/src/main.rs` exposes `tag_state`, `tag_command`, `preview_title_encoding`, and `apply_title_encoding`. `examples/tag_harness.rs` is a separate stdio acceptance executable for that path; it is not a product listener, and a local tag command from it does not write Chrome titles.

Child 09: `apps/desktop/src-tauri/src/preview.rs` owns one `preview-active` WebviewWindow and per-Profile sessions under `{app data}/preview-sessions`. Task13 fixes full-id hex expansion: components are `v1-` plus full lowercase SHA256 of `b"markbridge:preview-session:v1\0"` followed by validated Profile UTF-8. Windows checks the known persistent-store UTF-16 budget and migrates only a closed, contained, link-free legacy directory to an absent target with MoveFileW. Task14 adds Linux renameat2(RENAME_NOREPLACE) and macOS renamex_np(RENAME_EXCL); conflicts preserve both. Recursive filesystem work runs on blocking workers. Task14 also owns native store identifiers, retained Linux contexts, completed selected-store clearing and native navigation/history observers in this module; cfg source presence is not target acceptance. `capabilities/main.json` lists only `main` and no remote permission. `WebPreviewState` remains the main-window DTO. See [quality contracts](quality-guidelines.md) for actual evidence boundaries.

Child14 credentials remain in `crates/core/src/bridge/credentials.rs`, with target-scoped keyring3.6.1 features. Windows target identity is preserved; Keychain/Secret Service use service/account and fail closed. `main.rs` owns runtime macOS14 guard, explicit non-Windows main creation and validated native HTTP handoff. `export.rs` owns trusted-parent native selectors and the common guarded atomic writer. Frontend settings only display fixed recovery guidance, without credential/store/path permissions. `scripts/native-build.mjs` and `native-package.mjs` own actual-host program build/scan/package verification; platform CI is separate from V17 desktop evidence.

Child15: `crates/core/src/semantic/` owns bounded local embedding transport/input/cancellation; `bridge/semantic.rs` owns jobs and trusted scopes; `storage/semantic.rs` and migration008 own all derived persistence/ranking. `crates/protocol/src/semantic.rs` owns generated DTOs. `examples/semantic_fixture_seed.rs` accepts a fresh canonical temporary app-data root and writes only through Storage, never credentials/model/Chrome. UI and evaluation callers consume typed hits rather than vectors. See [semantic contracts](semantic-search.md).
