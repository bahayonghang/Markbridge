# G03 automated verification

2026-10-25. Full automated checks PASS on the lock-aligned ordinary-directory runtime. B10K scroll comparison is prepared but awaits the coordinated quiet window; native evidence is owned separately.

| Check | Current result |
|---|---|
| Lint | PASS, zero warnings |
| TypeScript | PASS desktop, extension, protocol, tools |
| Vitest | 272/272 PASS, zero failed |
| Node test runner | 35/35 PASS, zero failed/skipped/cancelled |
| Protocol drift | PASS, fresh Rust schema exporter matches tracked outputs |
| Web build | PASS protocol TypeScript + desktop Vite + extension Vite |
| Production artifact scan | PASS chunk size, MV3 permissions, no maps/dynamic code/known secrets/absolute paths |
| Full browser suite | 231/231 PASS, zero failed/skipped/flaky;20 files,288735ms |
| Screenshot review |14 current screenshots manually inspected, all7 sizes represented; no new visual finding |

## Reproduction and boundaries

`node .trellis/tasks/10-25-mb-g03-glass-acceptance/automated-run.mjs` invokes the same executables/arguments as package scripts without pnpm's broken-link autorepair. The exact12 commands, durations and exit codes are in `automated/results.json`; stdout/stderr logs and machine-readable Vitest/Node results are retained. PATH prepends Rust1.99.0 toolchain bin and CARGO_TARGET_DIR is the ordinary `runs/airy-glass-rust-target`. Project manifests and lockfiles were not changed.

Browser command: `node node_modules/@playwright/test/cli.js test --config .trellis/tasks/10-25-mb-g03-glass-acceptance/validation.config.mjs --output test-results/glass-g03-full --reporter=json`, with command-local MARKBRIDGE_DEV_PORT=14941 and absolute MARKBRIDGE_EVIDENCE_DIR ending in G03/evidence/browser-full. Local Edge headless, one worker, isolated browser context, current application Vite on loopback. The config records only the required port override, never the complete process environment.

Final consuming states are checked by appearance/airy suites with ancestor alpha and saturation composition, unknown-background rejection, text≥4.5 and controls/focus≥3/2px. Full suite retains the seven-size layout, hidden24/120 anchors, checkbox/keyboard/focus, source/draft/confirmation, export outcomes and explicit-call boundaries. Supplementary fallback emulation remains browser evidence; actual OS settings integration is not inferred.

Manual screenshot entries and SHA-256 hashes are in `automated/screenshot-review.json`. The inspected set includes minimum20px complete bookmark row, low-height dark detail, organize scope, disabled semantic review, wide12px unknown/failed history, pending connection identity, narrow settings, dark20px AI, cached output well, saved export, forced colors, font actions and solid confirmation. No ticket secrets are shown.

Source/config/spec inputs were frozen before the automated pipeline in `automated/source-inputs.json`; helper hashes and counts are in `automated/receipt.json`. Native build, native search and actual DPI remain separate. No product source, permission, installation, daily Chrome profile, commit, archive or publication was changed by this automation worker.
