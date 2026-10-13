# R06 implementation report

## Boundary before implementation

Reuse the approved blue, plain-CSS workspace. A quiet chronological list exposes operation type, time, count and truthful receipt state; expanded detail contains values and conditional undo. Existing Segoe UI and 7px controls remain. No page-entry animation or card grid.

Current gaps: EditDesk mixes editing/history/export, shows internal operation IDs and states, and treats a Blob click as export completion. It has no native save receipt, mirror export or complete operation detail. Undo preview truncates differences at 50 and lacks explicit source-epoch binding.

Ownership: R06 product and automated/browser tests in desktop features/backend/native, core bridge/storage operations, protocol source and generated artifacts. Native harnesses, final receipts, task metadata and spec consolidation belong to main. Preserve R01–R05 edits and protected scripts.

Implement HistoryWorkspace and ExportDesk using existing operations, receipts, batch view, plan/apply/undo. Add Rust-owned save selection and atomic writing, source-bound export metadata, full history/undo DTOs and narrow trusted-main IPC. No generic filesystem permission, new execution engine, migration, full-library restore, installation, daily Chrome changes or publication.

Validation: focused state/late-response/cancel/failure/epoch/conditional-undo regressions, full frontend and Rust gates, protocol drift, browser screenshots across five approved sizes. Native save/undo is main-owned and initially NOT_RUN.

## Results

R06 product implementation is frozen and handed to the main session for native acceptance and to `r06_check` for the independent full quality gate. This report records implementer evidence only; final task status and native receipts belong to the main session.

### Delivered behavior

- History is a separate workspace that does not depend on a selected bookmark or a live connection. Rows show Chinese operation names, time, affected count and receipt state. Internal identifiers remain in expanded diagnostics. Existing batch receipts remain available.
- Details use the persisted operation snapshot for complete deleted subtrees. A single folder deletion counts its descendants even after the nodes have disappeared from the current tree. Restored identity associations are reconstructed from durable restore hints and successful create receipts, so they remain visible after pending metadata maps have been consumed.
- Conditional undo reuses the existing plan/apply engine and returns every planned step (up to the existing 1,000-step bound). Preview is read-only, cancellation sends no apply, and confirmation requires the current live source/revision. Original-operation epoch checks prevent applying an old identity's undo to reused Chrome IDs. Result notices follow the returned undo operation ID until a receipt or uncertainty is observed; sending is never displayed as completion.
- Export has explicit saved/cancelled/failed outcomes. Rust captures tree, identity epoch, revision, cache time and sidecar values before opening the native dialog. Storage values are gathered in one serialized storage-worker job while the Bridge lock holds the corresponding tree snapshot. HTML metadata comments escape comment delimiters. A mirror supports HTML and explicitly has no sidecar export.
- Rust owns `GetSaveFileNameW`, its main-window owner, selected path and atomic file replacement. The frontend sends only a source identity and format. No filesystem capability or generic path/content-writing IPC was added. The three new commands reject non-main windows.
- The reviewer completed the approved local `copy_mapped_metadata` source-epoch filter and a real-storage red-to-green regression. Old pending restore maps cannot copy notes or tags onto a new epoch's reused Chrome ID.

### Files changed for R06

- UI: `apps/desktop/src/features/history/{HistoryWorkspace.tsx,ExportDesk.tsx,history.test.tsx}`, `features/library/{LibraryWorkspace.tsx,EditDesk.tsx,library.test.tsx,BatchReceipt.test.tsx}`, `App.test.tsx`, `backend.ts`, and scoped `styles.css` additions.
- Native save: `apps/desktop/src-tauri/src/export.rs`, command registration in `main.rs`, the Windows-only `windows-sys` feature dependency in `Cargo.toml`, and its existing-version `Cargo.lock` dependency reference.
- Core: `crates/core/src/bridge/{history.rs,edit.rs,mod.rs,tests.rs}` and `storage/operations.rs`; reviewer-owned epoch regression in `storage/tests.rs`. Existing operation, snapshot, backup, receipt and undo engines are reused; no schema migration was introduced.
- Protocol: `crates/protocol/src/{history.rs,bridge.rs,lib.rs,bin/export-schema.rs}`, `packages/protocol/src/{history.ts,history.test.ts,index.ts}`, generated operation-list/detail, undo-preview and export-save-result artifacts, and `scripts/protocol.mjs` registration.
- Browser regression: `tests/e2e/{history.spec.ts,mock-bridge.ts}`. Prior task code and cumulative uncommitted changes remain intact.

### Stable integration contract

