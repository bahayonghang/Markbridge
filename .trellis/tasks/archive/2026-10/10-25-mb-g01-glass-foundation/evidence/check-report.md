# G01 independent check — PASS

2026-10-25. Scope: G01 only. G02 may start; current Windows executable, actual DPI, complete workspace matrix and performance acceptance remain G03 requirements.

## Findings fixed

- `apps/desktop/src/styles.css`: forced-colors selected labels were unreadable white blocks in screenshots despite the old material-only assertions passing. Selected controls now use system Highlight/HighlightText with inherited `forced-color-adjust:none` scoped to those selected surfaces. Normal themes remain under automatic forced-color adjustment. `tests/e2e/airy-glass.spec.ts` now checks selected controls and nested labels for rendered contrast, inherited adjustment, and the focus ring. The before screenshots remain in `check-browser/airy-glass`; corrected screenshots are in `check-forced-colors-assertions/airy-glass`.
- Task-owned `research/validation.config.mjs` copied the complete process environment into Playwright reports. It now passes only the port and resolves the repository from the working directory. Existing task reports `browser-results.json` and `research/baseline-performance-results.json` had their recorded environment maps reduced to task variables; assertion data and result counts are preserved. No archived evidence was changed.

## Acceptance

| Criterion | Verdict | Evidence |
|---|---|---|
| AC-1 design source, backup and one token system | PASS | Root DESIGN explicitly documents dark/font/geometry adaptations; original catalog and original DESIGN/style backups retained. `check-receipt.json` records comparison with HEAD. |
| AC-2 field and one paper, solid inner content, narrow fallback | PASS | Material tests at light/dark 1440, 959, 960 and 640 widths; computed layer count at most one; rows/dialogs without blur; screenshots inspected. |
| AC-3 public state and composed contrast | PASS | `appearance.spec.ts` rendered default/hover/selected/pressed/disabled/error/focus/confirmation consumers; controlled field endpoints and intermediate samples, alpha and `saturate(1.15)` composition. Unknown background/filter paths fail explicitly. Text >=4.5, control/focus >=3, focus >=2px. |
| AC-4 fallback branches | PASS (browser) | Narrow material boundary, emulated reduced transparency, synthetic unsupported-filter branch, reduced motion/keyboard activation, and corrected forced colors. No claim that Windows transparency settings propagate to WebView2. |
| AC-5 original preferences/geometry/navigation | PASS | Existing appearance/captions/shell cases include system/fixed themes, v1/v2 storage, fonts and sizes, hidden anchors, focus/checkbox behavior and minimum-window large text. Production TSX, preference metrics and VirtualRows are unchanged. No new business call path. |

## Verification

- Lint: PASS. `node node_modules/eslint/bin/eslint.js apps packages scripts tests eslint.config.js playwright.config.ts vitest.config.ts --max-warnings 0`, rerun after the local fix.
- TypeCheck: PASS. `node node_modules/typescript/bin/tsc -p <project>` for desktop, extension, protocol and tools; tools rerun after the regression assertion change.
- Unit: fresh PASS 272/272, zero failed, in `check-vitest-results.json`. Command: `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.trellis/tasks/10-25-mb-g01-glass-foundation/evidence/check-vitest-results.json`; process PATH prepended the Rust 1.99 toolchain bin, and `CARGO_TARGET_DIR=runs/airy-glass-rust-target`.
- Browser: fresh PASS 87/87 before the forced-colors-only CSS correction, in `check-browser-results.json`. `node node_modules/@playwright/test/cli.js test --config .trellis/tasks/10-25-mb-g01-glass-foundation/research/validation.config.mjs tests/e2e/appearance.spec.ts tests/e2e/shell.spec.ts tests/e2e/appearance-captions.spec.ts tests/e2e/airy-glass.spec.ts --reporter=json`; task-local `MARKBRIDGE_EVIDENCE_DIR=evidence/check-browser` (absolute).
- After the forced-only fix: PASS 2/2 via the same command limited to `airy-glass.spec.ts --grep forced-colors`, in `check-forced-colors-assertions-results.json`, screenshot root `evidence/check-forced-colors-assertions`. The intermediate forced-only run without the new assertions is preserved separately.
- Baseline: main session reran the five frozen pre-change cases successfully, in `research/baseline-recheck-results.json`. The three-round baseline B10K recordings already exist in `research/baseline-performance`; after-change budget evaluation is G03.
- Runtime: Node v26.7.0, Playwright 1.64.0 with local Edge headless and an isolated browser context, Vite loopback port14935, one worker. Direct CLI entries replace broken pnpm dependency-link traversal. Copied `node_modules/@markbridge/protocol/src` matches current `packages/protocol/src` byte for byte.
- Final inputs: SHA-256 entries in `check-source-fingerprints.json`; machine summary in `check-receipt.json`.

## Findings not fixed / limits

No unresolved G01 defect. This report does not establish G02 or G03 acceptance. Actual native restart, installed fonts/glyphs, calibrated IPC, 125/150% Windows DPI, current ordinary-search performance and the final B10K comparison are NOT_RUN here. No commits, archives, installs, publishing or daily Chrome changes occurred.
