# R06 independent review

Status: R06 independent review PASS on the final frozen product, including the reviewer epoch-map and history-export navigation fixes. Automated gates passed, and the independently reviewed main-session native history, export and remote-permission reports all passed on final executable `89c17f5a9b59f08dd9f14654c4958597cc6a478665dd20ad5bf42fc5b6885178`.

## Findings (fixed)

- `crates/core/src/bridge/history.rs` and `bridge/edit.rs`: deletion descendants and the single-delete affected count used `BeforeBody.nodes`, which contains only touched roots for actual writes. Implementer changed these reads to the complete stored snapshot. Real Bridge/storage regression covers folder, nested folder and leaf, with count 3, two descendants and three undo steps.
- `crates/core/src/bridge/history.rs`: `AfterBody.maps` is a pending metadata-copy queue consumed after restoration. Implementer now reconstructs historical restored IDs from durable restore hints and successful create receipts. The real sparse-delete recovery regression checks detail mappings after the copy queue is consumed.
- `apps/desktop/src/features/history/HistoryWorkspace.tsx`: a normal asynchronous undo initially returns `rolling_back`; the notice remained waiting after receipt completion. Implementer added observation of the returned undo operation ID. Deferred success and conflict regressions pass.
- `crates/core/src/storage/operations.rs`: pending restore-map lookup filtered by profile only, allowing an old epoch map to copy notes and tags into a reused Chrome ID after source reset. Reviewer added the `source_epoch` query boundary. The temporary SQLite regression in `storage/tests.rs` reproduced old metadata overwriting the new source note before the fix, then passed after the fix; it also checks no old tag copied and no old map consumed. Logs: `check-epoch-map-red.log`, `check-epoch-map-green.log`. The initial test compile correction from SQLite `u64` to `i64` is preserved in `check-epoch-map-before.log`.
- `App.tsx`, `LibraryWorkspace.tsx`, `HistoryWorkspace.tsx`: main-session native review found the designed history-to-export entry was not wired. Reviewer restored the history action and passed its callback through the existing App navigation to the export settings tab. Source and unsaved metadata remain mounted and unchanged. Five viewport tests now enter exports through this action, and an additional offline-draft test verifies the source/note remain intact and navigation sends no save or mutation. Main rebuilt and passed all three native entry points on this final product version.

The first three fixes were coordinated with the implementer before freeze. The epoch-map and navigation fixes had explicit main-session scope approval and exclusive file ownership. No concurrent product file was overwritten.

## Findings (not fixed)

No known R06 product defect remains from this review. Native save, real Chrome history/undo and remote-command denial are established by the separate main-session runs reviewed below; mocked browser checks are not substituted for those native controls.

The first full frontend test run passed 166/167: the existing offline tag-management test encountered a draft-leave confirmation after its asynchronous save. The unchanged file then passed 13/13 alone, and the unchanged complete suite passed 167/167 plus all six script tests. The first failure is retained in `check-test.log`, with `check-tags-focused.log` and `check-test-retry.log` documenting retests. No deterministic product failure was established and no tag product/test changes were made to suppress the observation.

Existing Vite bundle-size advisories remain outside this task's scope. Production artifact scanning passes.

## Read-only verification

- New history, undo-preview and save commands call the existing trusted-main guard. The main capability remains `core:default` without generic filesystem grants.
- Save input carries source and format only. Rust owns the destination, file body and native dialog; IPC output has no path or body.
- Export holds the Bridge lock while capturing source/tree/epoch/revision/cache time, and reads all sidecar entries/tags in one serial Storage worker job. The lock is released before the dialog.
- Same-directory temporary writes, sync and atomic replacement preserve the existing destination on failure. Cancel does not invoke the writer.
- Undo reuses the existing engine, and stored operation epoch is checked against active profile epoch before planning or applying.
- Protected user script SHA256 values match the dispatch instructions.
- Initial 640 x 480 export screenshot showed content clipped after button auto-scroll. Final browser tests separately capture the page top and saved result, assert title boundaries below the scrollport/source bar and confirm receipt reachability. No sticky overlay defect was found.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| `pnpm lint` | PASS, including final navigation fix | `check-nav-lint-final.log` |
| `pnpm typecheck` | PASS, including final navigation fix | `check-nav-typecheck-final.log` |
| `pnpm test` | Final PASS: 167 Vitest + 6 script tests | `check-final-test.log`; earlier first failure/retest retained above |
| `pnpm build` | Final PASS, including production artifact scan | `check-nav-build.log` |
| `pnpm protocol:check` | PASS, read-only drift check | `check-protocol.log` |
| `cargo fmt --all -- --check` | PASS | `check-fmt.log` |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | `check-rust.log` |
| `cargo test --workspace --locked` | PASS: 142 tests, 3 pre-existing ignored | `check-rust-tests.log` |
| `pnpm test:e2e` | Final PASS: 51 cases | `check-final-e2e.log`; earlier 50-case run retained |
| `git diff --check` | PASS | Run after checks, with `core.safecrlf=false` to suppress line-ending advisories |
| Protected scripts | PASS: both SHA256 values unchanged | Verified after the full gates |
| Native save/history/remote command denial | PASS: 6 export, 6 history, 11 web controls; 68 commands DENIED | Main-session runs `951c480a`, `61440e3d`, `c3d68946`, independently reviewed below |

Rust totals are core 111 passing with 3 ignored, desktop 17 passing, protocol 14 passing. Checks needing installed caches and task-scoped Windows credentials ran in the permitted host context; they did not change daily Chrome or installed extensions.

