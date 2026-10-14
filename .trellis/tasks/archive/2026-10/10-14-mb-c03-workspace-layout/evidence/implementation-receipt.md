# C03 implementation receipt — 2026-10-14

Self-validation and the independent review's targeted checks are complete; task acceptance is owned by the main session. No commit, archive, installation, font installation, real Chrome mutation or publication was performed.

## Source and scope

- Before product fingerprint: `5ad3791d1bdb11d6f837dfa2da1cd38c38b3b1fb16739dbe5bae304872678373`, preserved in [before/source.json](before/source.json). This is the accepted C02 source.
- Final product fingerprint: `e199c0aa19a0e3560f398831d5a0297ce532ff443be706767f009770d3f69311`, [current-source.json](current-source.json).
- Product changes: `apps/desktop/src/styles.css` and two toolbar buttons in `LibraryWorkspace.tsx` (presentation spans/classes/accessibility names only).
- Tests: `tests/e2e/workspace-layout.spec.ts`; documentation: root `DESIGN.md`, frontend component and quality guidelines. Existing C01/C02 work is preserved.
- No state ownership, IPC, schema, font metrics, model/index/search logic or asynchronous lifecycle changes.

## Layout delivered

Settings forms have a1040px maximum, connection/history data1440px, and library details grow from312px to400px via26vw. Connection columns require both960px and64rem; settings rows stack at600px or40rem. Settings descriptions align to the top of their controls; the precise-size input remains100px instead of inheriting a full-width declaration.

At narrow widths, folder/detail controls use accessible icon buttons. In low windows the toolbar can scroll internally while retaining at least one full76px row at20px/640×480. Expanded filters remain reachable by Tab. The directory overlay clears the actual growing footer, and sticky detail tabs clear their control-height heading. Small history panes stack actions and differences; hidden summary labels stay inside their positioning context instead of expanding document bounds.

## Checks

All commands used repository pnpm12.12.0 from an escalated local runner because the sandboxed pnpm process stalls in this environment. The runner only used local browser fixtures and build/test outputs.

| Check | Result | Evidence |
|---|---|---|
| Before matrix, `workspace-layout.spec.ts` with `MARKBRIDGE_LAYOUT_PHASE=before` |32 passed,57.3s, exit0|[before/workspace-layout](before/workspace-layout),320 screenshots plus32 geometry records|
| Before state/onboarding/long-source subset from shell/appearance/settings-layout/connection |23 passed,8.9s, exit0|[before/states](before/states)|
| `pnpm lint` |PASS, exit0|ESLint apps/packages/scripts/tests, zero warnings|
| `pnpm typecheck` |PASS, exit0|Workspace TypeScript plus tools project|
| `pnpm test` |272 Vitest and25 Node tests passed, exit0|[unit-validation.log](unit-validation.log)|
| `pnpm build` after final product edit |PASS, exit0|[build-final-validation.log](build-final-validation.log)|
| Ten browser suites, including the then38-case C03 matrix |165 passed,2 failed, exit1; failures retained and resolved below|[browser-validation.log](browser-validation.log)|
| Final39-case C03 matrix +12 shell tests |51 passed,0 failed,72.7s, exit0|[layout-final-validation.log](layout-final-validation.log), [final/workspace-layout](final/workspace-layout)|
| Independent minimum-window review |2 passed, exit0; final lint/typecheck passed|[check-browser-rerun.log](check-browser-rerun.log), [check-lint-final.log](check-lint-final.log), [check-typecheck-final.log](check-typecheck-final.log)|
| `git diff --check` |PASS, exit0|No whitespace errors|

The ten-suite command covered workspace-layout, shell, settings-layout, details, organize, semantic, history, appearance, connection and font-picker. The final51 reran the entire affected layout/shell set, including the two failed cases; the other117 browser cases passed in the broad run and were not repeated after only the directory/footer CSS adjustment. This is168 unique passing browser cases across runs, not a claim of one168-test green run.

The independent reviewer added two further cases in `workspace-layout-review.spec.ts`: light/dark20px640×480 directory Escape focus, preserved note/query/selection through history/export portal, source-switch cancellation and no implicit mutation calls. Its first fixture assertion expected one Guidelines result, whereas the existing fixture has four; the corrected expectation passed. The original [check-browser.log](check-browser.log) is retained and no product change was made for that test correction.

## Preserved failures and corrections

1. The first32-case after matrix had16 failures from populated history causing whole-document vertical overflow. Baseline JSON already showed this issue (for example14px640×480 document height670). The offscreen absolute visually-hidden labels lacked a local positioning context. `position: relative` on the history summary contains them; the final matrix checks document height and all populated history states.
2. A focused20px640×480 check measured only72.25px of list height against a76px row. Low-window list top padding changed from12px to8px, while icon controls prevented the toolbar's extra line. The final matrix checks both list height and the first row's full intersection, rather than screenshots alone.
3. The broad run's two failures were light/dark14px1100×480 export-button intersection ratios of0.991876. The last button was within0.325px of a clipped subpixel edge. The final check verifies the actual button against every scroll ancestor with the existing1 CSSpx fractional tolerance, plus a positive viewport intersection. This is a measurement correction, not a hidden/disabled action waiver.
4. Static/self review found the directory overlay's fixed32px bottom would overlap the20px footer. Its bottom now follows the caption line plus padding/border with a32px minimum. The final minimum-window matrix compares overlay bottom against the footer's measured top and verifies Escape focus return.

Initial after screenshots remain in [after](after); intermediate focused screenshots remain in [after-final](after-final). Final acceptance screenshots are in [final](final). Broad regression/state screenshots remain in [verified](verified). No baseline or prior C02 evidence was overwritten.

## Acceptance coverage and limits

- AC-C03-1: one existing token system;1040/1440 widths and detail clamp measured, space/readability rules applied without adding decorative card structures.
- AC-C03-2: all seven viewports light/dark14/20px,12px minimum/wide, plus20px first-run at minimum/medium/wide; max/min bounds, reading/control separation, no whole-page overflow, full bookmark row and action reachability asserted.
- AC-C03-3: prior shell/details/settings/history/organize/semantic/font-picker regressions passed, including drafts, selection, source/query, portal export, keyboard/focus and forbidden implicit call checks. The independent reviewer adds its own minimum-window flow.
- AC-C03-4: same32 fixture/theme/size cases before and after,10 views each. Existing fixtures cover empty/loading/read-only/error and long/pending sources; populated history includes unknown/partial/failed/conflict states. No fixture was promoted to native evidence.

Manual image review included1100×76020px General before/after,640×48020px library and history,2549×1356 AI/connection, and the dark startup-error screen. Large text now stacks settings controls and the smallest library shows a complete row; wide pages retain deliberate reading margins.

Current-source Windows native screenshots, actual125/150%DPI and B10K integration remain C04 responsibilities. These browser results do not replace native verification, old13/V12,15/V18, or any external/model acceptance.
