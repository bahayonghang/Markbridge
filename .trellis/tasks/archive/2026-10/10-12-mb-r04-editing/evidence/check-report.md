# R04 independent Trellis check

Status: independent code, protocol and automated checks PASS on 2026-10-13. No unresolved R04 code finding. This report does not substitute for the main session's native acceptance receipt.

## Scope and method

- Active task: `.trellis/tasks/archive/2026-10/10-12-mb-r04-editing`; R01–R03 changes already present in the working tree were treated as context, not new R04 work.
- Loaded the saved SubagentStart hook output, task PRD/design/implementation/check context, parent design/verification, and relevant frontend, backend, extension and protocol guidelines.
- Traced local IPC validation, reviewed plan identity, snapshot/HTML/sidecar ordering, per-profile holds, receipt-driven dispatch, timeout/cancel/restart behavior, extension subtree checks, inverse operations and frontend request generations.
- Preserved existing changes, including user-owned `scripts/foundation.test.mjs` and `scripts/tauri-dev.mjs`. No commit, archive, install or daily Chrome access.

## Findings fixed

1. **Preflight every outbound step before the first effect** (`crates/core/src/bridge/edit.rs`, `batch_edit.rs`). A later oversized subtree could previously fail after an earlier item executed. The implementer now encodes every step before backup/operation creation and stops explicitly on an unexpected later encoding failure. The regression with a small first item and oversized later folder passes with no message, operation or backup.
2. **Restore sparse deletions in the correct order** (`crates/core/src/editing/mod.rs`). For `[A,B,C,D]`, deleting `[A,C]` records C at pre-step position 1, not snapshot position 2. Restoration now uses the actual recorded position, simulates created nodes and sibling shifts, and maps restored IDs while checking subsequent inverse steps. Core integration verifies sparse deletion and batch move undo, complete semantic tree/order, local notes, and external order conflicts without overwrite.
3. **Reject groups whose known inverse cannot be sent** (`editing/mod.rs`, `bridge/edit.rs`). Parent-approved limits are 1000 affected nodes including descendants for daily delete (single or batch), and 1000 deduplicated roots for move. Complete inverse frames are also encoded before backup/operation/send. The helper was compared with real `restore_deleted`/`inverse`: preorder descendants, parent request-ID references, root pre-step positions, and Create/Move fields agree. Regressions cover two 600-node trees, exact 1000, 840 long-title/URL rejection scenarios, and a valid 800-step recovery envelope. No automatic splitting or authorization occurs.
4. **Use current tree order and complete subtree preconditions** (`editing/mod.rs`, extension executor, Rust/TS wire validation). Root sorting follows tree preorder rather than the cache vector's arrival order. Single and batch daily move/delete include the reviewed subtree. Extension regressions cover changed, added, removed and newly protected descendants for both move and delete with zero browser writes; malformed and oversized wire subtrees reject in both languages.
5. **Recover persistent batch receipts from history** (`EditDesk.tsx`, new `BatchReceipt.tsx`, operation summary DTO and generated outputs). Closing a detail view previously discarded the only per-item entry point. History now marks only persisted batches with backward-compatible optional `isBatch`, opens `逐项回执`, queries by profile/operation, and exposes stop/retry. Profile/operation/remount generations reject stale results. Cancel does not call an in-flight item unexecuted or undone. Five dedicated tests cover legacy records, read-only reopening, remount, A→B→A results, duplicate cancellation, older polling responses and retry.
6. **Close the destination chooser after confirmation** (`FolderPicker.tsx`). Pointer selection and Enter close the chooser and restore summary focus while displaying the full chosen path; Arrow navigation stays open. Two regressions pass. This removes the large unused target list above the review.
7. **Keep selection from moving the first row** (`LibraryWorkspace.tsx`, `styles.css`). Browser testing exposed a double-click regression when the new selection bar inserted an extra row between clicks. A later real WebView2 run exposed the additional classic-scrollbar variant: the breadcrumb heading grew by 15.2px at Windows 125%, whereas its selection replacement remained 40px. The final implementation keeps the original heading in layout with `visibility:hidden`, `inert` and `aria-hidden`, and overlays the selection toolbar within the same container. Thus actual scrollbar height determines both states without clipping or hiding the usable breadcrumb scrollbar. A compact complete-path entry remains available in selection mode. The path overlay has bounded height, scrolling and keyboard focus for deep directories. Five viewport checks cover a real asserted 16px scrollbar gutter, stable first-row Y before/after selection and cancellation, hidden-action focus/accessibility exclusion, restored breadcrumb/new actions, 20-level Chinese paths, visible overlay bounds, keyboard scrolling and Escape focus return.
8. **Explain limits in Chinese and preserve review semantics** (`EditDesk.tsx`, `BatchEditDesk.tsx`). `FRAME_TOO_LARGE` and `LIMIT_EXCEEDED` explain that the user must shrink the selection; they no longer appear as a protected-node error or raw code. Existing frontend regression coverage also verifies detached creation drafts, same-profile A→B→A, changed drafts/revision, own-write revision before invoke resolves, and duplicate/two-step confirmation.

