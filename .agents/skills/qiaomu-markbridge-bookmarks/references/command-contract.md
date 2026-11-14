# Command Contract (`mb_bookmarks.py` & `markbridge-skill`)

All operations are invoked via:

```bash
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py [GLOBAL_FLAGS] <SUBCOMMAND> [OPTIONS]
```

## 1. Global Flags

| Flag | Required | Description |
|---|---|---|
| `--app-data <ABS_DIR>` | Optional | Absolute directory containing `markbridge.sqlite`. Overrides `MARKBRIDGE_APP_DATA` and OS default app-data path. Required for all tests and isolated rehearsals. |
| `--allow-daily-db` | Required for daily writes | Permits write commands when the resolved `app_data` path contains `com.markbridge.desktop`. Omit for read-only commands. |
| `--profile <ID>` | Optional | Defaults to `local-skills`. Any other profile ID returns exit code `2` (`WRONG_PROFILE`). |
| `--self-test` | Wrapper only | Runs a 17-step isolated end-to-end test in a temporary directory and removes it on exit. |
| `--print-bin` | Wrapper only | Resolves/builds `markbridge-skill` and returns `{ "ok": true, "binaryName": "...", "exists": true }`. |

## 2. Subcommands

### Read-Only Commands (Never Create or Mutate Daily DB)

- **`status`**
  - Returns `{ "ok": true, "command": "status", "status": { "schemaVersion": 8, "initialized": bool, "profileId": "local-skills", "displayName": "Skills 书签库", "rootId": "skills-root", "sourceEpoch": 1|null, "revision": u64, "folderCount": u64, "bookmarkCount": u64, "lastSyncedAt": u64|null } }`.
- **`tree [--folder <FOLDER_ID>] [--depth <N>]`**
  - Lists folder hierarchy under `skills-root` (or `<FOLDER_ID>`).
- **`list [--folder <FOLDER_ID>] [--scope children|subtree|all] [--offset <N>] [--limit <N>]`**
  - Paginated listing of folders and bookmarks (defaults: `--folder skills-root --scope children --offset 0 --limit 100`).
- **`search [--query <TEXT>] [--folder <FOLDER_ID>] [--scope all|subtree|children] [--tags <CSV>] [--tag <NAME>] [--no-summary] [--no-note] [--offset <N>] [--limit <N>]`**
  - Intersects folder scope, title/URL substring match, normalized local tags, and FTS5 `trigram` full-text match on `summary` + `note`.
- **`get --id <NODE_ID>`**
  - Returns `{ "ok": true, "command": "get", "detail": { "node": ..., "bookmarkId": "...", "tags": [...], "note": "...", "summary": "..." } }`.
- **`tag list [--id <NODE_ID>]... [--filter <TAG_NAME_OR_ID>]`**
  - Returns local tag catalog, counts, and per-bookmark metadata entries.
- **`export --format html|json --output <ABS_FILE_PATH> [--overwrite]`**
  - Exports Netscape Bookmark HTML (`html`) or schemaVersion 2 sidecar JSON (`json`). Refuses to overwrite existing files unless `--overwrite` is passed (`CONFLICT`).

### Write Commands (Require `--allow-daily-db` on Daily DB)

- **`init`**
  - Idempotently creates `local-skills` profile (`ProfileOrigin::LocalSkills`) and protected root folder `skills-root` (`Skills 书签`).
- **`mkdir --title <TITLE> [--parent <FOLDER_ID>] [--position <INDEX>]`**
  - Creates a subfolder (defaults `--parent skills-root`, appends to end when `--position` omitted). Auto-initializes `local-skills` if needed.
- **`add --title <TITLE> --url <HTTP_OR_HTTPS_URL> [--parent <FOLDER_ID>] [--position <INDEX>] [--tags <CSV>] [--tag <NAME>] [--note <TEXT>] [--summary <TEXT>]`**
  - Validates `http://` or `https://` URL without userinfo credentials, inserts bookmark, attaches normalized tags/note/summary, updates FTS5 `metadata_fts`, and increments `revision`.
- **`update --id <NODE_ID> [--title <TITLE>] [--url <HTTP_OR_HTTPS_URL>]`**
  - Updates folder title or bookmark title/URL. Rejects `skills-root` (`PROTECTED_NODE`) and URL updates on folders (`INVALID_TREE`).
- **`move --id <NODE_ID> --parent <DEST_FOLDER_ID> [--position <INDEX>]`**
  - Moves a bookmark or folder within `local-skills`, compacting sibling positions contiguously and rejecting cycles (`INVALID_TREE`) or root moves (`PROTECTED_NODE`).
- **`delete --id <NODE_ID> [--recursive] [--backup <ABS_SQLITE_PATH>]`**
  - Soft-tombstones (`deleted_at`) the target node, cleans `semantic_index_members`, and compacts sibling positions. Non-empty folders require `--recursive` (otherwise `CONFLICT`). When `--backup` is supplied, runs an online WAL-consistent `rusqlite::backup` snapshot before mutating.
- **`tag add --id <NODE_ID> [--id <NODE_ID>...] --name <TAG>`**
- **`tag remove --id <NODE_ID> [--id <NODE_ID>...] (--name <TAG> | --tag-id <ID>)`**
- **`tag rename (--from <OLD_NAME> | --tag-id <ID>) --name <NEW_NAME>`** (merges automatically if `<NEW_NAME>` already exists)
- **`tag delete (--name <TAG> | --tag-id <ID>)`**
- **`note --id <NODE_ID> (--text <NOTE> | --clear)`**
- **`summary --id <NODE_ID> (--text <SUMMARY> | --clear)`**
- **`backup --output <ABS_SQLITE_FILE>`**
  - Writes a consistent online SQLite backup via `rusqlite::backup` without overwriting an existing file (`STORAGE_ERROR` / `CONFLICT`).

## 3. Exit Codes & Error Envelope

| Exit Code | Meaning | Typical `errorCode` Values |
|---|---|---|
| `0` | Success | `"ok": true` |
| `1` | SQLite storage, backup, or schema migration error | `STORAGE_ERROR`, `STORAGE_NEWER_SCHEMA`, `MIGRATION_FAILED` |
| `2` | Validation, boundary, or safety-policy refusal | `READ_ONLY`, `WRONG_PROFILE`, `PROTECTED_NODE`, `INVALID_MESSAGE`, `INVALID_TREE`, `CONFLICT`, `LIMIT_EXCEEDED`, `UNPAIRED`, `PATH_UNAVAILABLE` |
