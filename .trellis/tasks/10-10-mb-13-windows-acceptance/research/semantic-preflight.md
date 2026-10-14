# Research: task 15 semantic integration preflight

- Query: Map the smallest implementation of the approved local embedding + SQLite vectors + bounded Rust exact cosine design, including authorization, cancellation/resume, invalidation, identity/model partitioning, UI boundaries, and deterministic evidence.
- Scope: mixed; current repository and installed dependency sources, with official Ollama API verification.
- Date: 2026-10-13
- Research home / active implementation: task 13. This file does not start task 15 or change any task status. Product implementation of 15 still waits for 12/13 acceptance.

## Findings

### Approved contract and evidence boundary

Task 15 PRD AC15-1/2/4 requires zero embedding requests by default, prior disclosure of model/scope/space, visible pause/resume/delete, invalidation on bookmark deletion and summary update, model/dimension isolation, and ordinary search/metadata survival. AC15-3 and parent V18 require an actual fixed local model, 20 manually labelled queries with Recall@5 >= 0.8, and B10K warm p95 <= 1 second. The user has explicitly said there is no current model and authorized implementation plus deterministic checks. These real-model gates remain NOT_RUN; a mock cannot complete task 15.

Task 15 design approves SQLite persistence and bounded Rust exact cosine for 10,000 items, without a vector service, ANN, or SQLite vector extension. Parent design:139 and PRD:32 agree. Task 15 depends on 12 and 13, independently of task 14.

### Files found and implementation ownership

| Existing / proposed file | Responsibility and integration pointer |
| --- | --- |
| `crates/core/src/storage/mod.rs` | Only SQLite worker; numbered migrations at :23, 32-job queue at :100, short shared handles at :140, generic worker call at :148. Add migration 008 and `mod semantic`; keep the connection private. |
| `crates/core/src/storage/migrations/008_semantic.sql` (new) | Persist independent semantic enable/config, index identity/generation/status, frozen authorized membership, per-item fingerprint/state, and vector BLOBs. Current schema is 7. |
| `crates/core/src/storage/semantic.rs` (new) | Bounded scope resolution, atomic job/status transitions, input reads, conditional vector commit, invalidation, streaming candidate scan, and derived-index deletion. |
| `crates/core/src/semantic/` (new, small module) | Local endpoint/metadata/embed adapter and pure input/vector/cosine validation. Keep domain work independent of Tauri. No new service or vector dependency is needed. |
| `crates/core/src/bridge/semantic.rs` (new) | Main-facing settings/start/pause/resume/delete/status/query APIs; bind profile, epoch, expected revision, request and index generation. Network waits outside Bridge and SQLite locks. |
| `crates/core/src/bridge/mod.rs` | Existing model transport and AI gate fields at :37-39; `open_with_model_store` at :131; test injection via `open_with_ai` at :140; shutdown cancellation at :410. Add semantic cancellation/worker lifecycle here. |
| `crates/core/src/ai/endpoint.rs` | Reusable model-name rules at :142. Existing chat normalizer at :13 stores `/api/chat`, and permits remote HTTPS; it is not a local-only embedding validator. |
| `crates/core/src/ai/transport.rs` | Existing bounded cancellable HTTP transport and scripted test fixture. `CancelFlag` at :17 uses durable watch cancellation; transport body cap at :14 is 64 KiB, timeout 15 seconds and connect timeout 5 seconds. |
| `crates/core/src/storage/ai.rs` | Provider settings at :46 and :64; current target identity lookup at :100 joins current profile epoch; saved-summary write at :237. Reuse provider path where useful, preserving independent embedding model/switch. |
| `crates/core/src/storage/mod.rs` / `ai.rs` / `operations.rs` | Actual content mutation paths: `set_metadata` at mod.rs:263, `set_summary` at ai.rs:237, mapped sidecar restore at operations.rs:313. Invalidation cannot live only in AI apply. |
| `crates/core/src/storage/library.rs` | Existing paged lexical query at :11, identity/conflict guards at :18-28. Keep this path independent. Do not fetch all ordinary query pages to perform vector ranking in React. |
| `crates/core/src/storage/maintenance.rs` | Metadata FTS sync at :5. `maintenance_members` at :52 reads a full profile and tags per item; do not reuse it as semantic scope loading. |
| `crates/protocol/src/semantic.rs` (new), `lib.rs`, `bin/export-schema.rs` | Rust DTO source for settings/index/query/status; schema exporter extends existing local IPC DTO generation. No extension wire message is needed. |
| `scripts/protocol.mjs`, `packages/protocol/src/semantic.ts`, `index.ts`, generated files | Add generated schemas/types/standalone Ajv parsers, then `pnpm protocol:generate` and `pnpm protocol:check`. No casting unknown IPC in components. |
| `apps/desktop/src-tauri/src/main.rs` | Thin commands patterned after `ai_settings` at :601 and `save_ai_config` at :610; every command calls `trusted(&window)` before Bridge. Register new handlers near :1049. |
| `apps/desktop/src/backend.ts` | Validated IPC wrappers, patterned after `aiSettings` at :251 and `saveAiConfig` at :256. Browser fallback must indicate unavailable/default-off, without real endpoint calls. |
| `apps/desktop/src/features/library/LibraryWorkspace.tsx` | Source/profile context, selected bookmark scope and existing search controls. Query identity at :311-327, lexical search input at :593, selected-items toolbar at :634. Mount a compact semantic feature with explicit action and current source/epoch. |
| `apps/desktop/src/features/library/useLibraryQuery.ts` | Existing stale-generation/busy guards at :11-35 and :40-64. Copy this proven behavior for semantic query/status; keep lexical results and offset paging intact. |
| `apps/desktop/src/App.tsx`, `features/ai/AiSettings.tsx` | AI settings host at App.tsx:92, settings read-only mount at AiSettings.tsx:25. A semantic settings component can reuse the same visual patterns; do not toggle or rewrite chat config when disabling embedding. |
| `tests/e2e/mock-bridge.ts` | Browser API replacement, especially :66-70 and :96 onward. Add semantic defaults to every scenario and a stateful semantic scenario; this is browser UI evidence only. |
| `crates/core/src/ai/tests.rs`, `storage/tests.rs` | Existing zero-request test at ai/tests.rs:292; cancellation transport patterns near :72; migration/backup/epoch/restore tests in storage/tests.rs. Add focused semantic tests rather than copying implementation assertions. |

