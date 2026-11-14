---
name: qiaomu-markbridge-bookmarks
description: >-
  Operate Markbridge (签桥) isolated local Skills bookmark library (`local-skills` / `Skills 书签`)
  in SQLite (`markbridge.sqlite`) through `scripts/mb_bookmarks.py` and the Rust `markbridge-skill` CLI.
  Use when the user asks to save/add a URL or article to Markbridge bookmarks, create or organize local
  bookmark folders, list or search saved bookmarks (including FTS5 trigram notes/summaries), manage
  local tags/notes/summaries, or backup/export the local Skills bookmark library (存书签、收藏链接到签桥、
  管理本地书签专夹、新建书签目录、搜索收藏、给书签打标签/记笔记/写摘要、备份导出本地书签数据库).
  Do NOT use for editing Chrome's `Bookmarks` file directly, pairing or debugging the Chrome MV3
  extension, mutating Chrome-synced profiles via `chrome.bookmarks`, Firefox/Safari bookmarks, or app packaging.
---

# Qiaomu Markbridge Bookmarks (`qiaomu-markbridge-bookmarks`)

Deterministic project skill for operating Markbridge's isolated local bookmark source (`profileId = "local-skills"`, display name `Skills 书签库`, protected root folder `skills-root` / `Skills 书签`) directly in `markbridge.sqlite` via the Rust storage engine—with zero Chrome dependency and automatic live refresh in any open Markbridge desktop window.

## Router Rules

- **Route IN** when the user wants to collect/save URLs (`http://` or `https://`), create nested folders, move/update/delete items, tag bookmarks, attach notes or summaries, search saved bookmarks, or backup/export the local `Skills 书签库` inside Markbridge.
- **Route OUT** when the user asks to read/write Chrome's raw `Bookmarks` file, pair or troubleshoot the Chrome MV3 extension (`chrome.bookmarks` / WebSocket), modify bookmarks inside a Chrome-synced profile, or build/install NSIS packages.
- **Rust-only SQLite writer**: Always invoke `python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py ...`. **Never** open or mutate `markbridge.sqlite` with `sqlite3` CLI or Python's `sqlite3` module (bypasses `rusqlite` bundled FTS5 `trigram` tokenizer, semantic invalidation triggers, and DTO invariants).
- **Daily DB write gate**: Reads (`status`, `tree`, `list`, `search`, `get`, `tag list`, `export`) work on the daily database by default. Writes to the daily `%APPDATA%\com.markbridge.desktop\markbridge.sqlite` require explicit `--allow-daily-db` **only when the user actually asked to modify their Markbridge bookmark library**; automated tests, demos, and rehearsals MUST pass `--app-data <ABS_TEMP_DIR>`.
- **Destructive folder deletes**: Deleting a non-empty folder requires `--recursive` AND an online SQLite snapshot `--backup <ABS_BACKUP_FILE>` before execution.

## Compact Workflow

1. **Inspect status first**: Run `python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py status` (with `--app-data <ABS_DIR>` for isolated runs) to check `exists`, `schemaVersion`, `revision`, `folderCount`, and `bookmarkCount`.
2. **Initialize lazily when needed**: If `exists` is `false` and the user wants to create folders or save bookmarks in `Skills 书签库`, run `init` (with `--allow-daily-db` for the real app DB, or `--app-data <ABS_DIR>` for isolated DBs) or proceed directly to `mkdir` / `add` (both auto-provision `local-skills` + `skills-root` idempotently).
3. **Resolve target folder**: Use `tree` or `list` to check existing folders under `skills-root` (`Skills 书签`) before creating duplicate folders; create missing sub-folders via `mkdir --title "<NAME>" [--parent <FOLDER_ID>]`.
4. **Execute atomic CRUD / sidecar action**:
   - Save bookmark + sidecars in one call: `add --title "<TITLE>" --url "<HTTPS_URL>" [--parent <FOLDER_ID>] [--tags "tag1,tag2"] [--note "<NOTE>"] [--summary "<SUMMARY>"]`
   - Search bookmarks (title, URL, tags, and FTS5 trigram note/summary): `search --query "<KEYWORD>" [--tags "tag1"] [--folder <FOLDER_ID>]`
   - Update metadata: `update`, `move`, `tag add|remove|rename|delete`, `note`, `summary`
