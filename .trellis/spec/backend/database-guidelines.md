# Database Guidelines

## 1. Scope and trigger

Child 02 owns SQLite identity, cache, local metadata and migrations. Source lives in `crates/core/src/storage/`. The desktop startup does not open a database. Browser transport belongs to 03; browser operations belong to 06.

## 2. Signatures

`Storage::open(path).await` opens a database on a dedicated worker thread. `Storage::close(self).await` drains accepted work and waits for worker completion. Callers use async methods; callers do not receive a Connection or a raw SQL interface.

- `create_profile(Profile)` stores an application-owned identity after the caller has established the required authorization.
- `reset_source_epoch(profile_id, epoch)` accepts a strictly newer epoch and clears the old cursor. Old cache and metadata remain available.
- `replace_tree(profile_id, session_id, TreeSnapshot)` validates and atomically replaces the active cache and cursor.
- `bookmarks(profile_id, epoch)` returns cache rows, including tombstones.
- `cursor(profile_id)` returns source epoch, session, last sequence and revision.
- `set_metadata(bookmark_id, Metadata)` and `metadata(bookmark_id)` address local metadata by persistent identity.

Numbered SQL sources are `migrations/001_identity.sql` and `migrations/002_history.sql` under the storage directory. `SCHEMA_VERSION` follows the migration list. Migration 001 owns profiles, mirror sources, cache, metadata, tags and cursors. Migration 002 owns durable operation, receipt, snapshot and derived-data fields. Child 02 does not execute browser operations.

Child 07 adds `crates/core/src/storage/migrations/004_tags.sql` for `raw_title`, `last_encoded_title`, and `tag_journal`. `crates/core/src/storage/tags.rs` writes notes, tag links, merge, delete, and undo. `crates/core/src/tags/mod.rs` owns normalization and the reversible title codec. Those paths do not write Chrome.

## 3. Contracts

Use `(profile_id, source_epoch, chrome_id)` as the unique browser cache key. Keep chrome IDs as strings. A new cache entry receives an independent random bookmark_id. Refresh updates the same entry; an epoch reset creates a new entry. Duplicate URLs remain separate bookmarks. File mirror cache uses `(mirror_source_id, chrome_id)` in a separate table; association requires the later explicit workflow.

The worker holds the only application connection. The queue is bounded to 32 requests. Replies use Tokio oneshot channels. SQLite uses bundled rusqlite, WAL, foreign_keys and parameterized SQL. Do not wait for network traffic inside a transaction.

Validate a complete tree before cache replacement. Commit cache rows, tombstones, last_synced_at and source_cursors together. Preserve local metadata and bookmark_id on refresh. Never identify a bookmark by URL or display name.

Read user_version before migration or journal-mode changes. Reject a version above SCHEMA_VERSION. Upgrade an existing numbered database only after a new, non-overwriting SQLite backup succeeds. Apply pending migrations in one transaction. Reject a nonempty unversioned database. Never delete an existing database to recover from migration failure.

Use the [SQLite backup API](https://www.sqlite.org/backup.html) through [rusqlite backup](https://docs.rs/rusqlite/0.40.2/rusqlite/backup/index.html). An external copy of only the main file is insufficient evidence for a database with uncheckpointed WAL data.

Profile stores paired_origin with instance_id and the application-owned profile identity. PairedOrigin accepts only chrome-extension:// followed by 32 lowercase letters a through p. The later transport adapter must supply the actual authenticated Origin header; payload fields do not establish the Origin. Only credential references belong in profiles. Model keys stay in OS storage. Local paths and migration backup paths never enter frontend or transport DTOs. Recovery backups contain private data and must remain outside diagnostic logs and public artifacts.

## 4. Validation and error matrix

| Condition | Result |
|---|---|
| Missing profile or mismatched source epoch | WRONG_PROFILE; preserve cache and cursor |
| Non-increasing revision or regressing sequence in the same session | CONFLICT; preserve cache and cursor |
| Duplicate ID, missing parent, cycle, URL parent or duplicate sibling position | INVALID_TREE; preserve cache and cursor |
| Node-count or depth limit exceeded | LIMIT_EXCEEDED; no truncated success |
| Higher database schema version | STORAGE_NEWER_SCHEMA; no migration |
| Unknown unversioned data or failed migration SQL | MIGRATION_FAILED; retain old data |
| SQLite or backup failure | STORAGE_ERROR; do not replace the database |

Return stable codes. Do not expose raw SQL, titles, bodies or credential values in errors.

## 5. Good, base and bad cases

Good: two Profiles use chromeId 42 and receive different bookmark IDs and metadata. Base: a valid refresh preserves notes and updates the cache revision. Bad: a cyclic refresh fails and leaves both the previous tree and cursor unchanged.

Recovery: an upgrade failure rolls back schema changes. Reopen the retained old database or restore the validated pre-upgrade backup with a compatible version. Code rollback alone does not make a newer database readable by an older binary.

## 6. Required tests

Storage behavior tests must cover equal IDs across Profiles, duplicate URLs, epoch changes, metadata retention, tombstones, managed attributes and independent mirror namespaces. Inject a failure after cache writes and before commit; assert both tree and cursor remain unchanged after reopen.

Migration tests must initialize an empty database, upgrade a populated v1 fixture, verify backup contents with uncheckpointed WAL data, reject newer schemas and preserve old rows after injected migration failure. Protocol tests must reject invalid topology before storage. Real Chrome identity and authentication remain 03 evidence.

## 7. Incorrect and correct usage

Incorrect: replace cache rows, commit, then update a cursor in another transaction. Correct: validate the snapshot, write cache and cursor in one transaction, then publish the committed revision in the later adapter.

Incorrect: reuse sidecar metadata because two bookmarks have the same URL. Correct: resolve metadata only through bookmark_id under the Profile and epoch identity.

Child 10 stores AI configuration in `settings` and one suggestion in `ai_jobs`. There is no new migration. `ai.credential_ref` stores the reference `ai-model-key` only. The secret stays in the OS credential service `Markbridge.Model`. `set_summary` updates `summary` and `updated_at` and preserves `note`. A job moves `running` to `ready`, `failed`, or `cancelled`. Apply claims `ready` to `applying` before any write. Cancel matches `running` or `ready` and clears `proposal`. `finish_ai_job` updates a row only while it is `running`.

Child 11 adds `crates/core/src/storage/migrations/006_organization.sql`. That migration adds `ai_jobs.operation_id`. An organization row uses `kind='organization'` and stores the job phase in `state` and the plan record in `proposal`. Single-item updates that finish, cancel, claim, release, or mark a job keep `AND kind='single'`. An organization row in `ready` is not claimed by a single-item apply.