### Installed dependency APIs verified first

No new library is required: core already depends on reqwest 0.13.5, bundled/backup rusqlite 0.40.2, sha2 0.10 and Tokio (lockfile 1.53.2).

- Installed reqwest `src/async_impl/client.rs`: `redirect` :1392, `no_proxy` :1436, `timeout` :1450, `connect_timeout` :1475, `resolve` :2308. A local adapter can explicitly bypass environment proxies, disable redirects, and bind localhost to a literal loopback. Existing chat transport lacks `no_proxy`, so sharing it without adjustment does not by itself prove the stronger local-only embedding boundary.
- Installed rusqlite `src/types/value.rs`: `Blob(Vec<u8>)` :19 and `From<Vec<u8>>` :107. Store little-endian f32 BLOBs with explicit dimension and recipe/version; validate exact byte length on read. JSON vector storage is unnecessary.
- Installed Tokio 1.53.2 `src/sync/watch.rs`: `changed` :818, `send_replace` :1229, `subscribe` :1387. Existing `CancelFlag` already uses `send_replace`, preserving cancellation before receivers subscribe. Reuse it.

### Smallest safe persisted model and scope design

The following is an implementation proposal, not an already approved detailed schema. Main must fill these gaps in task 15 design/implement before implementation; no new task or stack choice is needed.

1. Use separate `semantic.enabled`, endpoint and embedding-model settings. Initial settings reads, renders, remounts, disabled saves, and startup do no model I/O. Chat AI enable/model changes do not implicitly enable embeddings. Prefill from the existing Ollama path only when it validates as local, without rewriting chat settings.
2. One current index per Profile/epoch is sufficient. Persist index ID, profile ID, source epoch, endpoint identity, requested/resolved model name, model digest (version), vector dimension, input recipe version, generation, phase, and progress/error. Keep membership in an indexed child table keyed by `(index_id, bookmark_id)`; persist its Chrome ID for navigation. A fresh model/config rebuild may replace only derived rows. Concurrent old generations cannot commit into the replacement.
3. Start requires an explicit nonempty scope and disclosed item count/estimated storage. Accept selected IDs and/or an explicitly selected folder subtree resolved in Rust against expected profile/epoch/revision. Reject missing IDs, folders without an explicit subtree choice, stale identities and over-limit scopes before content/model requests. Resolve once and freeze persistent bookmark IDs. Newly added descendants never silently join an approved folder scope. B10K can use an explicitly authorized root subtree, without shipping a whole library to React.
4. Only cached bookmark title and saved local `bookmark_metadata.summary` are input. Exclude URLs, notes, tags, preview-cache text, credentials and live page fetch. Recipe: canonical labelled title + summary; persist recipe version and disclose bounded clipping if chosen. This does not authorize page fetching or discover all metadata outside scope.
5. Fingerprint serialized fields with SHA-256, using an unambiguous format, including profile ID, source epoch, bookmark ID, input recipe version, title and summary. Store the expected fingerprint beside each candidate. Compute from actual stored source text; never from UI title or URL identity. Separate model/index identity handles endpoint/digest/dimension. Revision guards detect staleness but tree revision is not a text fingerprint: a move should not force every vector to rebuild.

