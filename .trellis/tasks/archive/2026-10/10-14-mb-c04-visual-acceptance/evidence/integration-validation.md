# C04 automated and browser integration — 2026-10-14

Conclusion: **automated/browser integration PASS**, including one final full207-test green run. Scope: current-source automatic checks, full browser integration, evidence reuse audit and stable verification guidance. Native runtime, actual monitor DPI, restart, permission and B10K receipts are owned by the main session. This report does not mark C04 or its parent accepted before those receipts and independent review complete.

## Source and changes

- Product fingerprint: `e199c0aa19a0e3560f398831d5a0297ce532ff443be706767f009770d3f69311`, unchanged from accepted C03. No production file was changed by this integration worker.
- Initial complete-source fingerprint: `9c45b89fc6f234119f5758c1a0f5f8bbbac480fe6669e92f6e228c35a18ac3c4`. [Initial source audit](automated-source-audit.json) matched all436 source/build/test inputs. Two browser-test corrections below subsequently changed test hashes only; [final source](final-source.json), complete fingerprint `4ebf3ca21a44355750944559305c663008a9916d94455a265f783848934af89b`, binds them separately from the native build inputs. The [final436-input audit](automated-source-final-audit.json) has zero mismatches.
- Changed tests: `tests/e2e/browse.spec.ts` measures classic-scrollbar thickness using comparable integer dimensions; `tests/e2e/workspace-layout-review.spec.ts` waits for navigation's specified heading focus before exercising detail Escape.
- Updated `.trellis/spec/frontend/quality-guidelines.md` to require complete input manifests, unchanged-file evidence reuse and preserved failed attempts. No state, font service, DTO, native capability, CSS, virtual-row geometry or business behavior was changed.
- [Runner](automated-run.mjs) uses the existing pnpm commands,2 browser workers and command-local evidence paths. Raw logs and JSON reports are preserved in unique directories. It checks the accepted C03 input hashes before and after each stage; the full browser file list is separately recorded in [the command ledger](automated-run-1791991954215/result.json).

## Executed checks

| Check | Result | Evidence |
|---|---|---|
| `pnpm lint` |PASS, exit0; also passes after final test corrections|[initial](automated-run-1791991954215/lint.log), [final](automated-lint-final.log)|
| `pnpm typecheck` |PASS, exit0; also passes after final test corrections|[initial](automated-run-1791991954215/typecheck.log), [final](automated-typecheck-final.log)|
| `pnpm test` |PASS,272 Vitest +25 Node, exit0|[test log](automated-run-1791991954215/test.log)|
| `pnpm protocol:check` |PASS, exit0; all generated contracts match current Rust|[protocol log](automated-run-1791991954215/protocol.log)|
| `pnpm build` |PASS, exit0; desktop/extension build and production artifact checks|[build log](automated-run-1791991954215/build.log)|
| Initial full `pnpm test:e2e --workers=2 --reporter=line,json` |205 passed,2 failed,0 skipped,162.7s, exit1|[log](automated-run-1791991954215/browser.log), [machine report](browser-run-1791991954215/playwright-report.json)|
| Two affected suites,3 cases repeated10 times |30 passed,0 failed/skipped/flaky,28.3s, exit0|[log](automated-targeted-1791992450.log), [machine report](browser-targeted-1791992450/playwright-report.json)|
| Final full207-case browser integration |207 passed,0 failed/skipped/flaky,147.2s, exit0|[log](automated-browser-final.log), [machine report](browser-final-1791992450/playwright-report.json), [summary](automated-browser-summary.json)|
| C02 backend reuse audit |PASS, all19 recorded file SHA256 values unchanged|[reuse audit](automated-backend-reuse.json), [C02 receipt](../../10-14-mb-c02-font-preferences/evidence/backend-validation.md)|
| `git diff --check` |PASS, exit0 after final receipt edits|[final log](automated-diff-check-final.log)|

The unchanged backend audit supports reuse of C02's desktop35 + protocol16 Rust tests, Clippy/fmt, real DirectWrite/GDI census and generated adapter checks. Two ignored native metadata probes were separately executed in C02. None is counted as a newly rerun C04 Rust suite. The current `pnpm test` still executes Rust-backed cross-language protocol fixtures, and `protocol:check` invokes the current schema exporter.

## Failed attempts and corrections

1. The old classic-scrollbar test subtracted integer `clientHeight` from floating-point `getBoundingClientRect().height` and required exactly16. At the new14px default the observed difference was16.390625. The corrected test subtracts `clientHeight` from `offsetHeight`, still requiring exactly16. Its long-path keyboard/scroll checks and selection/cancellation row-Y invariance remain unchanged; no product tolerance was loosened.
2. The light20px640×480 independent review sent Escape immediately after focusing the close-detail button while `App.navigate` still had its existing animation-frame heading-focus callback pending. The error context retained the open detail pane; dark mode and earlier independent runs passed. The test now first waits for the navigation heading to be focused, then focuses and verifies the close button before the same Escape/return-focus assertions. Ten repeated light/dark runs passed after this synchronization correction.
3. The first scrollbar correction exposed a TypeScript `HTMLElement | SVGElement` narrowing error for `offsetHeight`. [The failed typecheck log](automated-typecheck-after-tests.log) is retained. An explicit HTMLElement guard fixes the test typing; final lint/typecheck pass. This guard does not change the tested layout.

