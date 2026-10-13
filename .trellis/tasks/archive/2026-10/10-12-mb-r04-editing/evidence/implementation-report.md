# R04 implementation report

Implementation is frozen for independent verification, except the reviewer-owned historical batch receipt entry requested during review. Native acceptance is owned by the main session and is not claimed by this report. No commit, archive, publish, installation, real-profile bookmark mutation, dependency change, or schema migration was performed.

## Implemented behavior

- Bookmark and folder creation have separate blank drafts; editing drafts survive source revision changes and require explicit rereview. Parent choices use searchable full paths. Ordinary bar/other folders are writable destinations; root, managed descendants, self, and descendant destinations are rejected.
- Multiselection creates one backend move/delete plan with profile, epoch, revision, immutable plan token/hash, deduplicated roots, complete subtree counts and per-item differences. Roots follow current tree preorder even when received events have reordered the snapshot vector. Dragging and keyboard gestures only open review.
- Confirmation consumes the reviewed token. Every eventual single-step wire frame and the complete recovery envelope are validated before any backup or effect. The existing operation/snapshot path writes whole-tree snapshot, Netscape HTML and local sidecar before sending the first step. Only a receipt confirming that step advances the batch. Background 10-second acknowledgement deadlines, disconnect, conflict and cancellation stop subsequent dispatches. A late receipt can correct an item but cannot resume the group.
- Per-item states distinguish applied, not executed, in flight, conflict and uncertain. Delete requires a second confirmation above 20 affected items. At most 1000 selected roots are accepted; delete counts all deduplicated descendants against the same 1000 limit, including single-folder delete, so a successful delete cannot create an undo known to exceed the inverse-step limit.
- Conditional undo now restores sparse sibling deletions at their actual pre-step positions. The internal undo simulation creates temporary nodes and updates expected sibling IDs using restore hints, so multiple roots with new Chrome IDs preserve order. Existing receipt metadata mapping restores local notes even when the created event precedes its receipt.
- Late preview responses are rejected after A→B→A node changes, revised source data, edited drafts, cancellation or a newer request. Apply responses tolerate their own revision event preceding the invoke result while guarding node/profile/draft changes and duplicate confirmation.

## Contracts and integration

Rust `BatchEditPreview` and `BatchEditStatus` generate schema, TypeScript and static Ajv validators. Commands: `preview_batch_edit`, `apply_batch_edit`, `get_batch_edit`, `cancel_batch_edit`. `expectedSubtree` is optional on operation steps, permitted only for move/delete, with validated target/before-state/tree shape. Daily batch and single move/delete commands send it; legacy commands without it remain valid. Older strict extensions reject the additional condition, so desktop and extension updates are paired. The existing 16 MiB frame limit is unchanged.

Existing operations before/after JSON gains defaulted optional batch metadata, requiring no numbered migration. Stored operation records hold the immutable planned list and dispatched count; frontend apply accepts only planId/hash and never supplies replacement steps.

Selectors retained for native checks: creation inputs `#edit-title` / `名称`, `#edit-url` / `网址`; type buttons `书签`, `文件夹`; actions `预览新书签`, `预览新文件夹`, `确认变更`; target search `搜索文件夹路径`; multiselect actions `移动所选`, `删除所选`; batch actions `预览批量移动`, `确认批量变更`, `继续确认批量删除`, `确认批量删除`, `取消批量预览`; results region `逐项回执`; stop action `停止后续步骤`. Historical receipt selectors are in the independent check report.

## Files touched by the implementer

This list identifies R04 work; these files may also contain preserved earlier uncommitted R01–R03 edits.

- Desktop: `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src/backend.ts`, `apps/desktop/src/features/library/{EditDesk,LibraryWorkspace,VirtualRows,BatchEditDesk,FolderPicker}.tsx`, `apps/desktop/src/styles.css`.
- Core: `crates/core/src/bridge/{batch_edit,edit,mod,maintenance,organization,tags}.rs`, `crates/core/src/editing/mod.rs`, `crates/core/src/storage/{mod,operations,tags}.rs`.
- Protocol: `crates/protocol/src/{batch_edit,lib,wire}.rs`, `crates/protocol/src/bin/export-schema.rs`, `packages/protocol/src/{batch-edit,index,wire}.ts`, `scripts/protocol.mjs`, generated `batch-edit-preview.*`, `batch-edit-status.*`, `wire-message.*`.
- Extension: `apps/extension/src/executor.ts`.
- Verification: `crates/core/src/{bridge,editing}/tests.rs`, `crates/protocol/src/wire_tests.rs`, `packages/protocol/src/wire.test.ts`, `apps/extension/src/executor.test.ts`, `apps/desktop/src/features/library/editing.test.tsx`, `tests/e2e/{editing.spec,mock-bridge}.ts`.

## Implementer checks

All command logs remain under this evidence directory, including failed attempts. Independent final gates and reviewer changes are recorded in `check-report.md`; native gates are recorded by the main session.