### Cancellation, resume and late-response safety

- Register the job/request uniquely before expensive preparation, following `Gate::begin_unique` and pointer-checked `finish` (ai/service.rs:68-84). A second start/resume for a currently owned index returns CONFLICT, without replacing its cancellation owner.
- Persist frozen scope and item `pending/ready` state before the first embed. Ready items survive pause. Resume reloads pending/stale entries and recomputes their current fingerprint; it does not reconstruct scope from the current selection.
- Pause/disable/delete/config replacement first advances persisted index generation/phase under the SQLite worker, then cancels the active flag. Committing a returned vector atomically requires matching index/generation/phase, current profile/epoch, live bookmark identity, model/dimension, and unchanged content fingerprint. Cancellation at any boundary produces no late ready row or recreated deleted index.
- An in-flight input can change while HTTP is running. Re-read/recompute fingerprint at commit. Mark it pending or return stale; do not keep old text vectors or skip new text because an offset cursor advanced. A per-item pending scan avoids the missed-earlier-item problem of an increasing ordinal cursor.
- On reopening the application, normalize persisted running jobs to paused, preserve completed vectors and pending scope, and require explicit resume. Startup never downloads a model or retries failed jobs automatically.
- Shutdown cancels semantic work before closing storage, matching Bridge::shutdown :410-432. Do not retain an `Inner` lock across model I/O. Shared storage handles must be released promptly, so a paused/unreachable request cannot keep `Storage::close` waiting indefinitely.
- Query IDs and UI generations include source ID/visit, epoch, index identity/generation, text and request ID. Cancel underlying query embedding on source/text replacement or disposal; old responses and old `finally` blocks cannot clear newer results/busy state. Explicit query submit is the simplest no-effect-request boundary.

### Invalidation must cover final state and all metadata writers

**Important reconnect trap:** full `replace_tree` marks all existing cache rows deleted before upserting retained nodes (storage/mod.rs:393,396). An `AFTER UPDATE deleted_at` trigger deleting vectors would remove every vector on every full snapshot. Determine truly deleted identities at the end of the snapshot transaction, after retained rows are reactivated, then remove/mark their derived rows. Query joins always require current profile epoch and `deleted_at IS NULL`, so stale rows are never eligible even before cleanup.

- At the end of tree replacement, invalidate only authorized rows whose final title/identity changed; movement/order/revision-only changes preserve vectors. Truly deleted rows clear vectors and cease to be candidates. Reset epoch (mod.rs:193) makes old indexes unavailable immediately; a new epoch does not reuse old Chrome IDs or sidecar vectors.
- Cover `set_metadata` (mod.rs:263), `set_summary` (storage/ai.rs:237), and mapped metadata restore (operations.rs:313). A narrowly scoped summary-change SQL trigger can cover these writers without refactoring all callers; compare summary values, not `updated_at`, because note/tag-only changes should preserve a title+summary vector. If using explicit helpers instead, include every one of these paths and test restores.
- Deleted-bookmark undo creates a new Chrome ID and local bookmark ID; existing restore copies metadata and tags (operations.rs:306-320). Do not copy vectors or extend semantic scope just because URL/title match. The new identity requires fresh explicit inclusion. Equal Chrome IDs in other Profiles/epochs remain isolated.
- Invalidation marks authorized existing members pending and clears unusable vectors. It must never fetch pages or add unauthorised items. When paused/disabled, expose pending work and wait for resume. While a explicitly started build is running, only its frozen members may be recomputed.
- Delete index removes vector, scope, progress and index-specific model metadata, and stops its active work. Preserve bookmarks, tag tables, note/summary metadata, preview cache, ordinary FTS, chat jobs and chat credential/configuration. SQLite free pages need not shrink the DB file immediately; do not promise forensic erasure or run unsafe shared-DB VACUUM as part of deletion.

