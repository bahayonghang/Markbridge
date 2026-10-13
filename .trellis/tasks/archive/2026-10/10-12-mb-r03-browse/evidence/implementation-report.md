# R03 implementation handoff

Date: 2026-10-13. Working tree includes the previously approved, uncommitted R01/R02 implementation. No commit, archive, publication, installation, normal Chrome profile change, or Chrome Bookmarks file write was performed by this implementer.

This report covers the implementation and automatic/browser checks before the independent `r03_check` review fixes. Main owns task receipts and all native harnesses. Independent review now owns the AiSuggest local sidecar invalidation callback and mirror external-deletion handling; final acceptance must use its final freeze and main's rebuilt native binary.

## Behavior delivered

- New local-only `cache_query` IPC. Rust serde owns `LibraryQuery` and `LibraryQueryPage`; schema, TypeScript and static Ajv validators are generated together. The existing Chrome wire protocol and 100000-node tree cap are unchanged.
- Query fields: `folderId`, `folderScope` (`children`, `subtree`, `all`), `query`, `tagIds`, `includeSummary`, `includeNote`, `offset`, `limit`, `expectedRevision`, `expectedSourceEpoch`. Page limit is 1–200; non-first pages require both identity/revision expectations. The response contains `items`, `sourceEpoch`, `revision`, `total`, `offset`, `nextOffset`.
- The serial SQLite worker binds all values as SQL parameters, intersects folder/text/all requested tags, and only joins metadata under the current Profile/epoch. Source order uses an ancestor position path plus Chrome ID. Notes/summary are explicit opt-in text scopes; their 3+ character queries use the existing trigram index with exact substring verification. No migration is needed.
- First-page search has no debounce delay. Pages append through “加载下一页”; Ctrl+End loads to the last page and focuses the last result. Revision/epoch conflicts restart from page one; late query/source A→B→A continuations cannot overwrite the current visit.
- File mirrors use the same reachable 200-item page behavior over their validated snapshot and expose title/URL search only. Orphan mirror bookmarks remain visible when the source has no folder root.
- Full validated cache snapshots supply one folder/path index. Folder navigation, breadcrumb navigation and double-click/Enter entering a folder share the same folder state. Deep paths horizontally scroll to their current endpoint. Folder indentation is capped visually while ARIA level and sibling position/count preserve actual depth.
- Active row and selection are distinct. Ctrl toggles; Shift selects the loaded contiguous range; Ctrl+A explicitly selects only loaded nodes, including folders. Query, directory, filter, source and epoch changes clear selection. Counts and local-operation IDs are projected from the currently loaded selection.
- Empty directories have a real “新建” entry into blank existing creation fields. `EditDesk` permits creation with a parent and no selected node. Preview and explicit confirmation still own browser-write authorization. Full independent create UX and bulk operations remain R04 scope.
- The filter panel is collapsed by default, with a visible “筛选” entry. Current scope and tags remain described in result status. Controls retain 40px targets. Virtual rows measure their container, keep the active row mounted/focused, preserve checkbox focus, and expose position/total/selection semantics.
- `TagDesk` calls `onChanged` after successful local mutation; queries that depend on tags/notes/summary reset pagination. This callback is source-visit guarded. Independent review is extending the same contract to `AiSuggest` local sidecar saves.

## Files changed by this implementation

- `crates/protocol/src/library.rs`, `lib.rs`, `bin/export-schema.rs`: local query contract and validation regression.
- `crates/core/src/storage/library.rs`, `storage/mod.rs`, `storage/tests.rs`: parameterized query, paging/identity/intersection regressions.
- `crates/core/src/bridge/mod.rs`, `apps/desktop/src-tauri/src/main.rs`: local bridge and trusted-window IPC entry.
- `scripts/protocol.mjs`, `packages/protocol/src/bridge.ts`, `library-query.test.ts`, `generated/library-query*`: generation and validated TypeScript boundaries.
- `apps/desktop/src/backend.ts`: validated request/response adapter.
- `apps/desktop/src/features/library/LibraryWorkspace.tsx`, `useLibraryQuery.ts`, `model.ts`, `VirtualRows.tsx`, `EditDesk.tsx`: navigation, pagination, selection, accessibility and empty-folder creation entry.
- `apps/desktop/src/features/tags/TagDesk.tsx`, `apps/desktop/src/styles.css`: local-query invalidation and responsive browse controls.
- `apps/desktop/src/features/library/library.test.tsx`, `features/tags/tags.test.tsx`, `tests/e2e/mock-bridge.ts`, `browse.spec.ts`, `shell.spec.ts`, `connection.spec.ts`, `foundation.spec.ts`: regression coverage and screenshot destination isolation.
- This report and R03 evidence logs/screenshots. User-owned `scripts/foundation.test.mjs` and `scripts/tauri-dev.mjs` were not edited.

## Validation

All command exit codes below are 0 unless explicitly listed under failures. Commands ran in the repository on Windows PowerShell. pnpm commands used the existing local dependency cache outside its sandbox restriction; Rust credential tests used only their built-in isolated test namespaces.

