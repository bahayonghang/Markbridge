# Backend Directory Structure

## Current state

Child 01 creates the Rust workspace. Child 02 adds shared wire DTOs and the storage worker. The current source owners are listed below.

| Source path | Current responsibility; later ownership |
|---|---|
| `crates/protocol/` | Startup, connection and versioned wire DTOs, bounds, tree checks and schema exporter |

Domain logic must not require a GUI process. Commands validate input and delegate. Blocking storage work must not block the asynchronous network runtime. Create shared helpers only for proven repeated behavior.

The extension is the browser writer. Rust is the SQLite writer. The frontend consumes safe DTOs. Remote previews receive no application permissions. Sensitive commands verify the calling webview label.