### Proposed fixed bounds and exact retrieval

These values are proposed defaults for the missing detailed design, not measured guarantees:

| Resource | Proposed bound |
| --- | --- |
| Explicit authorized index | 1–10,000 eligible bookmarks per Profile/epoch; reject over-limit, never silently truncate scope |
| In-flight build | One serial embed request; one input string per request; no automatic retry/model download |
| Source text | <= 8,192 Unicode scalars and <= 32 KiB UTF-8 using a disclosed, versioned recipe; fingerprint full relevant fields for update detection |
| Query | 1–4,096 Unicode scalars, <= 16 KiB UTF-8; explicit submit |
| Vector | 1–4,096 finite nonzero values, constant dimension for the index; normalize defensively and store f32 |
| HTTP | Redirects off, proxies off, loopback literal/pinned localhost only, 5 s connect / 15 s total; <= 1 MiB response and bounded metadata model list |
| Retrieval | At most 10,000 ready current authorized rows, top K <= 50 (V18 K=5), no whole-vector IPC response |

The vector payload estimate is `count * dimension * 4` bytes: 10k × 768 is about 29.3 MiB, 10k × 4096 about 156.3 MiB, excluding SQLite/index overhead and the separately installed model. Show estimate before approval and actual stored bytes/count in status. The model disk space is not index space and the app must not install it.

For smallest implementation, scan SQLite candidate rows in one bounded storage-worker job after query embedding. Decode one BLOB at a time, evaluate Rust cosine and retain only top K; avoid materializing all vectors in Bridge/React or a separate vector cache/service. Check cancellation between rows and validate length/finiteness/nonzero norm even for database rows. Return only hit identity/title/score and necessary navigation DTO data. Read/current-filter/generation validation and ranking in one worker job prevent interleaving with writes; do not hold the Bridge lock while the model embeds the query. If later profiling requires chunks, bind a content revision across the complete scan and reject changed scans; do not silently combine inconsistent pages.

### Official Ollama contract (checked 2026-10-13)

