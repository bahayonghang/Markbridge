# G03 current Windows native evidence

2026-10-25. Current executable native functional acceptance PASS; the renewed strict quiet-window search run passes the fixed p95 gate. Prior failures remain visible below. This receipt does not close the legacy13/V12,15/V18 or original parent.

## Current build and source

- Executable: `runs/airy-glass-native-target/x86_64-pc-windows-msvc/release/markbridge-desktop.exe`,25,621,504 bytes, SHA256 `33b9a6014b6da98555090f56fd30dcf0050f8ad75488e2981aba61fa5b414732`.
- `native-build-receipt.json`: release build, host/PE architecture and existing artifact path/credential scans PASS; current Rust fixture seeder build PASS. Rust1.99.0 and the frozen-lock217-package root runtime were used. No installer, signing, install or daily Chrome change.
- Task command: prepend the raw Rust1.99 toolchain bin to the process PATH, then `node .trellis/tasks/10-25-mb-g03-glass-acceptance/evidence/native-build.mjs`. It calls the existing `nativeReleaseContext`, `assertNativeHost` and `inspectNativeArtifact` contract. Environment adaptation is confined to a task-only Tauri config replacing beforeBuildCommand with direct Vite CLI and using the root Tauri CLI; production source/config is unchanged. The managed target link was not repaired.
- `native-source.json` binds source/build inputs; `native-build-input-audit.json` compares437 shared pre-build G02 inputs without drift. Three source-art/document/build-convenience entries omitted from the G02 fingerprint are separately captured, without a pre-build claim; actual app icons, manifests, locks, code and tests match. `native-summary.json` rechecks all440 current source entries unchanged and fingerprints the task harnesses. Reused driver/helper closure hashes belong to the final independent check.

## Native functional PASS

Current run: `native/run-1792930130353-bc46d593/result.json`,13 controls PASS, screenshots alongside it. Command: `node .trellis/tasks/10-25-mb-g03-glass-acceptance/evidence/native-integration.mjs`.

- Real Rust-seeded disposable122-node cache; app data, WebView directories, exe/PID/listener ownership guarded by the existing current-native driver. No daily browser data or extension was used.
- Real DirectWrite font enumeration cross-checked against a fresh read-only System.Drawing inventory; actual Latin/CJK glyph mapping, candidate-only preview, cancel/apply/focus and missing-font local fallback were observed. The tested canonical families are Arial, Microsoft YaHei UI and SimSun; this is not an exhaustive catalog validation.
- Shared12/14/20px row metrics, hidden120-row anchor, bottom preservation, drafts, checkbox focus and keyboard reveal PASS.
- Eight real existing-monitor cases at GetDpiForWindow120/144 (125%/150%), matching devicePixelRatio, light/dark20px at1100×760 and640×480. Settings last action, font-picker action, full bookmark row and confirmation were reachable; the owned window moved between existing monitors without changing OS scaling.
- IPC observation calibrated with explicit `get_bridge_state`; appearance/navigation caused no implicit model, content fetch, index, Chrome write or remote-font request. Actual export Save dialog cancel remains truthful. Remote `preview-*` denied all81 registered commands.
- Actual normal process exit and new PID51940→85720 preserved dark/installed-font/20px preferences and actual glyph rendering; v2 reset and read-only legacy12/13/15px migration PASS. All owned processes/listeners absent after normal close.
- Native media supports backdrop-filter and reports reduced-transparency:no-preference. The Windows transparency-setting bridge is NOT_VERIFIED; no OS-switch response is claimed.
- Manually inspected current actual-DPI small-window dark library, light font-picker action, dark cancel-first confirmation and the earlier top-layer failure screenshot. Controls/text are readable, dialog/list backgrounds solid and actions visible.

## Retained functional failure and correction

`native/run-1792930019448-038bd533/result.json` failed `NATIVE_ACTION_CLIPPED` at a DPI font dialog; its screenshot shows the action fully visible. The copied historical reachability helper incorrectly treated background settings-scroll ancestors as clippers of a native `dialog:modal` top-layer element. The corrected task helper stops ancestor clipping at that modal, retains viewport and modal clipping checks, and adds an actual center `elementFromPoint` hit-test. The initial script is preserved as `native-integration-attempt1.mjs`. No product code or acceptance tolerance changed. The current native rerun passes all8 DPI cases with the stronger hit-test.

## Ordinary-search performance

Command: `node .trellis/tasks/10-25-mb-g03-glass-acceptance/evidence/native-performance.mjs`. Both runs use the same current executable, Rust-seeded B10K11004-node/10000-bookmark fixture, real WebView2 UI, one excluded warmup and30 measured searches. Timing starts immediately before the input event and ends only after exact loaded1/1 result, no loading state and an animation-frame recheck. The threshold stayed p95≤200ms; sorting/percentile definition and input/paint interval are unchanged. Startup observations are supplementary and do not revise historical startup acceptance.

| Run | p50 | p95 | Max | Fixed gate |
|---|---:|---:|---:|---|
| initial `6c9eb871-0862-4c42-8ddb-5bb87860ddc9` |102.4ms|208.6ms|257.7ms|FAIL|
| identical fresh-root strict quiet rerun `743eda0d-b839-43b8-90ba-d5d8e5a1990c` |106.9ms|149.2ms|242.5ms|PASS|

Both complete30-sample distributions, warmup, exact exe/source fingerprints, OS/WebView/machine, ownership proofs and normal-close receipts remain in their `current-performance-*-receipt.json` files and in `native-summary.json`. The second run was explicitly sequenced after all other agent build/check/file-scan workloads were held. No focus override, throttle flag, product code, threshold or sample definition changed. Initial variability cause remains UNVERIFIED; this evidence establishes the current controlled run, not a performance fix or a claim that every individual query is≤200ms. Both runs have zero page errors and verified normal cleanup of all four launches.

## Limits

Native browser mirror writes, real models, installer delivery, other OSes, signing and publishing were NOT_RUN. Browser scroll comparison and full automatic results are separate G03 evidence owned by the automated checks. Final independent review decides the integrated G03 gate using these current receipts and retained failures.