| Check | Observed result / log |
| --- | --- |
| Rust → schema → TS/Ajv generation | PASS, generated twice while settling DTOs |
| `pnpm lint`, `pnpm typecheck` earlier implementation runs | PASS after initial VirtualRows aria-disabled type adjustment |
| Library component regressions | 26/26 PASS, `library-retest.log` |
| New create/preview/batch UI tests initially | 4/4 PASS, `ui-editing-first.log` |
| Initial batch Rust tests | 4/4 PASS, `rust-batch-first.log` |
| Expanded batch guards / 60 items / backup failures / later oversized frame | 7/7 PASS, `rust-batch-boundaries.log` |
| Final batch guards including full recovery frame limits | 9/9 PASS, `rust-final-batch.log`; 840 long title/URL entries reject before messages/operations/backups, 800 inverse entries encode within the unchanged 16 MiB limit |
| Full editing planner tests including sparse undo / 1000 boundary / single subtree preconditions | 15/15 PASS, `rust-final-editing.log` |
| Real storage move + sparse delete undo, semantic tree/order and local note | PASS, `rust-undo-sidecar.log` |
| Extended wire / executor subtree / UI races and second confirm | 26/26 PASS, `targeted-regressions.log` |
| Browser create and 5 viewport batch tests | 6/6 PASS, `browser-first.log`; final screenshots refreshed by independent checker |
| `pnpm test` before final added regressions | 127 Vitest + 6 script tests PASS, `pnpm-test-retest.log` |
| `cargo test --workspace --locked` before final added regressions | PASS: core 98, desktop 13, protocol 13; 3 existing ignored, `cargo-test-retest.log` |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS, `clippy-first.log` |
| `pnpm build` | PASS, `build-first.log`; existing bundle-size advisory remains |

Preserved failures: `cargo-test-first.log` contains sandbox credential-store denials and two old synthetic root-target fixtures corrected to writable folders. `pnpm-test-first.log` contains the existing AI-summary timing failure, isolated rerun and full rerun passed (`ai-summary-isolated-retest.log`, `pnpm-test-retest.log`). `rust-sparse-undo.log` is the newly introduced regression failure that exposed the missing create simulation; its repair passed in `rust-editing-retest.log`. `rust-recovery-frame-single.log` retains an initial test-fixture failure: the single-folder case accidentally split its long children between two folders, then hit the existing export-document limit. The fixture was corrected; `rust-recovery-frame-retest.log` and final batch tests passed. Independent typecheck initially found test-only nonempty-tuple/Testing Library option errors; implementer corrected those before handing all tests to the checker.

## Visual and safety verification

The first five actual screenshots (1440×900, 1100×760, 640×760, 1100×480, 640×480) were opened and inspected. No horizontal overflow was observed. Inspection led to hiding the completed target picker during review and keeping the detail heading sticky so the back control stays reachable. Final screenshot inspection is appended below once the checker regenerates them. All screenshots use command-scoped `MARKBRIDGE_EVIDENCE_DIR`; fallback is `test-results/screenshots`. R02/R03 screenshots were not written.

User-owned script hashes checked unchanged on 2026-10-13:
- `scripts/foundation.test.mjs`: `d2c071af73e77d4f0d8bdb9df21261c04e18e91cdf4d5ffe2efb77bcc15bf9c2`
- `scripts/tauri-dev.mjs`: `85c01c27be3da42e4f09d155e2b8159c532d87cb3ccbe81978d1aca278108140`

## Pending acceptance ownership

Main session owns temporary native Chrome/Tauri acceptance, all `native-*` files and receipts. Real OS sleep remains explicitly deferred until before R08 completion; old V04 stays UNVERIFIED. This report does not convert a build, mock browser test or automatic test into native acceptance. Reviewer owns historical batch receipt recovery and final independent gates. No other known product gap remains in the implemented R04 scope pending those checks.

## Final screenshot inspection

Opened and visually inspected all five refreshed images under `evidence/screenshots/`: `r04-editing-1440x900.png`, `r04-editing-1100x760.png`, `r04-editing-640x760.png`, `r04-editing-1100x480.png`, and `r04-editing-640x480.png`. The wide layout retains the selected list beside the review. The 640-wide layout uses the detail surface without horizontal overflow. Both 480-high views deliberately show the review scrolled to its confirmation controls: confirm and cancel remain reachable, the sticky detail heading/back control remains visible, and the bottom status strip does not cover the actions. The empty expanded target-picker gap from the initial images is gone. Browser screenshots verify rendered mock-bridge behavior; they are not native acceptance evidence.

The independent browser suite rerun passed all 38 cases (`check-e2e-rerun.log`). Its first run preserved three old expectations that no longer matched authorized R04 behavior (blank create name versus old edit field, retained read-only draft control, and source-switch fixtures); the reviewer owns the exact corrective account in `check-report.md`. Final comprehensive check results and subsequent native evidence remain separately owned and should be read from their current reports.