The reviewer implemented items 5–8 after explicit main-session assignment; the implementer repaired the core findings and added relevant tests. Shared product files were coordinated and frozen before native builds.

## Findings not fixed

- No unresolved R04 code or protocol finding remains.
- Native task acceptance remains owned by the main session. The reviewer read PASS JSON records for normal batching, four injected faults, actual editing UI and managed-node protection. Final UI run `native-editing-ad0def29.json` passes all 5 controls on executable SHA256 `9ac5157f3e53b960ef5e885ed6e9550b7012ebf433bafec95bd961921b3df780`: at 640×480/Windows 125%, before/after row Y both equal 270.600006 and both headings measure 55.200001px, with End scrolling and Escape focus return. `native-core-files-after-layout.json` verifies 215 core/protocol/extension files unchanged; extension hash remains `7deb42c27dc23bca5e9277734d5d41a9c49d0c18d89e4b2475a703e3147b2040`, so earlier core/fault evidence remains attributable to unchanged code.
- Three Rust tests are explicitly ignored by the default suite: disposable Chrome B100, external chat process integration and B10K diagnostic. They are not counted as passed. Old OS suspend/resume evidence remains UNVERIFIED under the approved R08 gate change.
- The existing Vite output chunk-size advisory remains a warning; production artifact safety scanning passes. No unrelated bundling refactor was introduced.

## Verification

| Check | Status |
|---|---|
| `pnpm lint` | PASS — `check-lint-scrollbar-final.log` |
| `pnpm typecheck` | PASS — `check-typecheck-scrollbar-final.log` |
| `pnpm test` | PASS — 19 Vitest files / 141 tests, plus 6 script tests; `check-test-rerun.log`; final scrollbar UI rerun also 141/141 in `check-vitest-scrollbar.log` |
| `pnpm protocol:check` | PASS — generated schema, TypeScript and static validators match; `check-protocol.log` |
| `cargo fmt --all -- --check` | PASS — `check-fmt-final.log` |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | PASS — `check-clippy-final.log` |
| `cargo test --workspace --locked` | PASS — core 106, desktop 13, protocol 14; 3 explicit ignores; `check-cargo-test-rerun.log` |
| `pnpm build` | PASS — including artifact safety scanner; `check-build-scrollbar.log` |
| `pnpm test:e2e` | PASS — 39 tests; `check-e2e-scrollbar.log`; final type-safe gutter measurement also passes `check-classic-scrollbar-final.log` |
| Visual review | PASS — actual inspection of `screenshots/r04-editing-{1440x900,1100x760,640x760,1100x480,640x480}.png` and `screenshots/r04-classic-scrollbar-path-640x480.png`; wide review/list coexist, narrow and short views keep controls reachable, long paths scroll within the viewport |
| Native Tauri/Chrome | Main-session receipts PASS; final UI 5/5 in `native-editing-ad0def29.json`, unchanged-core manifest `native-core-files-after-layout.json`; see `receipts.md` for normal/fault/managed evidence |