Browser screenshots are isolated under `screenshots/check-final/`, including R06 history, full undo review and export top/result at 1440 x 900, 1100 x 760, 640 x 760, 1100 x 480 and 640 x 480. Reviewer visually inspected wide/medium history, both minimum-height export widths, narrow export result and both narrow undo heights. The neutral surfaces, blue actions, Segoe UI and plain list divisions follow the approved direction; no card grid or new style system was introduced. The data shown in browser captures is explicitly test fixture data; native captures remain separate.

After the navigation fix, the 28 targeted App/history unit tests and six targeted browser cases passed. Final full browser screenshots are in `screenshots/check-final-navigation/`; targeted navigation screenshots are in `screenshots/check-navigation-final/`. Reviewer visually checked the new export action at 640 x 480 and 1100 x 760. Intermediate navigation checks retained a missing optional-prop declaration error and a test selector mismatch (`getByLabel` versus the actual accessible combobox role); both were corrected before the final passing checks. There were no subsequent Rust or protocol changes, so their existing passing gates remain applicable.

## Spec synchronization

Main updated component-guidelines, hook-guidelines, database-guidelines and error-handling with the new contracts. Reviewer reread these changes and verified the relevant implementation paths. No task status, native harness, receipts, commit, archive, publication or installation was changed by this reviewer.

## Native evidence review, export

Reviewed `native-export-807627e1.json` and its harness assertions: all six controls PASS on executable `77efe5e31122a3e7572c3f2170a27526ea010755f13150ad645fd874e754cdc7` (24,033,280 bytes). Evidence covers actual native cancellation without files or success, parsed HTML and sidecar JSON, snapshot consistency during concurrent Chrome/local metadata changes, an actual Rust write failure for a locked destination with original bytes preserved and successful retry, disconnected cached export, and mirror HTML-only behavior. No page errors were recorded and temporary credentials were removed. This is actual native/file evidence, separate from mocked browser export receipts.

`RestoredIdentity.bookmarkId` identifies the **original** local bookmark identity retained in the persistent restore hint. Restored Chrome nodes can receive new Chrome IDs and new local bookmark IDs; metadata is copied to the new local identity. Successful recovery means the semantic tree, sibling order and local metadata are recovered with traceable old/new Chrome mapping, not that the old bookmark ID is resurrected. The frozen UI already says `原本地身份`, so no product or artifact change is required. The first history run `ef65d3ce` stopped on a harness assumption that old/new local IDs must be equal; retain it as failed harness evidence, followed by the corrected passing history run below, not a product recovery failure.

## Native evidence review, final history

Reviewed `native-history-61440e3d.json` and the corresponding native assertions on final executable `89c17f5a9b59f08dd9f14654c4958597cc6a478665dd20ad5bf42fc5b6885178` (24,033,280 bytes). All six controls PASS, with zero page errors and temporary credentials removed. Actual Chrome recovery restores the semantic tree, sparse sibling order, note and three durable mappings. External edits remain unchanged on conflict. A partial batch restores only its two confirmed steps, preserves the conflict/unexecuted items and sibling order, and requires manual review before the blocked confirmation becomes available. The manual-review flag leaves the original partial result unchanged. Offline history remains readable with undo disabled and the connected export navigation works.

The initial history harness failures remain retained. Pure-conflict zero-step undo records `rollback_conflict` on the original operation; it does not require a newly created undo operation. Partial operations stay write-blocked until reviewed. Corrected tests respect both existing engine contracts.

## Native evidence review, final export and remote permissions

Reviewed final `native-export-951c480a.json` and `native-export.mjs` assertions. All six controls PASS on the same final executable. Actual cancellation creates no file and reports no success. Parsed Netscape HTML retains its captured revision and bookmark values while Chrome changes during the dialog; parsed schema-2 sidecar JSON retains the captured note and tags while local metadata changes. Export source metadata and comment escaping are verified. The locked-destination case reached `rust_write_failed`, kept the original file bytes and showed no success, followed by a successful real save retry. Disconnected cache export and mirror HTML-only behavior pass, including rejecting mirror sidecar IPC before any dialog. There are no page errors, and temporary credentials were removed.

Reviewed `native-web-c3d68946.json`, `native-web.mjs` and `native-probe.mjs`. All 11 controls PASS on the same final executable. The probe derives its command list from the actual registered Rust handlers; all 68 commands return `DENIED` from the real remote preview page, including `operation_detail`, `preview_undo` and `save_export`. This is an explicit permission-denial result, not a timeout or an invalid-argument result. Separate native windows, main DOM/storage isolation, navigation history, scheme/file/userinfo/popup/download guards, selected-profile session clearing and unreachable-page failure behavior also pass. There are no page errors, and temporary credentials were removed.

Final native screenshots at 640 x 480 CSS pixels were reviewed for full undo controls, partial-reviewed history and mirror export. The undo confirmation/cancellation remain reachable; the partial result stays visibly partial after review; the mirror export uses its scroll region without horizontal overflow. The native environment reports scale 1.25, so the corresponding physical captures are 800 x 600 pixels. Native and mocked browser evidence remain distinct.

The final executable hash was rechecked against the reports; both protected script hashes and `git diff --check` also remain clean. No product change or repeated automatic gate was needed after the final native runs. R06 has no outstanding review blocker. Real OS sleep/wake remains UNVERIFIED under the user's approved deferral and must be completed before R08; this R06 review does not waive or claim that separate gate.