- [Generate embeddings](https://docs.ollama.com/api/embed): POST `/api/embed`, `model` plus text or text-array `input`; `truncate` defaults true (set false for transparent failures), optional `dimensions`; response `model` and `embeddings` array, with timing metadata. This differs from old `/api/embeddings` with singular `embedding`. Use modern contract and reject wrong response cardinality/dimension; metadata fields need not become IPC fields.
- [Embedding guidance](https://docs.ollama.com/capabilities/embeddings): output is L2-normalized, and indexing/querying should use the same model. Defensive normalization and validation remain necessary at our untrusted boundary.
- [List models](https://docs.ollama.com/api/tags): local metadata includes model names and digest. The name alone is insufficient version identity. Resolve a model/tag unambiguously and persist its digest; require metadata success before indexing/querying and recheck at job start/resume/query. Never call pull/install.
- [Show model details](https://docs.ollama.com/api-reference/show-model-details): POST `/api/show`; advertised capabilities and model metadata can detect non-embedding models. [Official API types](https://github.com/ollama/ollama/blob/main/api/types.go) expose `remote_model`/`remote_host` in model-list and show responses, and modern embed responses use `[][]float32`. Reject advertised remote-backed models before sending bookmark text. The `main` source is not an installed-version claim; installed daemon behavior must be tested later.
- Local-only policy: literal 127.0.0.1 / ::1, or explicitly pinned localhost; no LAN/private/remote endpoint, userinfo, query, fragment, arbitrary path, proxy, redirect, or bearer inherited from chat. Shared chat endpoint validation permits remote HTTPS and therefore needs a stricter embedding-specific normalizer. A local daemon is a user-configured trust boundary; metadata checks cannot prove what an arbitrary malicious proxy daemon does internally.

### Meaningful verification plan

1. **Protocol/boundary tests:** reject unknown IPC fields, missing profile/epoch/request identity, over-limit scopes/query/K/dimensions, wrong schema version, and malformed success status. Regenerate and verify drift; every semantic command must be main-only.
2. **Default/privacy tests:** startup/settings reads, disabled saves, hidden panels and remounts produce zero transport calls; disabled/missing local model/empty scope returns clear unavailable with zero embed calls. Validate remote/LAN/cloud-backed model rejection, proxy bypass and redirect refusal. Captured fake requests contain only authorized title/summary and no URL/note/key. Logs/errors contain no inputs/endpoint/body/raw transport details.
3. **Lifecycle/race tests:** hold a response, pause/disable/delete/configure another model, release it and assert no vector commit/index resurrection. Pause before transport receiver subscription. Duplicate resume request cannot displace active cancellation. Close/reopen resumes only from explicit action and preserves ready members. A→B→A UI results/busy state are discarded using visit generation.
4. **Storage/identity tests:** populated v7 upgrade makes non-overwriting validated backup and preserves metadata/FTS; reject newer schema, injected migration failure preserves old DB. Same Chrome ID across Profiles/epochs never shares vectors. Title/summary changes invalidate; note/tag/move-only changes do not. Full unchanged snapshot preserves vectors. Deletion removes eligibility; late embed of deleted/changed item fails conditional commit; restore/new ID does not inherit scope/vector.
5. **Exact ranking tests:** known orthogonal/collinear/opposite vectors give expected order/scores; ties use stable bookmark identity, malformed BLOB/NaN/zero/wrong dimension fail safely, 10k synthetic vectors exercise the bound without asserting real-model quality. Index model digest or dimension change refuses mixing/rebuilds only derived data. Delete/disable still returns lexical matches, tags, notes and saved summaries.
6. **Browser tests/screenshots:** stateful semantic mock and genuine current UI interactions at 1440×900 and 640×480; accessible scope disclosure, start/pause/resume/delete, missing-model message, stale status/query, and intact ordinary search. Use the requested ui/frontend-design workflow and blue simple styling. These tests do not prove Rust transport or native IPC.
7. **Optional isolated Windows native mock acceptance:** temporary application directory/credential namespace and a loopback mock implementing tags/show/embed exercise actual Tauri→Bridge→HTTP→SQLite→UI and lifecycle. Label it mock transport/native integration, never actual-model Recall/p95. No daily Chrome data or model installation is required.
8. **Later V18 real evaluation:** fixed bilingual 20-query labels and relevance fixture, actual recorded model digest/dimension/version, B10K authorized scope, raw 30-or-more warm query durations including embedding+ranking+render path, p95 and Recall@5 (define aggregation before execution). Agent/developer-authored fixture labels are candidate relevance judgments, not actual independent human annotation; label them accordingly until a human reviews them. Preserve below-threshold results. Until a real model and the required reviewed labels exist, native actual-model quality/performance stays NOT_RUN.

### Related specs

- `.trellis/spec/project-baseline.md`: independent local model vs public fetch; no unsupported claims; Rust-only SQLite and validated DTOs.
- `.trellis/spec/backend/database-guidelines.md`: migration backups/rollback, serial worker/32 queue, no network in transactions, bookmark identity isolation, FTS and mapped metadata restore.
- `.trellis/spec/backend/directory-structure.md`, `error-handling.md`, `logging-guidelines.md`: GUI-independent domain work, main-only commands, durable cancellation, stable safe errors and no content logs.
- `.trellis/spec/frontend/hook-guidelines.md`, `state-management.md`, `type-safety.md`: source/epoch/request-generation guards, explicit actions, single backend owner, no credentials/model access in React, generated Ajv validation.

## Caveats / Not Found

- No embedding implementation, semantic DTO, vector migration, fixed relevance labels or runnable actual-model V18 evidence currently exists in the inspected sources. This preflight adds only this research file.
- Task 15's approved broad architecture is clear, but detailed persisted schema, scope selection/count review, recipe bounds, digest refresh policy, dimension negotiation, pause-after-restart behavior, and query presentation still need to be recorded in its design/implement by the main session before product work. These are implementation refinements within the approved stack; they do not justify duplicate tasks.
- `/api/embed` does not return a stable model digest. Tags/show metadata is needed; metadata/embed cannot make model mutation by an external daemon completely atomic. Recheck digest at commit/end of job to discard mixed generations, and report the remaining external-daemon mutation boundary. Do not silently substitute a caller-entered version string.
- Show/version documentation URLs differ from the runtime route; initial `/api/show` documentation URL returned 404. Canonical show documentation is `/api-reference/show-model-details`. Installed Ollama version is unknown; official current docs/GitHub are API research, not a local run.
- No model endpoint was called, no model was downloaded, no database/product code was edited, no tests were executed, and no platform/quality/performance PASS is implied by this file.
