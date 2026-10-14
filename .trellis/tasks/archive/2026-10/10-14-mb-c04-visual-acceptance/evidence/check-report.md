# C04 independent integration check — 2026-10-14

Conclusion: **AC-C04-1–5 and parent AC-P1–8 PASS within the approved appearance/font/layout scope.** The additional startup measurement fails the historical≤3s threshold in two of six samples and remains an open finding. The approved ordinary-search p95≤200ms gate passes in both current runs. This is not a claim of full performance acceptance or release readiness.

## Scope and identity

Read the complete saved hook output, C04 PRD/design/implementation plan/check manifest, parent requirements/design/verification, root DESIGN and the applicable frontend/backend contracts. Reviewed C01–C03 check reports, their evidence reuse limits, current font service/DTO/adapter, preferences, picker lifecycle, shared geometry and layout tests. The reviewer owns this report and has made no product changes.

- Product fingerprint: `e199c0aa19a0e3560f398831d5a0297ce532ff443be706767f009770d3f69311`.
- Native build SHA256 independently rehashed by the reviewer: `8c1f59be4ea553b32e0eed1df3f167e0cfd19c7136b1b31734c3254317c56bbc` (25,627,648 bytes), matching the current native build log and raw result.
- The comparable product fingerprint excludes end-to-end tests. C04 additionally records root Cargo/build inputs and tests in `completeSourceFingerprint`; subsequent test-only corrections must retain their own final fingerprint rather than rewriting earlier receipts.

## Findings (fixed)

- File: `native-integration.mjs` (coordinator-owned).
  - Issue: first run `native/run-1791992232007-8daa54be/result.json` failed while filling the hidden library search after opening detail in the narrow replacement layout. The product correctly hides that toolbar.
  - Fix: coordinator closes detail through its visible return button before changing the query. The confirmation/cancel/draft assertions remain. First failure and cleanup evidence are preserved; the full rerun passed all13 native controls.
- Files: `tests/e2e/browse.spec.ts`, `tests/e2e/workspace-layout-review.spec.ts` (implementation-owned).
  - Issue: first integrated browser run passed205/207. One scrollbar assertion mixed fractional DOMRect height with integer clientHeight; another sent Escape before the navigation's scheduled heading-focus transition completed.
  - Fix: use `offsetHeight - clientHeight` for the strict16px classic scrollbar check; wait for the heading focus before focusing close detail and asserting Escape returns to its trigger. An explicit HTMLElement guard then corrected a TypeScript narrowing error in that test. No product behavior or acceptance tolerance changed. Original failures remain in `automated-run-1791991954215/browser.log` and `automated-typecheck-after-tests.log`. Thirty repeated affected cases and the final207-case full suite passed, with no skipped or flaky cases.

## Findings (not fixed)

No unresolved static product finding was found. One runtime finding remains deliberately unfixed:

- Evidence: [first B10K receipt](current-performance-c398f6c2-77d8-4e79-99ca-4ac546530e08-receipt.json), [same-method repeat](current-performance-0681df82-d2a0-479c-bf47-392d7e2d634e-receipt.json).
  - Issue: current executable startup samples4605.9ms and4552.3ms exceed the retained3000ms threshold; both complete performance receipts correctly remain **FAIL**. The repeat's slow sample is its third startup, so this is not established as first-use initialization.
  - Evidence limit: most observed delay precedes CDP target discovery, but the cause remains **UNVERIFIED**. These observations cannot establish an application regression or an instrumentation defect by themselves.
  - Why not fixed: determining the startup cause requires a separate, controlled investigation of application/WebView/OS/discovery timing. Changing startup code or its acceptance threshold would be a judgment call outside this appearance/font/layout task. The approved C04 AC3 and parent V14 specifically require ordinary-search p95≤200ms, which passes; no startup gate is waived or relabeled. Keep this finding open and investigate before claiming the old complete V06 startup/search gate for this executable. Historical task13 receipts and state remain unchanged.

Static contracts checked:

- `list_installed_fonts` verifies the trusted main window before dispatching the blocking DirectWrite worker. The native collection excludes downloadable fonts; no path, file bytes or arbitrary input crosses IPC. Windows dependencies remain target-scoped and locked. Preview capability/CSP, SQLite and extension protocol are unchanged.
- Rust-owned metadata has bounded names/counts and Windows ordinal family deduplication. Generated schemas, TypeScript and standalone Ajv feed an unknown-response validator. Error states are stable and do not expose native paths/errors.
- App still owns preferences and the library remains mounted. General owns the session catalog; explicit open/refresh, single-flight generations and StrictMode lifecycle prevent eager enumeration and stale UI updates. Candidates are applied only after confirmation. Missing-font status requires a successful catalog.
- v1 remains read-only; v2 invalid/unknown records normalize without startup writes. Installed names become one escaped CSS string with a fixed local fallback. All12–20px inputs, root typography and virtual rows use one metrics function. No zoom or whole-library font measurement was introduced.
- The native harness uses actual window movement, `GetDpiForWindow`, WebView DPR and physical client dimensions. It contains no device-metrics override. Actual glyph mapping uses `CSS.getPlatformFontsForNode`, not a CSS family string or `document.fonts.check`. New-PID restart requires normal exit and the same isolated main-WebView store. Remote preview commands are enumerated from the real command registry.
- The B10K harness retains the actual Rust-seeded10,000-bookmark fixture, excluded warmup plus30 measured searches, monotonic input-to-visible-operable-result timing and next-frame recheck. p95 uses `sorted[ceil(n*.95)-1]` and remains≤200ms; the retained three-startup checks remain≤3000ms. No mock delay, subtraction or reduced threshold replaces native timing.

## Verification

- Lint: **PASS**, independent `pnpm lint`, exit0; [log](check-lint.log).
- TypeCheck: **PASS**, independent `pnpm typecheck`, exit0; [log](check-typecheck.log).
- Whitespace: **PASS**, independent `git diff --check`, exit0.
- Automated unit/protocol/build gates: **PASS**, reviewed the actual command ledger and logs for272 Vitest +25 Node tests, protocol generation and build. Current backend reuse audit matches all19 C02 inputs; comparison of all406 C02/C04 common files independently confirms that only `styles.css` and presentation-only `LibraryWorkspace.tsx` changed after C02. Rust35 desktop +16 protocol and Clippy/fmt are explicitly reused, not claimed as newly rerun C04 suites.
- Browser: **PASS**, final machine report records207 expected,0 unexpected,0 skipped and0 flaky,147.164s. The earlier205/207 and targeted30-pass runs are retained. Final test files passed the implementation worker's lint/type-check after the two test corrections; independent reviewer lint/type-check above preceded those test-only corrections.
- Native/DPI/restart/permission: **PASS**, current raw [result](native/run-1791992355705-19b666c5/result.json),13 controls and42 screenshots. Details below.
- Native B10K search: **PASS** against approved V14, two separate30-sample runs. Independent recomputation gives p95/max142.8/145.7ms and149.8/161.4ms. Additional startup check: **FAIL**, two complete receipts remain FAIL, as detailed above and in [performance validation](performance-validation.md).

Visually inspected the current browser minimum light20px General view and wide2549×1356 dark14px connection view. The minimum view has a bounded internal settings scroll region and legible classification/controls; the wide connection page uses the1440px content limit with aligned source/setup columns. Browser images do not prove native fonts or DPI.

## Independent native and source receipt audit

The successful native result binds the accepted product fingerprint and frozen build-time complete fingerprint `9c45b89fc6f234119f5758c1a0f5f8bbbac480fe6669e92f6e228c35a18ac3c4`. Independently rehashed every recorded final-source input: all406 common plus30 additional files match [final-source.json](final-source.json), complete fingerprint `4ebf3ca21a44355750944559305c663008a9916d94455a265f783848934af89b`. Against the frozen build manifest, only the two corrected e2e files differ. Product code and the executable remain unchanged.

- Windows11 Pro / WebView `Edg/155.0.4283.45`, copied executable in a fresh temporary root,122 synthetic nodes. Both real main-WebView process observations point to that root's `app-data/main-webview/EBWebView` with matching parent PID and creation identity.
- DirectWrite returns302 families. Actual Arial Latin39 glyphs and CJK11 fallback glyphs are recorded; YaHei supplies both sample scripts and restores its CJK glyphs after restart. Native12/14/20px rows match40/40/48 folder and52/56/76 bookmark geometry. Hidden middle anchor, draft, selection, last row and checkbox checks passed.
- Actual displays `DISPLAY1`144 DPI/DPR1.5 and `DISPLAY2`120 DPI/DPR1.25 each cover light/dark,1100×760 and640×480 CSSpx,20px installed YaHei. Physical dimensions are respectively1650×1140/960×720 and1375×950/800×600. All eight cases have measured reachable reset/apply/confirmation controls. No scale override or OS scaling change was used.
- Inspected native dark144-DPI minimum font-picker, light120-DPI minimum library and light144-DPI minimum confirmation screenshots. Candidate sample and both bottom actions are legible; the library shows a complete76px row; confirmation copy and actions stay inside the viewport.
- Independently compared the current `generate_handler!` registry to raw preview outcomes: exactly81 unique commands, none missing or extra, every result `DENIED`, including `list_installed_fonts`. Calibrated appearance observation contains only `list_installed_fonts`, `cache_query`, `tag_state` and `cache_get`; remote font requests are0.
- First PID124380 exits0; new PID117400 restores dark/installed-YaHei/20px from the same store and exits0. Both known WebView identities are absent afterward; final owned process/listener arrays are empty. Native v1 fixtures retain12/13/15 and original bytes without startup writes; reset affects only v2; synthetic missing font preserves the choice and uses actual local fallback.
- History→export uses the real OS Save dialog and yields the truthful cancelled state. No export file, installation, daily Chrome mutation or font installation was part of the run.

