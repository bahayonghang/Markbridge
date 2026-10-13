# 02 commit path split

Snapshot: `git status --porcelain -uall` and `git diff HEAD` at HEAD `40302f9` (`fix(foundation): 撤回混入 01 提交的后续模块`, parent `3fd2bf7`). 174 porcelain paths. 84 tracked paths differ from HEAD. `40302f9` removed the 02/03 module lines from the four tracked source files; those lines are uncommitted again. Line numbers are 1-based working-tree lines. The 02 commit is HEAD content plus the 02 lines below. This list does not set task 03 acceptance and does not set 01 native acceptance to PASS.

Counts: 02-whole 24. 02-slice 22. Not in the 02 commit: 65 [03], 51 [other-task], 7 [parent], 5 exclude. 24+22+65+51+7+5=174.

## 02-whole

.trellis/spec/backend/database-guidelines.md
.trellis/spec/backend/error-handling.md
.trellis/spec/project-baseline.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/design.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/implement.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/prd.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/task.json
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/check-gates.jsonl
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/check-review.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/check-source-manifest.jsonl
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/closeout-check.json
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/implementation-report.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/receipts.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/session-preflight.md
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/wire-source-corrupt.bin
.trellis/tasks/archive/2026-10/10-10-mb-02-identity-storage-protocol/evidence/wire-source-failure.json
crates/core/src/storage/migrations/001_identity.sql
crates/core/src/storage/migrations/002_history.sql
crates/core/src/storage/mod.rs
crates/protocol/src/bin/wire-fixtures.rs
packages/protocol/src/generated/wire-message.validator.d.ts
packages/protocol/src/wire.ts
tests/fixtures/protocol/rust-to-ts.json
tests/fixtures/protocol/ts-to-rust.json

## 03-only

