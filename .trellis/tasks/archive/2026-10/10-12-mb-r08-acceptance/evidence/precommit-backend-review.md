# Backend precommit audit and conditional-undo correction

2026-10-13. User-authorized precommit audit of cumulative changes from `a4489ce`. Reviewed the R08 check manifest and referenced requirements/specs, including untracked backend/protocol files. No daily Chrome profile, bookmark, installed extension or native window was touched by this reviewer. Main session owns commit, archive, documentation consolidation and final native acceptance.

## Finding and fix

**P1: undoing a created folder could delete descendants added afterwards.** `crates/core/src/editing/mod.rs`, `inverse` / `Mutation::Create`, checked only the created node's fields. The protected-node check rejected managed/fixed descendants but permitted ordinary newly added descendants. The inverse emitted a folder `Delete` without `expectedSubtree`; the extension's existing folder-delete path then called `removeTree`. A current source revision did not prevent this when the external child was already synchronized before undo review.

This logic was present before the redesign diff. It violates the retained R06 AC4 contract that conditional undo preserves external changes, so it was corrected within that approved scope after the main session independently checked the evidence.

Pure-planner reproduction used synthetic nodes: root `0` -> bookmark bar `1` -> `created-folder`, with an original successful empty-folder create receipt; a later `external-child` was added below that folder. Calling the production `editing::plan` for undo returned:

```text
external_child_present=true conflicts=0 affected=1 steps=1 recursive_delete=true expected_subtree_present=false
```

An assertion that external children must be preserved failed (exit 101). There was no Chrome execution. The temporary standalone Rust probe was removed; the permanent regression below preserves the reproducer in the test suite. Initial standalone linking needed a fresh Cargo library build and Cargo-reported dependency/native-library paths; those compiler issues were test-instrumentation issues, not product failures.

The minimal correction checks the current simulated working tree: if any child remains below the created folder, the inverse reports an existence conflict and does not emit that folder delete. Legal inverse steps belonging to the same operation still run in reverse simulation order, so a created folder emptied by undoing its own moves remains undoable. An empty-folder delete includes `expectedSubtree` containing only the expected folder, making the existing extension guard reject children added after planning. No DTO/schema, persistence, UI or user-script change was required.

