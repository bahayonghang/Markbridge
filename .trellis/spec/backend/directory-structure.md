# Backend Directory Structure

## Current state

No Rust workspace exists. The reference plan sections 3–5 propose the following locations. These paths are future targets, not current source evidence.

| Proposed path | Responsibility |
|---|---|
| `apps/desktop/src-tauri/` | Tauri lifecycle, IPC, loopback listener, OS storage, fetch |
| `crates/protocol/` | Versioned wire DTOs and validation |
| `crates/core/` | Bookmark model, reconciliation, operation state machine |
| `apps/extension/` | Chrome API and events |

Domain logic must not require a GUI process. Commands validate input and delegate. Blocking storage work must not block the asynchronous network runtime. Create shared helpers only for proven repeated behavior.

The extension is the browser writer. Rust is the SQLite writer. The frontend consumes safe DTOs. Remote previews receive no application permissions. Sensitive commands verify the calling webview label.

Add exact source and test references after implementation.
