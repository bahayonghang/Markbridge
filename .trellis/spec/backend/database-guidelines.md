# Database Guidelines

## 1. Scope and trigger

Child 02 owns SQLite identity, cache, local metadata and migrations. Source lives in `crates/core/src/storage/`. Desktop startup opens the application database through the Rust storage worker. Browser transport belongs to 03; browser operations belong to 06.

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

R04 daily move/delete groups reuse operations, snapshots and optional batch metadata in before/after JSON; no group table or migration is introduced. Stored progress distinguishes dispatched steps from never-dispatched steps. Persist the complete snapshot and HTML/sidecar backup pair before the first send, then dispatch one step per successful receipt. Claim a reviewed profile/epoch/revision/planId/planHash once; backend planning validates all selected roots, deduplicates descendants and preserves current tree order. The frontend must not loop individual apply calls to simulate a batch.

Daily deletion includes descendants in its 1000-item bound, matching the existing restore-step bound; movement retains the 1000-root bound. Before writing backups or operations, encode every outbound step and the corresponding complete inverse message against the unchanged 16MiB frame limit. A plan already known to exceed the undo step/frame limit is rejected before browser effects. These prechecks do not promise unconditional undo after external edits. Sparse sibling deletion restores each root at its recorded pre-step position; simulate restored nodes and remap their temporary IDs while checking subsequent inverse steps. Verify semantic tree, sibling order and local metadata after actual receipts, since recreated Chrome IDs differ.

Child 10 stores AI configuration in `settings` and one suggestion in `ai_jobs`. There is no new migration. `ai.credential_ref` stores the reference `ai-model-key` only. The secret stays in the OS credential service `Markbridge.Model`. `set_summary` updates `summary` and `updated_at` and preserves `note`. A job moves `running` to `ready`, `failed`, or `cancelled`. Apply claims `ready` to `applying` before any write. Cancel matches `running` or `ready` and clears `proposal`. `finish_ai_job` updates a row only while it is `running`.

Child 11 adds `crates/core/src/storage/migrations/006_organization.sql`. That migration adds `ai_jobs.operation_id`. An organization row uses `kind='organization'` and stores the job phase in `state` and the plan record in `proposal`. Single-item updates that finish, cancel, claim, release, or mark a job keep `AND kind='single'`. An organization row in `ready` is not claimed by a single-item apply.

Child 12 adds `crates/core/src/storage/migrations/007_maintenance.sql`. `metadata_fts` is an FTS5 trigram index of `summary` and `note`, with `bookmark_id` and `profile_id` unindexed. `set_metadata`, `set_summary`, note writes, tag restore, and mapped metadata copy sync that index. A query shorter than 3 characters uses a parameterized `LIKE` with an escape. A longer query uses a quoted FTS `MATCH`. Both filter the current profile and source epoch and skip deleted cache rows. `rebuild_text_index` rebuilds the index from metadata and does not delete `summary` or `note`.

R03 `Storage::query_library` backs local `cache_query` with bound parameters for folder scope, text and tags. Read profile epoch, cursor revision, total and page in one serial worker job. Results have stable Chrome path and chromeId ordering; later pages carry both expectedRevision and expectedSourceEpoch and return CONFLICT when either changed. Do not concatenate user values into SQL or filter only the first page. Title/URL search keeps case-sensitive substring behavior; optional summary/note matching and every selected tag intersect with folder scope under the current profile/epoch. Test over 10000 siblings, over 200 matches, missing/duplicate pages, version changes, combined filters and equal IDs in different profiles. No schema migration or Chrome wire command is added for this local query.

Keep the paged query narrow: recurse through folders using the existing parent index, materialize matching IDs/order keys once for both count and page, and load node JSON only for returned rows. Full-profile `SELECT *` materialization repeated for count and page exceeded the native B10K search gate. Preserve a total-count row for empty or out-of-range pages, and test mixed folder/bookmark preorder after optimization. SQL diagnostic timings are separate from the required native input-to-render measurement.

R05 local tag catalog/mutation and title-encoding preview/apply entry points accept an optional expectedSourceEpoch for older IPC compatibility. Product UI always binds this to its loaded/draft identity. Bridge compares it to the active source epoch under the operation lock before reading or mutating; a reset that reuses chromeId and revision still returns CONFLICT. No schema or Chrome-wire change is involved. Cover reset/reused-ID rejection without losing prior local drafts.

R06 captures export data before the native save dialog opens. Hold the Bridge lock while reading the tree, profile/epoch/revision/cache time and sidecar metadata; read all sidecar entries and tags in one Storage worker job. Release the lock before waiting for the dialog. HTML includes escaped source metadata; sidecar schemaVersion 2 contains metadata and live cache entries with bookmarkId, chromeId, title-encoding fields, tags, note and summary. Independent mirrors have no sidecar export. This is an export format change, not a database migration or full-library restore API.

History reads use the stored snapshot tree for deleted descendants, not only the touched-node subset in before JSON. Restored identity mappings must remain traceable after metadata restoration consumes transient after maps; reconstruct them from persisted restore requests and confirmed create receipts. Undo rejects an original operation from another source epoch even if Chrome IDs and revision are reused. Keep the original conflict/uncertain result when a user marks a record reviewed.

Pending metadata restore maps are also scoped to profile_id and source_epoch at their operations query. Never resolve an old epoch's pending map against a reused Chrome ID in the new epoch. A reset regression must retain an unconsumed old map, reuse its target Chrome ID in the new epoch, and verify that old notes/tags are not copied.
