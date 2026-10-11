# 01 commit path split

Current `git status --porcelain -uall` only. This file is omitted on purpose. Native empty state, window size, error display, and two normal closes stay UNVERIFIED.

## 01-only

.github/workflows/ci.yml
Cargo.toml
eslint.config.js
package.json
playwright.config.ts
pnpm-workspace.yaml
tsconfig.base.json
tsconfig.tools.json
vitest.config.ts
apps/desktop/index.html
apps/desktop/package.json
apps/desktop/src/main.tsx
apps/desktop/src-tauri/Cargo.toml
apps/desktop/src-tauri/build.rs
apps/desktop/src-tauri/capabilities/main.json
apps/desktop/src-tauri/icons/icon.ico
apps/desktop/src-tauri/icons/icon.png
apps/desktop/src-tauri/tauri.conf.json
apps/desktop/tsconfig.json
apps/desktop/vite.config.ts
apps/extension/tsconfig.json
crates/protocol/Cargo.toml
packages/protocol/package.json
packages/protocol/src/generated/startup-state.d.ts
packages/protocol/src/generated/startup-state.schema.json
packages/protocol/src/generated/startup-state.validator.d.ts
packages/protocol/src/generated/startup-state.validator.js
packages/protocol/src/index.test.ts
packages/protocol/tsconfig.json
scripts/native-artifact.test.mjs
scripts/native-build.mjs
tests/fixtures/protocol/startup-state.json
tests/setup.ts
.trellis/spec/frontend/directory-structure.md
.trellis/tasks/10-10-mb-01-foundation/check.jsonl
.trellis/tasks/10-10-mb-01-foundation/design.md
.trellis/tasks/10-10-mb-01-foundation/evidence/browser-empty-1100x760.png
.trellis/tasks/10-10-mb-01-foundation/evidence/browser-empty-640x480.png
.trellis/tasks/10-10-mb-01-foundation/evidence/check-output.txt
.trellis/tasks/10-10-mb-01-foundation/evidence/check-review.md
.trellis/tasks/10-10-mb-01-foundation/evidence/native-process.md
.trellis/tasks/10-10-mb-01-foundation/evidence/receipts.md
.trellis/tasks/10-10-mb-01-foundation/evidence/session-preflight.md
.trellis/tasks/10-10-mb-01-foundation/implement.jsonl
.trellis/tasks/10-10-mb-01-foundation/implement.md
.trellis/tasks/10-10-mb-01-foundation/prd.md
.trellis/tasks/10-10-mb-01-foundation/task.json

## later-only