Independent follow-up review identified the final browser-side race: a child may arrive after `getTree` returns but before deletion. The extension now uses `chrome.bookmarks.remove` when a folder's reviewed subtree contains only that folder; real recursive deletes still use `removeTree`. Chrome's documented `remove` contract accepts a bookmark or an empty folder, providing a nonrecursive final guard. API rejection follows the existing conservative uncertain result without retry or error-text inference. See [official Chrome remove contract](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#method-remove); local Chrome type declarations also document the same distinction. The mock port was corrected to reject nonempty-folder `remove`, and a second race test inserts a child after the tree snapshot is returned. It first reproduced the unsafe `applied` result, then passed after the executor correction while preserving the child.

Changed files:

- `crates/core/src/editing/mod.rs`: reject nonempty inverse-created-folder deletion and bind the expected empty subtree.
- `crates/core/src/editing/tests.rs`: test a later external bookmark, nested external folder, and successful empty-folder undo with the emitted subtree precondition. Existing create-then-move undo regression remains green.
- `apps/extension/src/executor.ts`: use the nonrecursive API for a folder reviewed as empty; retain recursive deletion for a reviewed multi-node subtree.
- `apps/extension/src/executor.test.ts`: a child added after empty-folder review yields `CONFLICT`, zero mutation calls and retained child data; an empty-folder control succeeds. A child added after `getTree` is protected by nonrecursive removal, preserving the tree and reporting the existing uncertain result.

The permanent Rust test was run before the correction and failed at `conflict.steps.is_empty()` (exit 101, `precommit-undo-folder-red.log`). After the correction all 16 editing tests passed (`precommit-undo-folder-green.log`). The initial 12 executor tests passed (`precommit-undo-extension.log`). The added post-`getTree` race produced two failures before the API correction (the empty-folder API choice and the race result), then all 13 executor tests passed; see `precommit-undo-extension-atomic-red.log` and `precommit-undo-extension-atomic-green.log`.

## Audit scope

- Traced trusted main-window command guards, remote preview capability boundaries, preview session clearing, app-data isolation and native export capture/save/atomic replace paths. New commands retain `trusted(window)` before effects. Save destinations remain Rust-owned; failed replacement preserves an existing target.
- Reviewed daily batch planning, parent/child deduplication, protection of fixed/managed descendants, claimed plan/epoch/revision/hash, pre-send forward/inverse frame checks, snapshot plus backup before dispatch, sequential receipt-driven dispatch, timeout/late receipt/cancel/restart stopping and per-item status.
- Reviewed undo snapshot lookup, profile/epoch rejection, deleted-descendant reads, restored identity mapping, sidecar restoration epoch filters and conditional sibling-order simulation.
- Reviewed parameterized library SQL, current profile/epoch filtering, stable pagination/revision checks, bound text/tag intersections and narrow page materialization.
- Reviewed AI initial-request unique cancellation registration, retained pre-subscription cancellation, ownership-safe registration release and stale result checks.
- Reviewed Rust and TypeScript wire `expectedSubtree` validation, generated types/schema/static validators, newly added local DTO parsers and paired desktop/extension compatibility notes.

No other substantiated blocking defect was found in this audit scope. This is not a claim to have rerun all original fault injections or native scenarios.

## Fresh verification

| Check | Result | Evidence |
|---|---|---|
| Protocol generation | PASS, exit 0, `node scripts/protocol.mjs --check` | `precommit-backend-protocol-direct.log` |
| Initial protocol wrapper | Environment failure: pnpm global engine-store lock inaccessible in sandbox; direct identical script passed | `precommit-backend-protocol.log` |
| Rust formatting after fix | PASS, exit 0 | `precommit-backend-fmt-final.log` |
| Clippy workspace/all targets after fix | PASS, exit 0 | `precommit-backend-clippy-final.log` |
| Changed extension test lint | PASS, exit 0 | `precommit-backend-lint.log` |
| Extension TypeScript | PASS, exit 0 | `precommit-backend-typecheck.log` |
| Editing regressions | 16 PASS | `precommit-undo-folder-green.log` |
| Executor regressions, final | 13 PASS | `precommit-undo-extension-atomic-green.log` |
| Full Rust after fix | PASS, exit 0: 147 tests (116 core + 17 desktop + 14 protocol), 3 existing ignored diagnostics | `precommit-backend-rust-final.log` |
| Full workspace lint after executor fix | PASS, exit 0, `pnpm lint` | `precommit-backend-full-lint-final.log` |
| Full workspace typecheck after executor fix | PASS, exit 0, `pnpm typecheck` | `precommit-backend-full-typecheck-final.log` |
| Full frontend/protocol/scripts after executor fix | PASS, exit 0, `pnpm test`: 180 Vitest tests + 6 script tests | `precommit-backend-full-tests-final.log` |
| Web/extension build and asset scan | PASS, exit 0, `pnpm build`; existing large-chunk notices remain warnings | `precommit-backend-build-final.log` |

Before the correction the fresh full Rust run passed 146 tests after escalation. Its initial sandbox run failed only the two Windows credential-store tests; the escalated rerun passed with isolated test namespaces (`precommit-backend-rust-native.log`). Those are separately preserved from the after-fix run.

## Evidence freshness and remaining native gate

At audit entry the executable was independently hashed as `804d920746f677cb257d8efdf6589a77a70bbf346e162dd6f68803197db63910`, 24,054,272 bytes, timestamp 13:40:07 UTC. Backend/protocol/extension source timestamps preceded that build, matching the frozen R07/R08 evidence. This correction changes Rust product source, so that executable and its native receipts are now **pre-fix historical evidence**, not evidence of the corrected executable.

Main session rebuilt/scanned the corrected Rust executable and reported hash `4a7f12fe8928caade0d154ec00f0557ea8f944d07f4ac7ad4e72bbdb9f5168aa`; main owns that build log and receipt. This reviewer rebuilt/scanned the final extension and independently computed its directory hash as `365f16a030afb78d83cbe914bc42784b7f086bb846ab035ba2f4a8a30ed331a5` using the existing native-driver hashing convention. The independent native reviewer was notified that both artifacts are ready and owns the focused native undo scenario on isolated app data/Chrome. Protocol generation had passed before the local logic change; no protocol source or generated contract changed in the correction. Existing actual-sleep WAIVED/NOT_RUN, legacy V04 UNVERIFIED and external synchronization/model-quality limits remain unchanged.
