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

Child 09: `apps/desktop/src-tauri/src/preview.rs` owns one `preview-active` WebviewWindow and the per-profile session directory under `{app data}/preview-sessions`. The directory name is the hex encoding of the profile id. `capabilities/main.json` lists only the `main` window and has no remote permission. Navigation, popups, and downloads are decided in that module. `WebPreviewState` is the main-window DTO.
