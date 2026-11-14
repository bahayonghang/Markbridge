# Safety, Concurrency, Live Reload, and Rollback

## 1. Hard Architectural Boundaries

1. **Zero Chrome File or Extension Access**:
   - `qiaomu-markbridge-bookmarks` never reads or modifies Chrome's `Bookmarks` JSON file and never dispatches WebSocket commands to the Chrome MV3 extension.
   - All bookmarks created by this skill live inside `profile_id = "local-skills"` (`ProfileOrigin::LocalSkills`, stored as `paired_origin = "local://skills-library"` in `profiles`), physically separated from Chrome-paired profiles (`chrome-extension://<32-char-id>`).
   - Chrome `TreeFull` and incremental sync operations only touch their authenticated Chrome `profile_id`, so `local-skills` folders and bookmarks are never overwritten or tombstoned by browser sync.
2. **Single SQLite Writer Engine (Rust `Storage`)**:
   - `markbridge.sqlite` uses `SCHEMA_VERSION = 8`, `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000ms`, FTS5 `trigram` virtual table `metadata_fts`, and semantic invalidation triggers (`008_semantic.sql`).
   - Only `crates/skill-cli` (`markbridge-skill`) may open and write `markbridge.sqlite` on behalf of skills. Raw `sqlite3` CLI or Python `sqlite3` calls are strictly forbidden.
3. **Protected Root Folder (`skills-root`)**:
   - The root folder `skills-root` (`Skills 书签`) is immutable in topology: attempting to rename, move, or delete `skills-root` returns `PROTECTED_NODE` (exit code `2`) before any transaction commits.

## 2. Daily Database vs. Isolated `--app-data`

- **Default Daily Path**:
  - Windows: `%APPDATA%\com.markbridge.desktop\markbridge.sqlite`
  - macOS: `~/Library/Application Support/com.markbridge.desktop/markbridge.sqlite`
  - Linux: `${XDG_DATA_HOME:-~/.local/share}/com.markbridge.desktop/markbridge.sqlite`
- **Write Gate (`--allow-daily-db`)**:
  - Any write command (`init`, `mkdir`, `add`, `update`, `move`, `delete`, `tag add|remove|rename|delete`, `note`, `summary`, `backup`) against a path containing `com.markbridge.desktop` fails closed with `READ_ONLY` unless `--allow-daily-db` is explicitly supplied.
  - Read-only commands (`status`, `tree`, `list`, `search`, `get`, `tag list`, `export`) never create an absent daily database file.
- **Test & Rehearsal Rule**:
  - Automated tests, self-checks, and dry-run demonstrations MUST always pass `--app-data <ABS_TEMP_DIR>` and clean up temporary directories afterward.

## 3. Live Desktop Synchronization (`BridgeConnection::Local`)

- When the Markbridge Tauri desktop app is running against the same `markbridge.sqlite`:
  - `crates/core/src/bridge/local_watch.rs` watches the database parent directory (`notify` non-recursive watcher on `markbridge.sqlite`, `markbridge.sqlite-wal`, `markbridge.sqlite-shm`) with a `120ms` debounce, plus a fallback `reload_local_space()` on window `RunEvent::Resumed`.
  - Every `markbridge-skill` mutation atomically increments `source_cursors.revision` for `local-skills`.
  - `Bridge` detects the new `revision`, reloads `local-skills` nodes from `Storage`, and publishes an updated `BridgeState` (`connection: "local"`) to the main window—no app restart required.

## 4. Backup and Rollback Procedure

1. **Pre-Delete Online Snapshot**:
   - Always pass `--backup <ABS_BACKUP_PATH>` when running `delete --recursive`, or run `backup --output <ABS_BACKUP_PATH>` before multi-step reorganizations.
   - `Storage::backup_database` uses `rusqlite::backup::Backup` to capture committed WAL frames safely even while the desktop app is open, refusing to overwrite an existing backup file.
2. **Restoring from Backup**:
   - Close Markbridge desktop cleanly so WAL/SHM handles are released.
   - Move aside the current `markbridge.sqlite` (and any `-wal` / `-shm` files) to a quarantine path.
   - Copy `<ABS_BACKUP_PATH>` to `markbridge.sqlite` and reopen Markbridge desktop, or export specific bookmarks from `<ABS_BACKUP_PATH>` by pointing `--app-data` at a temporary folder containing a copy of the backup DB and running `export --format html` + `export --format json`.
