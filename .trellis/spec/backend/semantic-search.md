# Optional local semantic search

Task 15 implements [the approved contract](../../tasks/10-10-mb-15-semantic-search/design.md). Its actual-model V18 acceptance remains NOT_RUN; deterministic transport/vector fixtures are functional evidence only.

## Ownership and boundaries

- [Protocol DTOs](../../../crates/protocol/src/semantic.rs) generate schemas, TypeScript and validators together. React calls only the validated backend adapter. The eleven `semantic_*`/`save_semantic_config` commands in [main.rs](../../../apps/desktop/src-tauri/src/main.rs) require the trusted main window; remote previews receive no capability.
- [Bridge orchestration](../../../crates/core/src/bridge/semantic.rs), [runtime](../../../crates/core/src/semantic/mod.rs) and [transport](../../../crates/core/src/semantic/transport.rs) own local model work. [Storage](../../../crates/core/src/storage/semantic.rs) is the sole writer. [Migration 008](../../../crates/core/src/storage/migrations/008_semantic.sql) follows the existing consistent backup/migration/rollback contract; schema 7 receipts are historical.
- Embedding settings are independent of chat configuration and credentials, default OFF. Startup, status reads, ordinary search and saving configuration do not request embeddings. Explicit model checks request metadata only. Never install or pull a model automatically.
- Permit only validated loopback Ollama endpoints. Disable ambient proxies and redirects; reject remote-model metadata. Use bounded `/api/tags`, `/api/show` and `/api/embed`, 5 s connect/15 s total limits, 1 MiB response bound, one input per build request and no automatic retries.

## Authorization and persistence

Scope review binds an owned paired Profile, epoch and expected revision to either explicitly selected bookmarks or an explicit folder subtree. Freeze 1–10,000 persistent bookmark identities; reject empty/oversized ranges rather than truncating. Later descendants and identities recreated by undo are not implicitly authorized.

Input recipe version 1 uses the actual Chrome title and saved summary only. Separate URL, local tag, note and preview-body fields are excluded. Text already encoded into the Chrome title remains title text; disclose this before enabling. Bound Unicode scalar count to 8,192 and UTF-8 to 32 KiB; disclose clipped entries in scope review. Full content fingerprints bind identity, recipe, title and summary independently of tree revision.

Store finite, nonzero normalized vectors as little-endian f32 BLOBs with dimension 1–4,096. Validate stored length and values again while reading. Keep model name, actual digest, dimension, endpoint, recipe, generation and frozen members in SQLite. Never send vectors or a whole vector table to React.

Build input requests are globally serial across Profiles through a cancellable permit. Explicit queries have their own bounded runtime concurrency. Network/permit waits must hold neither Bridge nor SQLite locks. On each vector commit, one Storage job checks current index/generation/running state, Profile/epoch, active identity, model/dimension and full current content fingerprint.

Pause, disable, delete and replacement first advance persistent generation, then cancel. Restart changes running to paused and requires explicit resume. A detected model/dimension change during build or query atomically marks the exact bound index/generation stale; a late detector cannot invalidate a newer replacement. Returning to an earlier model digest does not bypass explicit review/rebuild.

Title/summary changes invalidate authorized members; notes/tags/moves and unchanged full snapshots retain vectors. Full tree replacement evaluates deletions against the final tree, not temporary tombstones. Deleted identities and old epochs cannot be reused by matching chromeId or URL. Cover all summary/metadata restoration paths.

## Query and deletion

Explicit queries bind requestId/Profile/epoch/indexId/generation. Bound text to 4,096 Unicode scalars and 16 KiB, topK to 1–50. Verify actual model digest/dimension before embedding. Scan at most 10,000 current ready rows in one bounded SQLite job, decoding one vector at a time, checking cancellation and retaining topK. Cosine ties use stable bookmarkId ordering.

Only validated identity/title/score hits cross IPC. Frontend [SemanticWorkspace](../../../apps/desktop/src/features/semantic/SemanticWorkspace.tsx) and [SemanticQueryPanel](../../../apps/desktop/src/features/semantic/SemanticQueryPanel.tsx) guard Profile/epoch/source visit/revision/metadata version/index generation/request before accepting state or navigation. Cancel on source change, text change, unmount or explicit cancellation. Runtime retains at most 128 Profile/request cancellations received before registration; matching queries consume them and return CANCELLED before DB/HTTP. No silent expiry/eviction can later authorize a cancelled request. Saturation explicitly rejects new cancellation/queries while active registered requests remain cancellable; delayed matching invocations or restarting the application release the bound.

Deleting an index deletes derived members/vectors/progress/model metadata only. Preserve cache, tags, notes, summaries, FTS, preview data and chat configuration. SQLite file size need not shrink and this is not a physical-erasure guarantee. Shutdown cancels and waits for bounded semantic jobs.

## Evidence

[Core deterministic tests](../../../crates/core/src/semantic/tests.rs), [Storage race tests](../../../crates/core/src/storage/semantic/tests.rs) and [Bridge tests](../../../crates/core/src/bridge/semantic/tests.rs) cover privacy, model changes, scope, cancellation, late commits, isolation and migration. Frontend tests cover explicit requests and stale UI replies. [Evaluation tooling](../../tasks/10-10-mb-15-semantic-search/evidence/evaluation.md) separates synthetic native functionality from actual human-reviewed 20-query Recall@5 and 30-sample B10K UI-to-result p95.

Do not log model input, query text, full titles, vector contents, credentials or request headers. Diagnostics continue to export only their fixed existing projection, not semantic configuration or input.
