# Canonical just ci — PASS

Accepted attempt7 ran the repository's unmodified `just ci`, all12 original recipes in order, exit0,397.9s. No CI/justfile/product source, project manifest, lock, assertion or threshold changed.

## Results

Frozen-lock install, lint,4TypeScript projects, web build/artifact scan, protocol drift, JS/Node tests, Rust fmt, all-targets workspace clippy with -Dwarnings, Rust workspace tests, canonical native release/scan, genuine Playwright Chromium installation, and complete e2e:12/12 PASS.

Vitest272 passed; Node35 passed; Rust195 passed/0failed/5existingignored; Playwright231 passed/0failed/skipped/flaky on actual repository config/default12workers. Browser was newly downloaded Chromium156.0.8078.4, not the earlier task Edge config. Runtime audit found217 installed package versions/integrity metadata matching the frozen lock. Protocol copy195files/0byte differences. CI460input snapshot/inflight audit has0drift. Full stage counts and raw-log SHA are in receipt.json.

## Explicit environment adaptation

Default pnpm dependency links fail Windows os448/untrusted mount point. Fresh junction/symlink probes reproduce the limitation without system changes. Hoisted/no-link/PnP trials and original failures remain preserved. PnP's CJS-only loader plus normal copies still failed undeclared/ESM resolution; it was not accepted.

The accepted run uses the pre-audited ordinary-directory dependency tree as externally materialized modules. Command-local pnpm_config_enable_modules_dir=false executes genuine pnpm install --frozen-lockfile with lock/policy verification but suppresses writes to node_modules. pnpm_config_verify_deps_before_run=false prevents automatic dependency rewrites before scripts. All12 commands still run normally. Original217 packages were backed up/restored and re-audited; workspace protocol and app-local Tauri CLI are same-version ordinary copies. Stale generated child .bin wrappers were reversibly moved, then npm rebuild --ignore-scripts --no-audit --no-fund regenerated stock package entry wrappers. No fake pnpm/just/test shims were used. Project/global config and locks remain unchanged.

This is full canonical CI against an explicitly externally supplied locked environment, not proof that this host can do a fresh default symlink installation. Official references: [modules directory](https://pnpm.io/settings/node-modules#enablemodulesdir), [environment configuration](https://pnpm.io/configuring#environment-variables). Exact flags/provenance are in environment.json; failures remain in attempt-history.json and raw logs.

Raw Rust1.99.0 PATH and ordinary runs/airy-glass-native-target were used, without repairing the managed target link. Current CI/Vite/browser processes exited. No application install, daily Chrome change, commit, archive, signing or publishing was performed by this checker.

## Current native artifact

Canonical stage10 uses unmodified scripts/native-build.mjs and normal pnpm build hook. The25,621,504-byte executable SHA256 is661468a8bb210e4cf6bcacfd0f1e63874e0ce47baf0291d8e2f5e7f2728ae84b, distinct from the historical task-override33b9a601 build. native-build-receipt.json binds the new artifact and current inputs. Old33b9 evidence remains sealed; main/native worker owns fresh6614 acceptance before archival. Compilation/scan alone does not replace that proof.
