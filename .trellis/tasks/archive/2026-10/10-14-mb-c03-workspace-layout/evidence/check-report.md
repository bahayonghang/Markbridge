# C03 independent check — 2026-10-14

Conclusion: **AC-C03-1–4 PASS for this child's browser/layout scope.** No unresolved product finding remains. The main session may advance to C04; this review does not establish current-source native/DPI/performance acceptance or authorize delivery actions.

## Scope and source identity

Read the complete task hook context, child PRD/design/implementation plan, check.jsonl references, root DESIGN.md, parent requirements/design/verification and frontend component/state/appearance/quality contracts. Compared accepted C02 `before/source.json` against C03 `current-source.json`: the only changed production files are `styles.css` and `LibraryWorkspace.tsx`. The latter changes only the folder/detail buttons' classes, spans and accessible labels; state ownership, subscriptions, source/query/selection/draft handling, export portal and IPC are unchanged.

- Accepted C02 production fingerprint: `5ad3791d1bdb11d6f837dfa2da1cd38c38b3b1fb16739dbe5bae304872678373`.
- Reviewed C03 production fingerprint: `e199c0aa19a0e3560f398831d5a0297ce532ff443be706767f009770d3f69311`.
- Final `styles.css` SHA256: `7b96739c6d372f5615a8e8e58b1e57877df8478fbcd0c1557b0442b80699ebf6`.
- Final `LibraryWorkspace.tsx` SHA256: `39a593100f8f5741a5b16e766b227f6cdd40700e35814d2150d4d3b6815e1f60`.
- Reviewer-added `workspace-layout-review.spec.ts` SHA256: `641105bc0ee648306348e50dc112164f8908ce45af061722fb184c4abce9bec4`. This test was added after the current-source inventory; the production fingerprint remains unchanged.

## Findings (fixed)

- File: `tests/e2e/workspace-layout-review.spec.ts`.
  - Issue: the first independent test expected the existing synthetic query `Guidelines` to match one item, but the fixture correctly contains four matching titles. Both initial cases failed at that assertion before the draft/export flow.
  - Fix: wait for the truthful `已加载 4 / 4 项` status; preserve the exact first bookmark identity for selection/draft assertions. No product behavior or test tolerance changed. [Initial log](check-browser.log) is retained; [rerun](check-browser-rerun.log) passes both cases.
- File: `.trellis/spec/frontend/component-guidelines.md`.
  - Issue: the initial review still found the old connection-only960px threshold.
  - Fix: coordinated with the implementation owner, who synchronized the960px/64rem connection threshold,600px/40rem settings rows,1040/1440 widths, detail clamp and low-window rules. Quality guidelines and DESIGN.md are synchronized too.
- File: `apps/desktop/src/styles.css`.
  - Issue: concurrent implementation/review inspection identified that the narrow folder overlay's former32px bottom could overlap the larger20px status bar.
  - Fix: the implementation owner changed it to the caption line plus padding/border with a32px minimum. Final matrix assertions compare the actual overlay/footer bounds and verify Escape focus return. The checker made no product edits.

## Findings (not fixed)

None in C03 scope. Current-source native Windows rendering, actual125/150%DPI, native restart/IPC integration and B10K timing are intentionally C04 gates, not inferred from browser fixtures. Old13/V12 and15/V18 remain outside this acceptance.

## Independent verification

| Check | Result | Evidence |
|---|---|---|
| Final `pnpm lint` |PASS, exit0|[check-lint-final.log](check-lint-final.log)|
| Final `pnpm typecheck` |PASS, exit0|[check-typecheck-final.log](check-typecheck-final.log)|
| `pnpm exec playwright test tests/e2e/workspace-layout-review.spec.ts --workers=1 --reporter=line` |2 passed,5.9s, exit0|[check-browser-rerun.log](check-browser-rerun.log)|
| `git diff --check` |PASS, exit0|No whitespace errors|

The independent cases use640×480,20px, local system font, light/dark and the existing `sources` mock. They verify keyboard Enter/Escape through the directory replacement, checkbox focus/selection, a searched bookmark's unsaved note, history→settings export portal, source-switch confirmation with focused/reachable cancellation, Escape return to the source selector, and preserved source/query/selection/note after returning to the library. Closing detail returns focus to its visible trigger. The mock business-call log is empty in both cases; no mock save/export/model/fetch/write was invoked.

Receipts: [light](check/layout-review/light-20-minimum.json), [dark](check/layout-review/dark-20-minimum.json). Visually inspected [minimum confirmation](check/layout-review/light-20-minimum-source-confirm.png) and [restored dark library](check/layout-review/dark-20-minimum-restored.png); the confirmation actions are readable/reachable and the restored first selected row is fully visible. Also inspected the implementation's minimum General/library and2549×1356 dark connection screenshots.

## Implementation evidence reviewed

The [implementation receipt](implementation-receipt.md) and raw logs retain failures and their corrections. Unit tests passed272 Vitest plus25 Node; final build passed. The broad ten-suite run passed165/167, with two export-edge assertions failing at0.325px fractional clipping. The final51-case layout/shell run passes the entire affected set using actual scroll-ancestor bounds with the established1 CSSpx tolerance; it includes those two cases plus the new expanded-filter keyboard case. The other117 broad cases were not rerun after the final folder-overlay CSS change. This is168 unique passing implementation browser cases across runs, plus the two independent cases here, not one170-test run.

The preserved baseline has32 fixture/theme/size cases with ten views each; final counterparts use the same fixtures/viewports. Seven window sizes cover light/dark14/20px, with12px at minimum/wide. Additional routes include first-run/read-only setup; existing regressions cover long source names, empty/loading/error/read-only states, full history review, uncertain/failed results, and forbidden implicit calls.

| Acceptance | Conclusion |
|---|---|
| AC-C03-1 |PASS: common tokens remain;1040px forms,1440px connection/history, available-width library and312–400px detail measured. No decorative card expansion or state refactor.|
| AC-C03-2 |PASS: seven-size matrix, font-sensitive container thresholds, scroll/whole-document bounds, detail header separation and20px minimum-window keyboard/action/full-row usability.|
| AC-C03-3 |PASS: existing regression evidence plus the independent minimum-window source/query/selection/draft/export/focus flow; no business owner or IPC changed.|
| AC-C03-4 |PASS: matching before/after fixtures and viewport/size captures; required empty/loading/read-only/error/unknown/long-text scenarios retained. Browser evidence is labeled as such.|

No commit, archive, installation, daily Chrome/profile modification, font installation, signing or publication was performed by this review.
