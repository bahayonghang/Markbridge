# G03 final independent check — PASS

2026-10-25. G03 AC-1–AC-6 and parent R1–R8/AC1–AC8 are supported by current evidence. The accepted native search rerun passes the unchanged gate; the initial failure and its unexplained variance remain part of the result. This verdict authorizes no commit, archive, installation or release.

## Findings fixed

No product defect or production change required by this final review. Documentation now reflects current evidence rather than initial NOT_RUN planning statements. The quality spec records the corrected modal measurement model; UI-preference acceptance links now point to this current task.

The native harness correction was reviewed critically: an open `dialog:modal` occupies the top layer and escapes background settings/list clipping ancestors. Stopping traversal at that modal corrects the test model. The final helper retains viewport and modal/internal clipping checks with the same1 CSSpx tolerance, and additionally requires the action center to hit the control or its descendant. The initial failure, screenshot and original helper remain preserved. No geometry threshold or product behavior was weakened.

## Integrated criteria

| Coverage | Verdict and current evidence |
|---|---|
| G03 AC-1; parent R1–R6 / AC1–AC6 / V02–V09 | PASS. Full231-case browser suite covers the controlled mint/lavender field, one paper, both themes, system/fixed preferences, font/size storage, all seven viewports, real scroll ancestors, sticky surfaces, hidden24/120-row anchors, drafts, keyboard/focus and confirmations. Alpha plus saturation composition checks actual default/hover/selected/pressed/disabled/error/focus/dialog consumers; unknown backgrounds fail explicitly. Reduced-transparency/no-filter/reduced-motion/forced-color checks are separate browser branches. |
| G03 AC-2; parent R8 / AC8 / V12 | PASS. Current locked runtime: lint, four TypeScript projects,272/272 Vitest,35/35 Node, protocol drift, web builds, artifact scan and231/231 browser tests across20 files. Zero failed/skipped/flaky in the accepted full browser run. Counts and command exits match machine reports. |
| G03 AC-3; parent R7 / AC7 / V10 | PASS with retained search failure. Same-machine/browser/script three-round B10K scroll comparison: light7.0→7.1ms within9.0ms budget; dark7.1→7.1ms within9.1ms. Current DOM at most17 rows, one blur layer, no row filters. Native search first30-sample run p95=208.6ms FAIL; one unchanged-method fresh-root strict quiet rerun p95=149.2ms PASS under200ms. Both distributions are retained; cause of variance UNVERIFIED, no performance-fix or long-term stability claim. |
| G03 AC-4; parent R2/R5/R7 / AC2/AC5/AC7 / V03/V07/V08/V11 | PASS. Current release executable33b9a601… runs real Windows/WebView2. Normal exit and PID51940→85720 restore dark/installed-font/20px preferences and actual glyph mapping. Eight cases use actual monitor120/144DPI with matching1.25/1.5 DPR, light/dark20px at1100×760 and640×480. Native font preview/apply/cancel, focus, last actions, complete row, drafts, hidden anchor and bottom behavior pass. |
| G03 AC-5; parent R8 / AC8 / V12 | PASS. Real IPC observation calibrated by explicit get_bridge_state; subsequent appearance activity contains only expected local reads. No implicit generation/content fetch/index/Chrome write or remote-font request. Actual export Save dialog cancellation is truthful. Remote preview denies exactly all81 registered commands. Disposable roots only; all owned processes/listeners absent after normal close. |
| G03 AC-6; parent V01 and final traceability | PASS. Parent verification maps V01–V12 to actual receipts and records both failed attempts. G01/G02 stage checks remain separate from final acceptance. Product source and build inputs match the tested native/automated states; only two documentation-only spec updates follow the automated snapshot. Old13/V12,15/V18 and original parent remain unfinished. |

## Evidence binding and manual review

- [Automated report](automated-report.md), `automated/results.json`, `automated/receipt.json`, `browser-full-results.json`: all current checks pass. This review verified the recorded counts, successful command exits and helper identities without repeating already passing suites.
- [Native report](native-report.md), `native-build-receipt.json`, `native-summary.json`, `native/run-1792930130353-bc46d593/result.json`: current25,621,504-byte executable SHA256 `33b9a6014b6da98555090f56fd30dcf0050f8ad75488e2981aba61fa5b414732`; original artifact, copied tested executable and fixture seeder hashes match their receipts. Native13 controls and42 screens support the functional verdict.
- `check-input-audit.json` captures21 task/reused-helper dependencies, including task13 driver/probe/window/system and transitive archived R01/R02/R08 helpers. `check-final-input-audit.json` rechecks that closure, all440 native source inputs, all217 runtime package versions against the frozen-lock integrity audit,14 manually reviewed screenshot hashes, four compressed trace hashes and exact81-command denial coverage. No mismatch.
- The464-file automated snapshot has only post-run changes to `frontend/quality-guidelines.md` and `frontend/ui-preferences.md`: modal-measurement documentation and current-evidence ownership. No production/test/build input changed. Final documentation hashes are recorded separately; outcome metadata, independent-check checkboxes and later journals are excluded to avoid circular fingerprints.
- The265-file pre-change extracted baseline matches its frozen archive; the archive content also matches HEAD2ac7979 for its captured paths. This confirms that scroll comparison used the actual prior styling.
- Independently inspected current screenshots: actual144DPI dark20px640×480 font-picker bottom actions, actual120DPI light20px640×480 complete bookmark row, and current browser forced-color selected labels. All are readable; controls and solid reading/dialog surfaces remain clear. The broader14-image review covers all seven sizes and is hash-checked above.

## Findings not fixed / limits

No unresolved defect within the approved glass-refactor scope. The Windows transparency-setting bridge remains NOT_VERIFIED; browser emulation proves the CSS branch, not OS integration. Native search rerun max=242.5ms includes one sample above200ms while its specified p95 passes; the earlier run had two such samples and failed. Neither run establishes a maximum-latency or stability guarantee, and no cause or fix is claimed.

Real-model acceptance, browser mirror writes, installer delivery, other platforms, signing and publication were not exercised here. Historical startup observations and old model gates are unchanged. Initial environment failures, the modal-test-model failure and both search runs remain available. No commit, archive, installation or daily Chrome change occurred.