The final product change after the Rust/script run was limited to the path-overlay and browse-heading layout/accessibility, plus its browser regression. Final lint/typecheck/build, 141 Vitest tests and all 39 browser tests were rerun. Rust/protocol/extension and scripts were unchanged.

## First failures and reruns

- Initial lint/typecheck were blocked by pnpm's external cache lock path; the approved existing-runtime rerun passed. Logs: `check-lint-initial.log`, `check-typecheck-initial.log`.
- Initial type-check then exposed newly added test tuple/exact-option typing errors; the implementer fixed them. Final type-check passes. Earlier output remains in `check-typecheck.log`.
- First browser run: 35 pass / 3 fail (`check-e2e.log`). One was the real selection-bar double-click regression fixed above. Two expected disabled read-only preview actions to be absent; they now assert disabled, preserving R04's visible drafts. The creation test uses the new `名称`/`网址` labels. Rerun 38/38 passed, and the final added long-path regression makes 39/39.
- The first unit rerun after replacing the heading found two R03 tests clicking the now-replaced filter action while selection was active (`check-test-final.log`). Tests now open the filter first, still verify scope clearing and changing note filters during a pending save, and all 141+6 pass (`check-test-rerun.log`). Product code was unchanged for this adjustment.
- Default sandbox Rust run passed 104 core tests but failed two Windows Credential Manager tests with `StorageError` (`check-cargo-test.log`). Both use isolated task namespaces and cleanup. The allowed credential-access targeted rerun passed 2/2 (`check-cargo-credentials-rerun.log`), followed by the full successful workspace rerun.
- Native `native-editing-3d5147b9.json` exposed the classic-scrollbar row shift (270.600006→255.400009). The prior headless run hid scrollbars. Browser tests now remove Chromium's `--hide-scrollbars` argument and explicitly assert the real 16px gutter. Before fixing product CSS the controlled regression failed with 279.5625→263.5625 (`check-classic-scrollbar-red-layout.log`); after preserving the original heading's layout it passes at all five sizes (`check-classic-scrollbar-final.log`). Earlier test setup attempts that lacked a real gutter remain in `check-classic-scrollbar-red*.log`. No browser/native failure was reclassified as acceptance.
- The new scrollbar geometry test initially accessed `offsetHeight` on a union that could include SVG; it now uses the typed shared bounding-rectangle API. `check-typecheck-scrollbar-final.log` passes.

## Contract and scope review

- Plan identity remains bound to profile, epoch, revision, plan hash and reviewed before-state. Protected selections are checked before parent/child deduplication. Target protections differ correctly from protected folder roots that may receive children.
- Snapshot, Netscape HTML and sidecar creation complete before the first dispatch; snapshot/operation and batch progress persist through existing storage. Per-profile writes cannot bypass `batch_hold`.
- Next dispatch follows the current receipt. Independent 10-second timeout, cancellation, disconnect and restart stop future steps. Late receipts correct results without resuming. History recovery only queries/cancels; it cannot reapply a batch.
- Protocol schemas and static validators were regenerated together, preserving optional old-record compatibility and the unchanged 16MiB frame limit.
- Main-session spec sync is present in R04 design and backend database/error-handling plus extension guidelines for limits, inverse preflight, subtree protection and persistent history recovery.
- No previous task screenshots were overwritten: browser runs used `MARKBRIDGE_EVIDENCE_DIR=.trellis/tasks/archive/2026-10/10-12-mb-r04-editing/evidence/screenshots`. No old 06 native harness was run by this reviewer.