.trellis/spec/extension/index.md [03]
.trellis/spec/frontend/component-guidelines.md [other-task]
.trellis/spec/frontend/hook-guidelines.md [other-task]
.trellis/spec/frontend/index.md [other-task]
.trellis/tasks/10-10-markbridge-workspace/design.md [parent]
.trellis/tasks/10-10-markbridge-workspace/execution-status.md [parent]
.trellis/tasks/10-10-markbridge-workspace/implement.md [parent]
.trellis/tasks/10-10-markbridge-workspace/prd.md [parent]
.trellis/tasks/10-10-markbridge-workspace/task-map.md [parent]
.trellis/tasks/10-10-markbridge-workspace/task.json [parent]
.trellis/tasks/10-10-markbridge-workspace/verification.md [parent]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/check.jsonl [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/design.md [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/implement.jsonl [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/implement.md [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/prd.md [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/task.json [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-clippy-first.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-credential-probe.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-credential-reference-probe.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-delta-check.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-desktop-check.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-harness-build.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-harness-rebuild.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-rust-retest.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/backend-rust-tests.txt [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/browser-diagnostics-mock-1100x760.png [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/browser-diagnostics-mock-640x480.png [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/browser-preview-1100x760.png [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/browser-preview-640x480.png [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/chrome-native-harness.mjs [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/frontend-vitest.json [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/implementation-extension.md [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/implementation-frontend.md [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/native-0dab3e15-f02c-4b13-bed6-ef8333ccc59a.json [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/native-4ede64a3-99c2-44d6-8756-a3c58f58c159.json [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/evidence/session-preflight.md [03]
.trellis/tasks/archive/2026-10/10-10-mb-03-chrome-bridge/integration-contract.md [03]
.trellis/tasks/archive/2026-10/10-10-mb-04-readonly-mirror/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-04-readonly-mirror/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-04-readonly-mirror/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-04-readonly-mirror/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-05-library-workspace/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-06-safe-editing/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-07-local-tags/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-07-local-tags/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-07-local-tags/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-07-local-tags/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-08-content-preview/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-08-content-preview/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-08-content-preview/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-08-content-preview/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-09-webpage-preview/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-09-webpage-preview/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-09-webpage-preview/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-09-webpage-preview/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-10-ai-assistance/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-10-ai-assistance/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-10-ai-assistance/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-10-ai-assistance/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-11-batch-organization/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-11-batch-organization/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-11-batch-organization/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-11-batch-organization/task.json [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-12-library-maintenance/design.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-12-library-maintenance/implement.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-12-library-maintenance/prd.md [other-task]
.trellis/tasks/archive/2026-10/10-10-mb-12-library-maintenance/task.json [other-task]
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
apps/desktop/src-tauri/src/main.rs [03]
apps/desktop/src/App.test.tsx [03]
apps/desktop/src/App.tsx [03]
apps/desktop/src/backend.test.tsx [03]
apps/desktop/src/backend.ts [03]
apps/desktop/src/styles.css [03]
apps/desktop/src/useBridge.ts [03]
apps/extension/index.html [03]
apps/extension/options.html [03]
apps/extension/package.json [03]
apps/extension/public/manifest.json [03]
apps/extension/src/bridge.test.ts [03]
apps/extension/src/bridge.ts [03]
apps/extension/src/main.ts [03]
apps/extension/src/style.css [03]
apps/extension/src/worker.ts [03]
apps/extension/vite.config.ts [03]
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
scripts/check-artifacts.mjs [03]
scripts/foundation.test.mjs [03]
tests/e2e/foundation.spec.ts [03]

`apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src/backend.ts`, `apps/desktop/src/styles.css`, `apps/extension/package.json`, `apps/extension/vite.config.ts`, `scripts/check-artifacts.mjs`, and `scripts/foundation.test.mjs` also contain uncommitted 01 lines. They contain no 02 lines.

## 02-slice

`FolderType::Managed` and the folderType value `managed` are the 03 correction. `Unmodifiable::Managed` and the unmodifiable value `managed` stay in the 02 commit. Lines required by both 02 and 03 stay, and the note says so.

crates/protocol/src/lib.rs: 1-44, 47-49. Drop 45-46 (`pub mod bridge` and `pub use bridge::*`). Line 47 is a blank separator.

crates/core/src/lib.rs: 1-23, 25. Drop 24 (`pub mod bridge`). Line 23 is blank.

packages/protocol/src/index.ts: 1-11. Drop 12 (`export * from './bridge'`).

crates/core/Cargo.toml: 1-12, 20-23. Drop 13-19 (`tokio-tungstenite`, `futures-util`, `rand`, `subtle`, and the Windows `keyring` table). Lines 9 (`serde`), 10 (`serde_json`), and 12 (`tokio`) are required by both. 02 storage needs `serde_json` and tokio feature `sync`. 03 also uses those crates; 03 alone needs tokio features `net`, `rt`, `io-util`, and `io-std` on line 12. Lines 22 (`tempfile`) and 23 (dev `tokio` with `macros`, `rt`, `time`) are required by both storage tests and bridge tests.

crates/protocol/src/wire.rs: every line except 177 (`Managed` in `FolderType`). Line 188 (`Unmodifiable::Managed`) stays.

crates/protocol/src/wire_tests.rs: every line except 25-39 (`managed_folder_type_is_preserved_and_protected`).

crates/core/src/storage/tests.rs: every line except 69 (`folder_type = Some(FolderType::Managed)`). Line 68 (`Unmodifiable::Managed`) stays.

packages/protocol/src/wire.test.ts: every line except 73-74 (the `folderType: 'managed'` node and its child). Lines 71-72 stay.

packages/protocol/src/generated/wire-message.schema.json: every line except 835 (FolderType `managed`). Line 834 stays only if the comma after `mobile` is removed. Line 1319 (Unmodifiable `managed`) stays.

packages/protocol/src/generated/wire-message.d.ts: every line. On line 155, drop the suffix ` | 'managed'`. Line 159 stays.

packages/protocol/src/generated/wire-message.validator.js: 1-3. Line 4 is one generated schema and includes FolderType `managed`. Do not commit line 4 whole. The Unmodifiable value `managed` on that line stays.

crates/protocol/src/bin/export-schema.rs: 1-3, 6-10. Drop 4-5 (`bridge` and `pairing` arms).

scripts/protocol.mjs: 1-34, 36-80. Lines 12 and 16 stay whole: `uint8` is 01, `uint16` and `uint64` are 02, and neither line names 03. Line 35 stays only for the `startup-state` and `wire-message` tuples. Drop the `bridge-state` and `pairing-offer` tuples on line 35.

scripts/protocol.test.mjs: 1-37, 40-46, 51-55. Drop 38-39 and 47-50 (bridge and pairing imports and asserts).

README.md: 3, 21-22, 49, 52-53, 57, 64, 70. The other lines are uncommitted 01 text. Line 64 names 03 as later verification and stays. No line is a 03 implementation.

Cargo.lock is not in HEAD. Keep the 01 resolution, the 02 blocks, and the shared blocks. Drop only the 03 blocks and the 03 dependency lines.

02 blocks: 750-754 fallible-iterator, 756-760 fallible-streaming-iterator, 1209-1216 hashbrown 0.16.1, 1227-1234 hashlink, 1767-1776 libsqlite3-sys, 2638-2646 rsqlite-vfs, 2648-2661 rusqlite, 3085-3095 sqlite-wasm-rs, 3922-3926 vcpkg.

Shared blocks, required by both: 740-748 errno, 1778-1782 linux-raw-sys 0.12.1, 2678-2689 rustix, 3485-3496 tempfile. The `tokio` and `futures-util` package blocks also satisfy Tauri, so those blocks stay.

markbridge-core: keep 1806-1808, 1811, 1813-1815, 1817-1818, 1820. Drop 1809-1810, 1812, 1816, 1819. Lines 1814-1815 and 1817-1818 are required by both.

03 blocks to drop: 497-501 data-encoding, 1698-1707 keyring, 2394-2401 ppv-lite86, 2501-2509 rand 0.9.2, 2511-2519 rand_chacha, 2521-2528 rand_core, 2975-2984 sha1, 3133-3137 subtle, 3619-3629 tokio-tungstenite, 3832-3847 tungstenite, 3898-3902 utf-8, 4330-4337 windows-sys 0.59.0, 4363-4377 windows-targets 0.52.6, 4403-4407 windows_aarch64_gnullvm 0.52.6, 4415-4419 windows_aarch64_msvc 0.52.6, 4427-4431 windows_i686_gnu 0.52.6, 4433-4437 windows_i686_gnullvm 0.52.6, 4445-4449 windows_i686_msvc 0.52.6, 4457-4461 windows_x86_64_gnu 0.52.6, 4469-4473 windows_x86_64_gnullvm 0.52.6, 4481-4485 windows_x86_64_msvc 0.52.6, 4615-4622 zerocopy 0.8.62, 4624-4633 zerocopy-derive. `windows-sys 0.59.0` is referenced only by keyring.

pnpm-lock.yaml is not in HEAD. It has no 02-only package. Keep every line except the 03 extension importer and `@types/chrome` closure: 237-248, 642-643, 654-661, 1778-1781, 1789-1795.

.trellis/spec/backend/directory-structure.md: 1-8, 10, 13-16. On line 5, drop `Child 03 adds the read-only bridge.` On line 11, drop the `src/bridge` clause. Drop 9, 12, 18, and 20. Lines 9 and 18 have no 02 text. Line 12 and line 20 are 03.

.trellis/spec/backend/index.md: 1-2, 4-12. On line 3, drop `Child 03 adds the authenticated read-only Bridge and synchronization.`

.trellis/spec/backend/quality-guidelines.md: 1-2, 6-15. Drop 3-5 and 16-52. Those dropped lines are uncommitted 01 text, not 03.

.trellis/spec/frontend/quality-guidelines.md: 1-2, 6-15. Drop 3-5. Those dropped lines are uncommitted 01 text, not 03.

.trellis/spec/frontend/type-safety.md: 1-15, 62-82, 86-120. Drop 17-61 (uncommitted 01) and 83-85 (03 bridge validators, BridgeState, and PairingOffer).

## exclude

.gitignore
AGENTS.md
.trellis/workspace/lyh/index.md
.trellis/workspace/lyh/journal-1.md
.vitest/json/output.json

`node_modules`, `target`, `dist`, `runs`, and `ref` are not in this porcelain snapshot.

## defects

NO_PRODUCT_EDIT