crates/core/src/storage/migrations/001_identity.sql [02]
crates/core/src/storage/migrations/002_history.sql [02]
crates/core/src/storage/mod.rs [02]
crates/core/src/storage/tests.rs [02]
crates/protocol/src/bin/wire-fixtures.rs [02]
crates/protocol/src/wire.rs [02]
crates/protocol/src/wire_tests.rs [02]
packages/protocol/src/generated/wire-message.d.ts [02]
packages/protocol/src/generated/wire-message.schema.json [02]
packages/protocol/src/generated/wire-message.validator.d.ts [02]
packages/protocol/src/generated/wire-message.validator.js [02]
packages/protocol/src/wire.test.ts [02]
packages/protocol/src/wire.ts [02]
tests/fixtures/protocol/rust-to-ts.json [02]
tests/fixtures/protocol/ts-to-rust.json [02]
.trellis/spec/backend/database-guidelines.md [02]
.trellis/spec/backend/error-handling.md [02]
.trellis/spec/extension/index.md [03]
apps/desktop/src/App.test.tsx [03]
apps/desktop/src/App.tsx [03]
apps/desktop/src/backend.test.tsx [03]
apps/desktop/src/useBridge.ts [03]
apps/extension/index.html [03]
apps/extension/options.html [03]
apps/extension/public/manifest.json [03]
apps/extension/src/bridge.test.ts [03]
apps/extension/src/bridge.ts [03]
apps/extension/src/main.ts [03]
apps/extension/src/style.css [03]
apps/extension/src/worker.ts [03]
crates/core/examples/bridge_harness.rs [03]
crates/core/examples/credential_probe.rs [03]
crates/core/src/bridge/credentials.rs [03]
crates/core/src/bridge/mod.rs [03]
crates/core/src/bridge/sync.rs [03]
crates/core/src/bridge/tests.rs [03]
crates/core/src/bridge/transport.rs [03]
crates/protocol/src/bridge.rs [03]
packages/protocol/src/bridge.ts [03]
packages/protocol/src/generated/bridge-state.d.ts [03]
packages/protocol/src/generated/bridge-state.schema.json [03]
packages/protocol/src/generated/bridge-state.validator.d.ts [03]
packages/protocol/src/generated/bridge-state.validator.js [03]
packages/protocol/src/generated/pairing-offer.d.ts [03]
packages/protocol/src/generated/pairing-offer.schema.json [03]
packages/protocol/src/generated/pairing-offer.validator.d.ts [03]
packages/protocol/src/generated/pairing-offer.validator.js [03]
tests/e2e/foundation.spec.ts [03]
.trellis/tasks/10-10-markbridge-workspace/design.md [parent]
.trellis/tasks/10-10-markbridge-workspace/execution-status.md [parent]
.trellis/tasks/10-10-markbridge-workspace/implement.md [parent]
.trellis/tasks/10-10-markbridge-workspace/prd.md [parent]
.trellis/tasks/10-10-markbridge-workspace/task-map.md [parent]
.trellis/tasks/10-10-markbridge-workspace/task.json [parent]
.trellis/tasks/10-10-markbridge-workspace/verification.md [parent]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/design.md [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/check-gates.jsonl [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/check-review.md [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/check-source-manifest.jsonl [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/closeout-check.json [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/implementation-report.md [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/receipts.md [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/session-preflight.md [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/wire-source-corrupt.bin [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/evidence/wire-source-failure.json [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/implement.md [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/prd.md [other-task]
.trellis/tasks/10-10-mb-02-identity-storage-protocol/task.json [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/check.jsonl [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/design.md [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-clippy-first.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-credential-probe.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-credential-reference-probe.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-delta-check.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-desktop-check.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-harness-build.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-harness-rebuild.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-rust-retest.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/backend-rust-tests.txt [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/browser-diagnostics-mock-1100x760.png [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/browser-diagnostics-mock-640x480.png [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/browser-preview-1100x760.png [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/browser-preview-640x480.png [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/chrome-native-harness.mjs [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/frontend-vitest.json [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/implementation-extension.md [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/implementation-frontend.md [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/native-0dab3e15-f02c-4b13-bed6-ef8333ccc59a.json [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/native-4ede64a3-99c2-44d6-8756-a3c58f58c159.json [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/evidence/session-preflight.md [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/implement.jsonl [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/implement.md [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/integration-contract.md [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/prd.md [other-task]
.trellis/tasks/10-10-mb-03-chrome-bridge/task.json [other-task]
.trellis/tasks/10-10-mb-04-readonly-mirror/design.md [other-task]
.trellis/tasks/10-10-mb-04-readonly-mirror/implement.md [other-task]
.trellis/tasks/10-10-mb-04-readonly-mirror/prd.md [other-task]
.trellis/tasks/10-10-mb-04-readonly-mirror/task.json [other-task]
.trellis/tasks/10-10-mb-05-library-workspace/design.md [other-task]
.trellis/tasks/10-10-mb-05-library-workspace/implement.md [other-task]
.trellis/tasks/10-10-mb-05-library-workspace/prd.md [other-task]
.trellis/tasks/10-10-mb-05-library-workspace/task.json [other-task]
.trellis/tasks/10-10-mb-06-safe-editing/design.md [other-task]
.trellis/tasks/10-10-mb-06-safe-editing/implement.md [other-task]
.trellis/tasks/10-10-mb-06-safe-editing/prd.md [other-task]
.trellis/tasks/10-10-mb-06-safe-editing/task.json [other-task]
.trellis/tasks/10-10-mb-07-local-tags/design.md [other-task]
.trellis/tasks/10-10-mb-07-local-tags/implement.md [other-task]
.trellis/tasks/10-10-mb-07-local-tags/prd.md [other-task]
.trellis/tasks/10-10-mb-07-local-tags/task.json [other-task]
.trellis/tasks/10-10-mb-08-content-preview/design.md [other-task]
.trellis/tasks/10-10-mb-08-content-preview/implement.md [other-task]
.trellis/tasks/10-10-mb-08-content-preview/prd.md [other-task]
.trellis/tasks/10-10-mb-08-content-preview/task.json [other-task]
.trellis/tasks/10-10-mb-09-webpage-preview/design.md [other-task]
.trellis/tasks/10-10-mb-09-webpage-preview/implement.md [other-task]
.trellis/tasks/10-10-mb-09-webpage-preview/prd.md [other-task]
.trellis/tasks/10-10-mb-09-webpage-preview/task.json [other-task]
.trellis/tasks/10-10-mb-10-ai-assistance/design.md [other-task]
.trellis/tasks/10-10-mb-10-ai-assistance/implement.md [other-task]
.trellis/tasks/10-10-mb-10-ai-assistance/prd.md [other-task]
.trellis/tasks/10-10-mb-10-ai-assistance/task.json [other-task]
.trellis/tasks/10-10-mb-11-batch-organization/design.md [other-task]
.trellis/tasks/10-10-mb-11-batch-organization/implement.md [other-task]
.trellis/tasks/10-10-mb-11-batch-organization/prd.md [other-task]
.trellis/tasks/10-10-mb-11-batch-organization/task.json [other-task]
.trellis/tasks/10-10-mb-12-library-maintenance/design.md [other-task]
.trellis/tasks/10-10-mb-12-library-maintenance/implement.md [other-task]
.trellis/tasks/10-10-mb-12-library-maintenance/prd.md [other-task]
.trellis/tasks/10-10-mb-12-library-maintenance/task.json [other-task]
.trellis/tasks/10-10-mb-13-windows-acceptance/design.md [other-task]
.trellis/tasks/10-10-mb-13-windows-acceptance/implement.md [other-task]
.trellis/tasks/10-10-mb-13-windows-acceptance/prd.md [other-task]
.trellis/tasks/10-10-mb-13-windows-acceptance/task.json [other-task]
.trellis/tasks/10-10-mb-14-cross-platform/design.md [other-task]
.trellis/tasks/10-10-mb-14-cross-platform/implement.md [other-task]
.trellis/tasks/10-10-mb-14-cross-platform/prd.md [other-task]
.trellis/tasks/10-10-mb-14-cross-platform/task.json [other-task]
.trellis/tasks/10-10-mb-15-semantic-search/design.md [other-task]
.trellis/tasks/10-10-mb-15-semantic-search/implement.md [other-task]
.trellis/tasks/10-10-mb-15-semantic-search/prd.md [other-task]
.trellis/tasks/10-10-mb-15-semantic-search/task.json [other-task]

## mixed

apps/desktop/src-tauri/src/main.rs
01: 1, 80-88, 111, 121-123
03: 3-6, 8-78, 92-109, 112-118, 125-131
Shared shell lines 90-91, 110, 119-120, 124, 132-133 wrap both the startup command and the bridge setup.

apps/desktop/src/backend.ts
01: 10-15; names `invoke`, `isTauri`, `parseStartupState`, `StartupState` on 1 and 4-5
03: 2, 8, 17-62; names `listen`, `parseBridgeState`, `parsePairingOffer`, `BridgeState`, `PairingOffer` on 2-6
Lines 1 and 3-6 each contain both tasks.

apps/desktop/src/styles.css
01: 1-28, 58, 62-65
03: 29-56, 59
Lines 57, 60-61, and 66 only open or close the media blocks.

apps/extension/package.json
01: 1-6; `vite` on 7
03: `@types/chrome` on 7
Line 7 contains both.

apps/extension/vite.config.ts
01: 1-5, 8
03: 9-12
Lines 6-7 and 13-14 only open or close the input and config objects.

crates/core/Cargo.toml
01: 1-5, 8
02: 11
03: 13-16, 18-19
02+03: 9-10, 12, 22-23
Lines 6-7, 17, and 20-21 are blank lines or table headers.

crates/core/src/lib.rs
01: 1-22
02: 25
03: 24
Line 23 is blank.

crates/protocol/src/bin/export-schema.rs
01: 1, 6-10
02: 3
03: 4-5
Line 2 opens the match.

crates/protocol/src/lib.rs
01: 1-41
02: 43-44, 48-49
03: 45-46
Lines 42 and 47 are blank.

packages/protocol/src/index.ts
01: 1-9
02: 11
03: 12
Line 10 is blank.

scripts/check-artifacts.mjs
01: 1-16
03: 17-27

scripts/foundation.test.mjs
01: 21-29
03: 7-19
Lines 1-5 are the shared import and reader.

scripts/protocol.mjs
01: 1-11, 14-15, 17-34, 36-79; startup tuple on 35
02: `uint16` and `uint64` on 12 and 16; wire tuple on 35
03: bridge and pairing tuples on 35
Lines 12, 16, and 35 each contain more than one task. `uint8` on 12 and 16 is 01.

scripts/protocol.test.mjs
01: 17-23, 36, 42-43
02: 24-25, 37, 44-46
03: 38-39, 47-50
Lines 1-16, 26-35, and 51-55 are the shared drift harness.

README.md
01: 1-2, 5-20, 23-56, 58-63, 66-68
02: 21-22, 70
01+02: 3, 57, 72
01+02, and names 03: 64

Cargo.lock
Do not commit this file whole in the 01 commit. It is one workspace resolution.
01: 1823-1830 markbridge-desktop; 1833-1839 markbridge-protocol; every other package block except the blocks named below
02: 750-755 fallible-iterator; 756-761 fallible-streaming-iterator; 1209-1217 hashbrown 0.16.1; 1227-1235 hashlink; 1767-1777 libsqlite3-sys; 2638-2647 rsqlite-vfs; 2648-2662 rusqlite; 3085-3096 sqlite-wasm-rs; 3922-3927 vcpkg; dependency line 1813
03: 497-502 data-encoding; 1698-1708 keyring; 2394-2402 ppv-lite86; 2501-2510 rand 0.9.2; 2511-2520 rand_chacha; 2521-2529 rand_core; 2975-2985 sha1; 3133-3138 subtle; 3619-3630 tokio-tungstenite; 3832-3848 tungstenite; 3898-3903 utf-8; 4330-4338 windows-sys 0.59.0; 4363-4378 windows-targets 0.52.6; 4403-4408 windows_aarch64_gnullvm 0.52.6; 4415-4420 windows_aarch64_msvc 0.52.6; 4427-4432 windows_i686_gnu 0.52.6; 4433-4438 windows_i686_gnullvm 0.52.6; 4445-4450 windows_i686_msvc 0.52.6; 4457-4462 windows_x86_64_gnu 0.52.6; 4469-4474 windows_x86_64_gnullvm 0.52.6; 4481-4486 windows_x86_64_msvc 0.52.6; 4615-4623 zerocopy 0.8.62; 4624-4634 zerocopy-derive 0.8.62; dependency lines 1809-1810, 1812, 1816, 1819
02+03: 740-749 errno; 1778-1783 linux-raw-sys 0.12.1; 2678-2690 rustix; 3485-3497 tempfile; dependency lines 1814-1815, 1817-1818
Package blocks for tokio and futures-util also satisfy Tauri, so those blocks are not later-only. rand 0.9.2 does not. Lines 1806-1808 and 1820 are the markbridge-core wrapper.

pnpm-lock.yaml
Do not commit this file whole in the 01 commit.
01: every line except the 03 lines below
03: 243-245, 642-643, 654-661, 1778-1781, 1789-1795

.trellis/spec/backend/directory-structure.md
Hunk replaces the old "no Rust workspace" table.
01: 18
03: 11, 20
01+02+03: 5, 10
01+03: 8
01+02: 9

.trellis/spec/backend/index.md
01+02+03: 3
01 implement.jsonl does not name this file.

.trellis/spec/backend/quality-guidelines.md
01: 3-5, 17-52
02: 7

.trellis/spec/frontend/quality-guidelines.md
01: 3-5
02: 7

.trellis/spec/frontend/type-safety.md
01: 17-61
02: 63-82, 87-120
03: 83-85
Lines 1-16 are the pre-existing protocol note, not the 01 startup section.

.trellis/spec/project-baseline.md
01: 7
01+02: 5, 40
Line 5 also says pairing does not exist. That sentence is not a 03 rule.

## exclude

.gitignore — unclassified
AGENTS.md — unclassified
.trellis/workspace/lyh/index.md — workspace
.trellis/workspace/lyh/journal-1.md — workspace
.vitest/json/output.json — vitest output
.trellis/spec/frontend/component-guidelines.md — 01 implement.jsonl does not name this file; the diff cites 01 only
.trellis/spec/frontend/hook-guidelines.md — 01 implement.jsonl does not name this file; the diff cites 01 only
.trellis/spec/frontend/index.md — 01 implement.jsonl does not name this file; the diff cites 01 only

## defects

NO_PRODUCT_EDIT
