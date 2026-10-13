# Independent precommit undo review

2026-10-13. Final conclusion: the created-folder undo data-loss finding and its final deletion race are addressed. The targeted native regression passes on the corrected desktop and extension. No further blocking defect was found in this review scope. Main session retains commit, archive, metadata and handoff ownership.

## Findings (fixed)

- `crates/core/src/editing/mod.rs:1093` (fixed by the backend reviewer): an inverse create previously compared only the created folder itself and could recursively delete ordinary children added afterwards. The inverse now rejects any remaining child in the current simulated working tree with an existence conflict. A permitted empty-folder delete carries `expectedSubtree` with exactly the expected folder. The working-tree check runs after earlier inverse steps, preserving valid create-then-move undo sequences.
- `apps/extension/src/executor.ts:170` (identified in this independent review, fixed by the backend reviewer): the subtree check alone leaves a getTree-to-removeTree race. A child can arrive after the snapshot. A folder delete with a single-node expected subtree now uses Chrome's nonrecursive `remove`; Chrome refuses a nonempty folder. An API rejection remains conservatively `uncertain`, with the existing receipt state preventing automatic replay. Recursive removal remains available only for the other reviewed folder-delete cases.
- `apps/extension/src/executor.test.ts:77` (fixed by the backend reviewer): the fake `remove` initially permitted nonempty folders. It now mirrors Chrome's nonrecursive rejection. The added race test returns the previously empty snapshot after inserting an external child into the backing tree, then asserts `uncertain`, one `remove`, zero `removeTree`, and retained child data. This is a meaningful reproduction of the gap after the snapshot, separate from the existing before-execution subtree mismatch test.
- `native-undo-folder.mjs`: the first native attempt incorrectly looked for the history button under the primary navigation rather than the secondary navigation. Corrected only this selector. The original `native-undo-folder-afe0039f.json` FAIL and screenshot remain preserved; it timed out before invoking undo, recorded no page errors and removed its temporary credentials. This was a harness failure, not evidence of a product failure.

## Native verification

`native-undo-folder-10f2e69e.json` records three PASS controls using real UI actions, real Tauri IPC reads, actual Chrome bookmark APIs and real persisted receipts. No backend module or native command was mocked.

1. Create an empty folder through the UI. Its undo preview contains one delete, one-node `expectedSubtree`, no conflict, and affected count 1. Confirm through history; an associated undo receipt becomes `rolled_back`, and the entire semantic Chrome tree returns to the baseline.
2. Create another folder through the UI, then externally add a nested folder and bookmark through Chrome. Wait until both are mirrored. The actual undo preview returns `CONFLICT`, zero steps, zero affected nodes and the created-folder existence conflict. Cancelling changes neither operations nor the complete raw Chrome tree.
3. Reopen that conflict preview and confirm through the UI. The original create operation becomes `rollback_conflict` with `CONFLICT`; the complete raw Chrome tree is byte-for-byte equal to the pre-confirmation tree after JSON serialization, including the external folder/bookmark. The conflict-only implementation updates the original record, so the operation count remains 3 rather than adding a new mutation record. This observed count is not imposed as a general undo requirement.

The native report has zero page errors and `temporaryCredentialsRemoved:true`. Both temporary application and Chrome processes were closed. No daily profile, installed extension, sleep/power or global display setting was touched. Screenshots `10f2e69e-undo-folder-external-content-conflict.png` and `10f2e69e-undo-folder-confirmed-conflict-preserved.png` were independently inspected; the actual UI clearly distinguishes the zero-step conflict preview and final conflict receipt.

The last-moment post-snapshot insertion was **not** injected into native Chrome in this run. Its protection is established by the targeted production-executor regression and Chrome's nonrecursive API semantics, while this native run establishes ordinary empty-folder success and already-synchronized external-content conflict handling through the real UI/write chain.

## Verification and evidence freshness

| Check | Result and ownership |
| --- | --- |
| Fresh cumulative frontend review before the undo correction | Lint/typecheck PASS; 178 Vitest + 6 script tests PASS, run by this reviewer in `precommit/frontend-*.log` |
| Final lint and typecheck after executor correction | PASS, backend reviewer runs in `precommit-backend-full-{lint,typecheck}-final.log`, reviewed here |
| Final frontend/protocol/scripts | 180 Vitest + 6 scripts PASS in `precommit-backend-full-tests-final.log`, backend reviewer run, reviewed here |
| Focused executor suite | 13 PASS in `precommit-undo-extension-atomic-green.log`; preserved RED proves the post-snapshot race previously returned applied |
| Rust correction | 16 editing tests PASS, including legal create+move inverse; full workspace 147 PASS / 3 existing ignored; backend reviewer runs, independently reviewed source and evidence |
| Native script syntax | `node --check` PASS |
| Targeted native execution | Three PASS, exit 0: `precommit/native-undo-folder-2.log` and `native-undo-folder-10f2e69e.json` |
| Diff whitespace | `git diff --check` PASS after the correction |

Native run artifact identities were read by the harness and the executable hash was independently reread after execution:

- Desktop SHA256: `4a7f12fe8928caade0d154ec00f0557ea8f944d07f4ac7ad4e72bbdb9f5168aa`, 24,055,808 bytes.
- Extension directory hash: `365f16a030afb78d83cbe914bc42784b7f086bb846ab035ba2f4a8a30ed331a5`.
- Actual environment: Windows 11 Pro 10.0.26300, Chrome 155.0.8059.39, WebView2 155.0.4283.45.

The 60-test browser suite remains reusable for unchanged frontend sources/fixtures: their newest edit preceded `check-e2e.log`. It does not exercise the native undo implementation. Earlier native performance, live latency, DPI, preview-permission and broad daily reports belong to executable `804d920746f677cb257d8efdf6589a77a70bbf346e162dd6f68803197db63910` and extension `567f50146319a2b6f013f773308910f29bc56585a62075dbaf0f9b3cf1ff22c5`. They are historical evidence reused for unchanged layers, **not runs on the corrected binary**. This targeted run complements them; it does not remeasure performance or DPI.

Protected script hashes remain unchanged: `foundation.test.mjs` is `d2c071af73e77d4f0d8bdb9df21261c04e18e91cdf4d5ffe2efb77bcc15bf9c2`; `tauri-dev.mjs` is `85c01c27be3da42e4f09d155e2b8159c532d87cb3ccbe81978d1aca278108140`.

## Findings (not fixed)

None in the targeted correction. Actual OS sleep remains user-WAIVED / NOT_RUN, legacy V04 remains UNVERIFIED, and external synchronization and real-model quality retain their previous unverified boundaries. This review does not turn those historical limits into PASS.