Reviewed the original parent's nine-line execution-plan appendix: it only registers the new font command and C04 verification entry points, preserving original13/V12,15/V18 and historical evidence/status. New task status/acceptance recording remains the coordinator's responsibility.

## Independent performance audit and scope

Recomputed p95 directly from each raw30-sample search array with the existing nearest-rank formula. Both arrays satisfy200ms without discarding any formal sample; the warmup remains separate. Raw reports match the current executable/product/build-time fingerprints, B10K11004-node shape and methodVersion2. All eight application launches across the two probes exited0 with no owned process/listener remainder; both reports have zero page errors.

All six formal startup values are preserved:4605.9/735.2/728.0ms and1108.5/1090.5/4552.3ms. The historical13 receipt's788.4/633.6/728.6ms applies only to its earlier executable. No result here establishes current full legacy V06 acceptance. The approved new parent V14 states “普通搜索B10K原有p95≤200ms门槛不降低”; C04 AC3 similarly names ordinary-search p95. Therefore the two successful search distributions satisfy the actual new gate while the separate startup failure remains explicitly open. No blanket “all performance checks passed” statement is supported.

## Acceptance mapping

| Criterion | Independent conclusion and evidence |
|---|---|
| AC-C04-1 |PASS: current evidence covers approved V02–V14, with browser/mock/native layers separated and the additional startup failure explicitly retained. Final207-case report, native13-control result and two passing search distributions match the current product.|
| AC-C04-2 |PASS: actual120/144 DPI with matching DPR/physical sizes, eight theme/size cases, real font glyphs and new-PID persistence; all bind executable8c1f59be.|
| AC-C04-3 |PASS: all81 commands denied in real preview, calibrated expected read-only IPC only, zero remote fonts, and both native search p95 values below200ms. This does not assert the additional startup check passed.|
| AC-C04-4 |PASS: supplied screenshot identity remains honestly UNVERIFIED; current source/executable General behavior is established. No daily installation or old13/15/historical evidence rewrite.|
| AC-C04-5 |PASS: same-fixture before/after layout evidence, current full browser measurements, native screenshots/results, current source/executable hashes, independent review and stable frontend/backend specs are present.|
| AC-P1 |PASS: General default and directed settings/first-run routes are covered by full browser integration; native current executable opens General. Older screenshot identity is not inferred.|
| AC-P2 |PASS: current real302-family catalog, C02 unchanged local metadata cross-check, current actual glyphs plus search/keyboard/apply/cancel/refresh/failure/virtualization regressions.|
| AC-P3 |PASS: pure12–20 formula tests, exact legacy12/13/15 and current12/14/20 measurements,120-row native anchors/drafts/bottom/checkbox and minimum-window reset reachability.|
| AC-P4 |PASS: read-only migration, malformed/unknown/storage-denial fixtures, explicit v2/reset isolation, actual missing-font fallback and new-process persistence.|
| AC-P5 |PASS: final rendered contrast has40 consumer measurements per theme; text minima4.547959(light)/5.346641(dark), control/focus minima3.929899/3.892913, with0 failed comparisons. Semantic states, captions, confirmations and preserved Markbridge brand are covered.|
| AC-P6 |PASS: seven viewport layout matrix and full207 browser cases include minimum20px, real native DPI minimum-window reachability, history/export cancel, editing/organization reviews and ordinary search.|
| AC-P7 |PASS: exact registry/preview denial-set equality, calibrated four allowed read commands only, zero network fonts, and metadata-only DTO review.|
| AC-P8 |PASS: current executable actual125/150%DPI and fresh PID evidence; original13/V12 and15/V18 remain incomplete. The additional current startup failure is carried separately, not hidden by this acceptance.|

The coordinator may record the approved C04/parent scope as accepted, with the startup finding linked as unresolved. This reviewer did not change task state or grant commit/archive/install/publish authorization.

The supplied screenshot's executable identity remains **UNVERIFIED**. Original13/V12,15/V18 and their parent are outside this task; no missing-model or non-Windows acceptance is inferred. No commit, archive, installation, daily Chrome/profile or font modification, signing, push or publication was performed by this reviewer.