No failed result above was rewritten as PASS, no case was skipped, and the original assertions of complete row visibility, action reachability, source/query/selection/draft retention and forbidden implicit business calls remain present.

## Browser coverage and visual evidence

The full suite's18 files produced792 screenshots and92 JSON files (including the Playwright report and runner state). It covers General/default entry and directed settings routes, first-run setup, five settings categories, bookmark/tree/detail views, organize reviews, semantic disabled/loading/error states, populated operation history and export cancellation. Tests exercise ordinary/hover/pressed/selected/focused/disabled/loading/error/unknown states and necessary confirmation copy. Appearance is tested at all seven requested viewports in light/dark12/14/20px. The C03 matrix additionally measures1040/1440px limits,312–400px detail width, font-aware row/connection thresholds, sticky heading/tab separation, full rows, scroll-ancestor bounds and low-window action access.

Current appearance measurements contain40 actual rendered text/control/focus combinations per theme, in addition to19 token combinations per theme. Minimum observed rendered text contrast is4.547959(light) /5.346641(dark), above4.5. Minimum rendered boundary/focus contrast is3.929899(light) /3.892913(dark), above3. These are computed consumer colors, not palette-token-only claims. [Light](browser-final-1791992450/appearance/light-contrast.json), [dark](browser-final-1791992450/appearance/dark-contrast.json).

Visual inspection used current-production screenshots for light20px General at1100×760 and640×480, dark20px font-picker bottom actions at640×480, dark20px connection at2549×1356 and dark20px minimum library. Settings rows stack with readable explanations, picker actions remain reachable, wide forms retain reading margins and the minimum library shows one complete row. These are synthetic browser fixtures, not proof of an installed font or a live Chrome connection. Final full-run counterparts are kept in [browser-final-1791992450](browser-final-1791992450).

Before/after comparison reuses C03's preserved [32-case baseline](../../10-14-mb-c03-workspace-layout/evidence/before/workspace-layout) and [matching final screenshots](../../10-14-mb-c03-workspace-layout/evidence/final/workspace-layout), with10 views per theme/size case and the same fixtures. The final C03 product fingerprint matches this C04 product. No archived or earlier evidence was overwritten.

## Parent verification handoff

| Parent item | This worker's evidence and remaining layer |
|---|---|
| V02 |Current computed colors, real consuming interaction states, captions and confirmations; browser PASS cases in full report|
| V03 |Ordinary General entry, directed shortcuts, first-run, vertical keyboard categories, Tab/Shift+Tab and cancel focus; tests retain one source/bridge owner|
| V04 |C02 real302-family DirectWrite/GDI census may be reused after19-file hash check; main current native census/glyph checks remain separate|
| V05–V07 |Font-picker fixtures,1000-family bounded DOM, missing/empty/failure/late catalogs, v1/v2 normalization/storage/reset, all size formulas and actual computed geometry|
| V08 |24/120-row middle/bottom/hidden anchors, checkbox/keyboard, dirty notes and source/query/selection retention; main native120-row run is separate|
| V09 |All requested views/sizes and long/loading/read-only/error/unknown fixtures, bounding-box and scroll access checks|
| V10–V12 |Browser no-implicit-effect checks supplement, but cannot replace main's current native calibrated IPC/81-command denial/no font-network, new-PID/glyph and actual125/150%DPI receipts|
| V13 |Full business regression suite covers search/edit review/source switch/organize review/semantic disabled/history/export cancellation; main native basic loop remains required|
| V14 |No browser timing is used as a native B10K result; main owns the unchanged p95≤200ms method and quiet-machine run|

The main session's [current native integration receipt](native-validation.md) is separately available:13 controls,42 screenshots,8 actual DPI combinations, real fonts/glyphs, real OS-save cancellation,81 remote-preview command denials and new-PID restart on executable `8c1f59be4ea553b32e0eed1df3f167e0cfd19c7136b1b31734c3254317c56bbc`. Its retained first attempt and corrected harness are not browser results. B10K and independent final review remain main-session responsibilities.

The user's supplied screenshot has no verifiable executable identity, so that original binary remains UNVERIFIED. Source and this build's General/settings behavior are independently verifiable; no assumption of a stale installation or broken deployment is made. Daily application/Chrome profiles, installed extensions/fonts and historical receipts were untouched. Old13/V12,15/V18 and the original parent remain incomplete. No commit, archive, journal, installer, signing, publishing or push was performed.
