# R05 implementation report

## Approved design and implementation boundary

Plain CSS reuses the existing blue workspace tokens, Segoe/Chinese system fonts, 7px controls and cardless detail surface. Information, local metadata and content are separate tabs; multi-selection exposes common operations only. Content preview mounts only in the visible content tab. Existing browser edit/receipt recovery remains available.

Draft policy recorded before implementation: local note/tag input remains mounted across detail tabs, close/reopen and workspace section navigation. Changing selected identity, folder/query/filter scope or source requires explicit discard or continuing the current edit. Save success clears only the submitted draft, never text entered while a save is pending. External refresh does not overwrite dirty notes. Already-confirmed local changes still invalidate the original source's queries even if selection changes before completion.

## Implemented behavior

- Information contains full title/URL/path and truthful bookmark-cache timestamp. IDs/revision are secondary diagnostics. Single-item edit, batch edit and receipt recovery retain the R04 entry points.
- Metadata is explicitly local. Offline notes and tags use SQLite; title encoding remains folded, explicitly enabled, and requires a full before/after review before apply. Catalog management is folded separately. Mixed selection shows common metadata, never a stale single-item edit/content pane.
- Drafts are preserved while hiding details or switching tabs. Row/keyboard selection, folder navigation, Ctrl+End, filters, source change, new and batch actions have explicit leave handling. Real pointer focus-before-click cannot bypass the queued selection action.
- Content is lazy-mounted. Closed/hidden panels do not fetch; closing or changing identity cancels pending work. Request identity and generation reject late A/B results. Text is rendered as React text, safe raster images retain their existing guard, and cache time uses the existing fetchedAt DTO. Profile offline status is not treated as network failure; backend network fallback policy is unchanged.
- Content, webpage status and AI controls remount when the observed source epoch changes. AI busy state recovers on selection change; stale generation/apply/undo results cannot affect the current selection. Confirmed local saves still invalidate their original source's metadata query.
- Full-page controls retain the independent preview-* window architecture and selected/current URL distinction. Session/privacy controls are secondary disclosures. No remote page is embedded into the application DOM.
- Detail tabs remain reachable while scrolling. At widths below 1100px or heights at most 550px, the open detail view hides the list toolbar so the minimum window has useful content space. Long URL/text surfaces scroll independently without document horizontal overflow.

## Necessary identity safeguard

Independent review identified that local tag commands resolved the current source epoch at execution, so an old note could otherwise target a reused Chrome ID after an identity reset. The parent approved the minimum correction: optional expectedSourceEpoch on tag_state, tag_command, preview_title_encoding and apply_title_encoding IPC. Bridge validates this under the same lock held through the storage/planning work. Existing Rust entry points and omitted IPC arguments remain compatible; the product UI always passes its known expected epoch.

TagDesk requires a known epoch and a loaded catalog for that epoch before mutation. Dirty input pins its original epoch, survives CONFLICT and offers explicit discard. A new epoch cannot reuse a clean old note while the new catalog loads. Late tag_state/mutation responses cannot publish into the new identity. External metadata refresh also invalidates displayed and pending title diffs, requiring a fresh review.

No protocol/schema/database migration, new state framework, public-fetch policy or Chrome write path was introduced. The independent check agent also added main WebView data-directory isolation under the existing explicit MARKBRIDGE_APP_DATA test override; the main session owns its native acceptance.

## R05 files

Product implementation:

- apps/desktop/src/features/library/LibraryWorkspace.tsx
- apps/desktop/src/features/tags/TagDesk.tsx
- apps/desktop/src/features/preview/ContentPreview.tsx
- apps/desktop/src/features/preview/useContentPreview.ts
- apps/desktop/src/features/preview/WebPreview.tsx
- apps/desktop/src/features/ai/AiSuggest.tsx
- apps/desktop/src/styles.css
- apps/desktop/src/backend.ts
- apps/desktop/src-tauri/src/main.rs (tag/title IPC only owned here; startup isolation owned by check agent)
- crates/core/src/bridge/tags.rs

Meaningful regressions:

- library/library.test.tsx: draft keep/discard/navigation, hidden content, multiple selection, epoch-bound content lifecycle.
- tags/tags.test.tsx: offline metadata, retained typing during save, late A/B/A save, initial/new-epoch read gate, server CONFLICT, late epoch read, catalog refresh invalidating reviewed title diffs.
- preview/preview.test.tsx and web-preview.test.tsx: debounce cancellation, cached text/time safety, visibility/disclosure expectations.
- ai/ai.test.tsx: 20 pending A/B requests, preserved confirmed metadata invalidation, stale undo receipt isolation.
- crates/core/src/bridge/tests.rs: source reset with reused Chrome ID/revision, stale metadata/title read/write rejection, fresh offline save and old identity metadata preserved.
- tests/e2e/details.spec.ts and mock-bridge.ts: five window sizes, local tags/notes, focused draft dialog, literal cached text, overflow and multi-selection.

## Validation and evidence

Product frozen after the following final targeted checks on 2026-10-13:

| Check | Result | Evidence |
|---|---|---|
| R05 targeted Vitest (5 files) | PASS, 64 tests | test-identity-rerun.log |
| TypeScript | PASS | typecheck-epoch-rerun.log |
| ESLint | PASS | lint-final.log |
| cargo fmt --all -- --check | PASS | terminal result; no formatting drift |
| cargo test --workspace | PASS, 135 tests; 3 pre-existing opt-in integration tests ignored | rust-final.log |
| Rust reused-ID epoch regression | PASS | rust-epoch.log |
| Earlier full frontend + script suite | PASS, 148 Vitest + 6 script tests; before final identity safeguards | test-final.log |
| Earlier full browser suite | PASS, 45 tests; before final identity safeguards and final short-height polish | e2e-polish.log |

Final independent full lint/typecheck/test/build/protocol/e2e checks are owned and recorded by the check agent. Real Windows/Chrome/preview-* acceptance is owned and recorded by the main session. Those gates are not claimed complete by this implementer report. No native completion is inferred from compilation.

All screenshot runs use MARKBRIDGE_EVIDENCE_DIR=.trellis/tasks/archive/2026-10/10-12-mb-r05-details/evidence/screenshots. The five r05-details-{size}.png views were inspected; final screenshots after identity safeguards and the short-height polish will be inspected from the independent rerun. Prior task evidence was not overwritten.

## Failures retained and resolved

Initial and subsequent failed logs are retained, not replaced by success logs. Initial frontend failures included old tab/disclosure navigation assumptions, a void-return mock, and source-query invalidation/draft target issues; the product issues were fixed and verified. Browser failures exposed textarea accessible-name association and native focus-before-click selection; both were fixed and the 45-test rerun passed. Later epoch test failures were fixture issues (invalid non-ASCII IDs, unopened disclosure, and a publication without an active metadata query), corrected while retaining the failure logs. typecheck-epoch.log records a missing test import, fixed in typecheck-epoch-rerun.log. test-epoch.log records the sandbox package-store lock denial; authorized reruns used the installed package manager successfully.

## Remaining acceptance ownership

Main session: real offline metadata/Chrome-title preservation, 20 A/B IPC transitions, five native sizes, preview-* commands/session isolation/navigation/focus and final task receipts. The explicitly deferred actual OS sleep/wake acceptance remains due before R08 completion; this implementation does not waive it.