- `operation_detail(profileId, operationId)` returns operation summary, complete step receipts, delete descendants, `undoOf` and durable restored identity associations.
- `preview_undo(profileId, operationId, expectedRevision)` returns the complete conditional plan, conflicts and writable status without mutation. Confirm uses the existing `apply_edit` undo action.
- `save_export(source, format)` accepts `{kind: 'profile' | 'mirror', id}` and `html | sidecar`; its result is `saved | cancelled | failed` plus snapshot metadata and a stable optional error code. It never accepts or returns an arbitrary filesystem path.
- Native titles: `保存书签 HTML` / `保存侧车 JSON`; default names: `bookmarks.html` / `bookmarks-sidecar.json`. An existing absolute `MARKBRIDGE_APP_DATA` directory is the initial dialog directory for isolated acceptance. Normal application startup keeps the system default.
- Accessible names: `操作记录`, `操作详情`, `撤销此记录`, `查看逐项回执`, `审查条件撤销`, `撤销预览`, `完整撤销差异`, `确认条件撤销`, `取消撤销`, settings tab/region `备份导出`, `导出 HTML`, `导出侧车 JSON`. History summary row selector: `.history-summary`.

### Implementer validation

| Check | Result / evidence |
| --- | --- |
| `cargo check --workspace --offline` | PASS during implementation, before final independent gate. |
| `pnpm protocol:generate` | PASS after the final deleted-descendant DTO change; schema/TS/validators regenerated together. |
| `pnpm typecheck`, `pnpm lint` | Intermediate PASS after legacy test adaptation; final full rerun delegated to check. |
| Focused frontend/protocol integration | 63 tests in five files passed after history/export extraction and legacy expectation updates. Final new watch coverage was subsequently rerun below. |
| `pnpm exec vitest run apps/desktop/src/features/history/history.test.tsx` | 9/9 PASS, including deferred matching undo receipts, cancellation, failure/retry, duplicate clicks, mirror and source/late-response isolation. `automated-history-tests.log`. |
| Core offline export / full undo preview | PASS for one-snapshot notes/tags metadata export and 61-step reverse conditional preview with epoch rejection. |
| Real stored sparse-delete undo | PASS after extending the existing `daily_batch_move_and_sparse_delete_undo_restore_tree_order_and_local_notes` regression with durable detail mappings. |
| Real nested deletion detail | PASS: folder → nested folder → leaf, actual apply/receipt, summary count 3, 2 descendants and 3 undo steps. |
| Reviewer pending-map epoch regression | Red → green PASS, `check-epoch-map-red.log` and `check-epoch-map-green.log`. |
| `pnpm exec playwright test tests/e2e/history.spec.ts` with task-specific `MARKBRIDGE_EVIDENCE_DIR` | Final 5/5 PASS, `browser-history-frozen.log`; 1440×900, 1100×760, 640×760, 1100×480 and 640×480. |
| Final full frontend/Rust/build/protocol gates | Handed to independent checker; see `check-report.md` for authoritative final results. |
| Actual Windows dialogs/file parsing, live Chrome deletion/undo, remote command denial | Main-owned native acceptance, NOT_RUN by this implementer. See main receipts when completed. |

Browser tests exercise all 61 undo rows, keyboard End access to the final row, reachable confirmation/cancel actions, zero apply after cancellation, and all three export outcomes. They assert that the export heading is below both the scroll viewport and source bar. Final screenshots are under `screenshots/frozen/`; page-top and saved-result images are separate because the content scrolls at 480px height. Wide history, narrow export top and narrow undo screenshots were visually inspected. The compact export source line leaves the HTML action visible on the 640×480 first screen.

Protected-script hashes were retained: `foundation.test.mjs` = `d2c071af73e77d4f0d8bdb9df21261c04e18e91cdf4d5ffe2efb77bcc15bf9c2`; `tauri-dev.mjs` = `85c01c27be3da42e4f09d155e2b8159c532d87cb3ccbe81978d1aca278108140`.

### First failures and corrections

- Early frontend failures were obsolete EditDesk history props, raw operation-ID expectations and Blob-download expectations. Tests were updated to assert the independent history UI and native save receipts; the focused 63-test suite passed afterward.
- The first broad Rust run is retained in `automated-rust-tests.log`. Two OS-credential tests failed with sandbox storage errors and need the checker's permitted host-context rerun. A new durable mapping assertion also failed because transient pending maps had already been consumed. History now derives the association from persisted restore hints plus observed create receipts; its targeted regression passed.
- Independent review exposed deletion details/counts reading only touched root nodes. These now read the full operation snapshot; the real nested-delete regression passed.
- Independent review exposed a notice stuck at “waiting for receipt.” It now follows the exact returned undo operation and handles success, conflict, failure, partial completion and uncertainty. Both deferred terminal-state cases passed.
- An early 640×480 export screenshot showed an automatically scrolled page rather than its top. The final test restores the page scroll, verifies the heading boundaries, and captures a separate visible save receipt. Redundant source copy was compacted; final screenshots and five browser cases passed.

### Remaining boundaries

No known product fix remains at this freeze. Independent full checks and actual native acceptance remain required before R06 completion. This work does not claim full-library import/restore, additional platforms or true OS sleep/wake acceptance; the latter remains required before R08 completion. No commits, archive, publish, install or daily Chrome mutation were performed.