| Check | Result/evidence |
|---|---|
| `pnpm lint` | PASS, `lint-path-final.log` |
| `pnpm typecheck` | PASS, `typecheck-path-final.log` |
| `pnpm test` | PASS: 117 Vitest tests, 6 Node script tests, `test-final.log` |
| `pnpm build` | PASS, `build-final.log`; final implementation-stage assets `index-CpYzQN2n.js`, `index-_RhR3wiq.css` |
| `pnpm protocol:check` | PASS, `protocol-check.log` |
| `pnpm test:e2e` | PASS: 32 browser tests, `browser-final.log` |
| Final breadcrumb/ARIA regression | PASS: 13 browse/foundation browser tests, `browser-path-final.log`; 21 library component tests, `library-path-final.log` |
| `cargo fmt --all -- --check` | PASS, `rust-fmt.log`; formatter rerun after the additional protocol-only test |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS, `rust-clippy.log` |
| `cargo test --workspace --locked` | PASS after credential permission retry: core 93 passed/2 intentionally ignored, desktop 13 passed, protocol 12 passed, `rust-test-retest.log` |
| Additional protocol input regression | PASS: protocol 13 passed, `rust-protocol-final.log` |
| Native B10K / actual Chrome / mirror watcher | Main-owned, final results pending independent-check freeze and native rebuild; not inferred from browser/DOM timing |

The build's existing large-chunk advisory remains visible in logs. There are no source-map, dynamic-code, known-secret-pattern or absolute-machine-path artifact scan failures. Vitest's jsdom export/navigation notices are retained and are not native evidence. The two ignored Rust tests remain ignored rather than being reported as executed.

## Acceptance mapping

| AC | Implementation-stage evidence |
|---|---|
| AC-R03-1 | `browse.spec.ts` deepest Chinese folder, current breadcrumb in viewport, ARIA level21/pos1/setsize1, empty-directory blank create form; `browse-depth20-create.png`. Profile/mirror ordinary browsing and source guard regressions remain covered. |
| AC-R03-2 | Rust `library_pages_reach_10001_and_reject_revision_and_epoch_changes`: directory and search 10001 IDs, no duplicate/missing IDs, exact last ID, stale revision/epoch rejected. Browser 10001 list and search Ctrl+End focus and <100 DOM rows, `browse-10001-last.png`. Component late A→B→A continuation and conflict-restart regression. |
| AC-R03-3 | Rust `library_query_intersects_folder_text_tags_and_optional_sidecar_without_profile_leaks`: two Profiles with identical Chrome IDs, all-tag intersection, folder scope, notes/summary opt-in, short Chinese substring and SQL-looking literal. Query validation tests reject missing continuation identity, duplicates and invalid limits. Independent check extends sidecar-triggered invalidation coverage. |
| AC-R03-4 | Five-size Ctrl/Shift/Ctrl+A browser checks, folder+bookmark selection component regression, filter clear notice, source guard and checkbox focus regressions. Loaded selection count does not include unrequested results. |
| AC-R03-5 | Container resizing, focus and ARIA tests PASS. B10K native cold/warm measurements remain main-owned and unclaimed here. |

Screenshots manually viewed at 1440×900, 1100×760, 640×760, 1100×480 and 640×480: `browse-selection-{width}x{height}.png`. Visual direction remains neutral gray/white with the existing blue selected/focus tokens and Windows system font stack. The minimum-size default browse view now leaves about three rows visible; expanded filters are an explicit action. All screenshot data is synthetic test data, and production continues to consume validated IPC DTOs.

## First failures and fixes

- `baseline-pagination.log`: intended reproduction failed because old search stopped at 200 and had no next-page entry. `pagination-targeted.log` passes after implementation.
- `rust-compile.log` follows the initial `u64: FromSql` compiler error, resolved by reading SQLite count as `i64` before conversion.
- `typecheck-first.log`: removed obsolete state references after moving to one query path. Later `typecheck-final.log` caught a test-only unsupported `exact` option; `typecheck-final-retest.log` and `typecheck-path-final.log` pass.
- `ui-targeted-first.log` / `ui-targeted.log`: adapted tests for fully loaded leaf folders, duplicate display text and proper event unsubscribe mocks; `ui-targeted-retest.log` passes all 27 tests at that stage.
- `browser-shell-first.log`: old assertions expected a checked item to survive a changed query. R03 explicitly requires clearing that selection; only this assertion changed, while navigation continues preserving queries/drafts. Full shell regression now passes.
- `browser-browse-first.log`: initial 640×480 controls left less than one row. Combined path/actions and default-collapsed filters restored usable height; subsequent five-size checks pass.
- `test-first-full.log`: mirror snapshots with no folder root were accidentally empty, fixed by retaining orphan bookmark browsing. A cross-language Cargo test also timed out while the full Rust compilation ran concurrently; the complete frontend suite passed after those runs were separated.
- `rust-test.log`: two Windows Credential Manager tests failed inside the sandbox (`StorageError`). Their isolated task namespaces were inspected; elevated rerun `rust-test-retest.log` passes.
- Early inherited shell/connection/foundation screenshot paths refreshed some same-name R02 browser images. Main was notified and is recording that provenance. All four e2e files now use `MARKBRIDGE_EVIDENCE_DIR ?? 'test-results/screenshots'`; final R03 commands set the environment variable only in their child PowerShell process. Native predecessor screenshots and receipts were not overwritten by this implementer.

## Review handoff

Independent check owns further product fixes, including the success callback from AiSuggest local tag/summary saves and mirror selection/folder state after external deletion. Main must rebuild after that review freeze before final native performance/live/mirror acceptance. Real OS sleep/wake remains the explicitly deferred legacy V04 item required before R08 completion. No other R03 gate is waived.
