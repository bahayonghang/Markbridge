# R07 implementation handoff

2026-10-13. Product ownership handed to the independent R07 checker after focused tests. Main session owns native harnesses, final receipt/task status and specification consolidation. This report records implementer evidence, not final native acceptance.

## Result

- Added persistent `OrganizeWorkspace`: explicit current-selection or chosen-folder scope, full validated cached subtree reuse, exact bookmark count, and maintenance / AI folders / single suggestion tabs. Switching app sections preserves results and running checks. A new explicit scope clears unconfirmed review. Existing engine limits remain visible (maintenance 1000, organization 900); no silent truncation of the applied scope.
- Moved single-item AI from the detail content area into broad main-area review; detail now links to Organize. Added settings and operation-history navigation without replacing the library tree or metadata draft state.
- Maintenance now permits cancellation while a link request is pending, ignores late canceled/old-revision responses, shows URLs and Chinese verdicts (unknown remains unknown), and separates keeper selection, preview and destructive confirmation. Old unconfirmed cleanup cannot become executable after a revision change. Removed its redundant legacy summary/note search controls because R03 already provides that search in the library.
- AI shows configured endpoint/model and exact sent categories/limits before generation. Disabled AI starts no model task. Settings retain the uncontrolled secret input, clear it before awaiting credential storage, and use the workbench form layout.
- Confirmed AI apply/undo disables cancellation and keeps truthful pending copy; own Chrome revisions do not discard the returned operation. New `OperationNotice` follows the exact returned operation ID to observed terminal state and links to history. Offline paired sources can still save local AI tags/summary, while title changes and title undo remain disabled.
- Organization accepts an optional caller request ID so initial generation can be canceled before its job response (Rust implementation owned by main). Plan reads and generation reject stale responses. Plans become invalid after directory revision changes, while confirmed operation receipts remain reviewable. Pending apply cannot falsely claim cancellation; known applied jobs offer stop-remaining semantics. Receipt ranges use the backend's exclusive `end`, counting steps rather than range objects.

## Files owned by implementation

- `apps/desktop/src/features/organization/OrganizeWorkspace.tsx` (new), `OrganizationDesk.tsx`, `organization.test.tsx`.
- `apps/desktop/src/features/maintenance/MaintenanceDesk.tsx`, `maintenance.test.tsx`.
- `apps/desktop/src/features/ai/AiDisclosure.tsx` (new), `AiSuggest.tsx`, `AiSettings.tsx`, `ai.test.tsx`.
- `apps/desktop/src/features/history/OperationNotice.tsx` (new).
- `apps/desktop/src/App.tsx`, `features/library/LibraryWorkspace.tsx`, `library.test.tsx`, `backend.ts`, `styles.css`.
- `tests/e2e/organize.spec.ts` (new) and `mock-bridge.ts` test-only fixture extensions.
- This report and `implementation-boundary.md`.

Main separately updated Rust initial organization cancellation and its regression, task design/manifests, native harnesses. No protocol output/DTO, migration, executor, provider or public-fetch permission change was required by the frontend.

## Checks actually run

| Check | Evidence | Result |
|---|---|---|
| First pnpm typecheck attempt | `implement-typecheck-first.log` | Blocked before checking by workspace sandbox access to pnpm's external engine-store lock. Retried through normal approval. |
| pnpm typecheck | `implement-typecheck-retry.log` | PASS, before final added regression/E2E files. Final complete gate belongs to checker. |
| Initial four-file focused Vitest | `implement-focused-first.log` | 39 PASS, 1 FAIL: migrated AI regression queried nonexistent tree name `文件夹树`. Existing tree is `文件夹`; corrected test to wait for the existing folder treeitem. |
| Focused Vitest retry | `implement-focused-second.log` | 50 PASS across AI, organization, maintenance and library. Includes canceled late generation, confirmed apply/undo across own revision, readonly local-only metadata, maintenance cancellation/unknown/stale, organization initial cancellation/stale/read-only/write and range-count regressions. |
| pnpm lint | `implement-lint-first.log` | PASS. |
| New E2E / rendered screenshots | `tests/e2e/organize.spec.ts` | NOT_RUN by implementer at handoff; independent checker owns seven tests including all five required sizes, result retention, running-check cancellation, stale/offline review. Set MARKBRIDGE_EVIDENCE_DIR to this R07 task. |
| Native model/Chrome/save/security interactions | Main task harnesses | NOT_RUN by implementer. Fixture/native/real-model evidence must stay separate. |

Protected user scripts verified unchanged after this implementation:

- `scripts/foundation.test.mjs`: `d2c071af73e77d4f0d8bdb9df21261c04e18e91cdf4d5ffe2efb77bcc15bf9c2`.
- `scripts/tauri-dev.mjs`: `85c01c27be3da42e4f09d155e2b8159c532d87cb3ccbe81978d1aca278108140`.

## Review and remaining work

Visual direction uses the already approved restrained blue workbench: existing system fonts, white broad working surface, neutral disclosure strip and 1px rules. No shadow-card grid, external assets, new dependency or additional theme. Source data is validated live/cache DTO content; synthetic values exist only in tests.

Checker must complete final static/build/full unit/E2E gates and inspect rendered five-size screenshots. Main must complete actual isolated native interaction and remote-command denial checks and record build hashes. Configured real local model acceptance remains distinct from a deterministic Ollama-compatible HTTP fixture. No commit, archive, installation, publish or daily Chrome mutation was performed.