5. **Backup before destructive changes**: Before `delete --recursive` or bulk reorganization, pass `--backup <ABS_SQLITE_BACKUP_PATH>` (uses `rusqlite::backup` online WAL-safe snapshot) or run `backup --output <ABS_PATH>`.
6. **Report structured receipt**: Parse the single-line/pretty JSON stdout (`ok`, `revision`, `result`) and report affected node IDs, folder path, tags, and new `revision` (which any running Markbridge desktop window picks up automatically within ~120ms).

## Quick Command Reference

```bash
# 1. Check isolated or daily status (read-only, never mutates DB)
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py status

# 2. Isolated self-test (uses temporary directory, never touches daily DB)
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --self-test

# 3. Create a folder and save a bookmark in the user's daily Skills library
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --allow-daily-db mkdir --title "Rust 异步"
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --allow-daily-db add \
  --parent "<FOLDER_ID>" \
  --title "Tokio Tutorial" \
  --url "https://tokio.rs/tokio/tutorial" \
  --tags "rust,async" \
  --note "官方异步运行时入门教程"

# 4. Full-text + tag search across local-skills
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py search --query "异步运行时" --tags "rust"

# 5. Online backup & recursive folder delete
python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --allow-daily-db delete \
  --id "<FOLDER_ID>" --recursive --backup "D:/Backups/markbridge-pre-delete.sqlite"
```

For full subcommand flags, JSON response schemas, and exit codes, read [command-contract.md](references/command-contract.md).
For isolation guarantees, WAL concurrency, desktop live-reload behavior, and rollback steps, read [safety-and-rollback.md](references/safety-and-rollback.md).

## Gate Ladder

1. **Boundary & Redaction Gate**: Reject non-`http(s)` URLs, URLs with embedded credentials (`user:pass@host`), mutations targeting non-`local-skills` profiles (`WRONG_PROFILE`), and mutations targeting protected root `skills-root` (`PROTECTED_NODE`). Never print raw filesystem paths in error envelopes.
2. **Daily Database Protection Gate**: Any write command targeting a path containing `com.markbridge.desktop` without `--allow-daily-db` exits with code `2` and `errorCode: "READ_ONLY"`.
3. **Deterministic Execution Gate**: `python .agents/skills/qiaomu-markbridge-bookmarks/scripts/mb_bookmarks.py --self-test` and `python -m unittest discover -s .agents/skills/qiaomu-markbridge-bookmarks/tests -p "test_*.py"` must pass 100% in disposable temp directories.
4. **Governance & Package Gate**: Pass `validate_skill.py` (zero warnings), `trigger_eval.py` (100% pass), `export_skill_ir.py`, and `release_check.py --phase local --run-tests`.

## Output Contract

- **CLI / Script Stdout**: Always valid UTF-8 JSON with `"ok": true` (plus command payload & `revision`) on exit code `0`, or `{"ok": false, "errorCode": "<SCREAMING_SNAKE_CASE>", "message": "<redacted summary>"}` on exit code `1` (storage/migration failure) or `2` (validation/policy refusal).
- **Agent Reply to User**: Concisely report the action taken in `Skills 书签库` (`local-skills`), created/updated node title & `chromeId`, folder location, applied tags/note/summary, and current `revision` (noting that if Markbridge desktop is open, switching the top-left source selector to `Skills 书签库（本地库）` shows the update immediately; if first-time enabled from empty state, click `设置 -> 连接 -> 启用本地 Skills 书签库` or reopen).

---

Copyright (c) 向阳乔木
- X: https://x.com/vista8
- GitHub: https://github.com/joeseesun/
