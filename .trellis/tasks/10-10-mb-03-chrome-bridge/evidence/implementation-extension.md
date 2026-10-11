# 03 extension implementation evidence

Date: 2026-10-11, America/New_York. Source is the shared, uncommitted working tree. The extension worker reads Chrome bookmarks only. No daily Chrome profile, installed extension, commit, archive or publication was changed by this agent.

## Scope

- `apps/extension`: MV3 worker, popup/options, readonly Chrome event conversion, pairing, authentication, stable snapshots, retries and persistence.
- `pnpm-lock.yaml`: extension workspace protocol dependency and `@types/chrome` 0.3.5.
- `scripts/foundation.test.mjs`, `scripts/check-artifacts.mjs`: implemented permissions and worker/options production assertions.
- Delegated CSP correction: `scripts/protocol.mjs`, `scripts/protocol.test.mjs`, protocol TypeScript readers, wire test and generated outputs. Rust remains owned by the backend agent.

## Behavior

The manifest requests exactly bookmarks/storage/alarms, minimum Chrome 134. The manifest has no host permissions, content scripts, scripting, activeTab or externally_connectable. CSP permits connection only to `ws://127.0.0.1:*`; the worker constructs the exact copied port and never scans ports. Credentials never enter a URL or a diagnostic.

The worker registers all Chrome bookmark and lifecycle listeners before storage access. Long credentials use storage.local restricted to TRUSTED_CONTEXTS. Unexpired pending pairing uses storage.session with the same restriction. No storage.sync call exists. Pairing code input clears before runtime message handoff. Pairing accepts only the exact five-field code defined in integration-contract.md. After accepted pair_result, the worker sends hello and waits for sourceEpoch. Network input uses the shared wire parser. Profile/session/request correlation and authentication precede tree reads. Failed authentication clears local credentials and stops recovery until explicit user action. Unauthenticated sockets close within 5 seconds. The pending-confirmation UNPAIRED result retries only within the 120-second code lifetime.

Snapshots reject incomplete folder trees and schema/topology failures. A concurrent event invalidates a snapshot; at most three immediate attempts run before a delayed retry. No delta sends before the first successful snapshot or during reconciliation. Full trees carry barrierSeq and echo the desktop get_tree requestId. Proactive import/alarm/five-minute refresh sends resync_required, then waits for the desktop's correlated get_tree. A server resync_required notice marks reconciling without an echo; the server follows the notice with get_tree. Overlapping refresh requests coalesce. The worker preserves dynamic folderType, including managed, unmodifiable, parent/index, API millisecond timestamps and all event variants. Browser write commands are rejected; no Chrome bookmark mutation API is invoked.

Application heartbeats run every 20 seconds. Retry delays are 1/2/4/8/16/30 seconds with 20 percent jitter and a 30-second base cap. A 0.5-minute alarm, onStartup, onInstalled and explicit reconnect restore connection attempts after worker timer loss. Every five minutes the worker reconciles a full tree. The popup/options show connection state, node count and safe error codes. Options-page status polling runs while the page is open; native idle checks must close the page to exclude that activity.

All four Rust-generated schema validators (startup, wire, bridge-state, pairing-offer) use build-time Ajv standalone generation. Runtime modules import validators statically. No unsafe-eval or runtime compilation is enabled. The drift gate checks generated validator JavaScript and declarations together with schema/types. A Node test disables string code generation and executes all four validators. The production scanner rejects direct Function/eval calls in worker output.

## Checks and exact outcomes

| Command | Exit | Result |
|---|---:|---|
| pnpm install --lockfile-only | 0 | PASS |
| pnpm install --frozen-lockfile | 0 | PASS |
| pnpm protocol:generate | 0 | PASS, after managed Rust enum was available |
| node --test scripts/protocol.test.mjs scripts/foundation.test.mjs | 0 | PASS, 4 tests |
| pnpm --filter @markbridge/extension typecheck | 0 | PASS |
| pnpm --filter @markbridge/extension build | 0 | PASS, fixed worker.js plus popup/options |
| pnpm exec vitest run apps/extension/src/bridge.test.ts packages/protocol/src --reporter=dot | 0 | PASS, 3 files, 34 tests (16 extension) |
| pnpm exec eslint apps/extension packages/protocol scripts/protocol.mjs scripts/protocol.test.mjs scripts/foundation.test.mjs scripts/check-artifacts.mjs --max-warnings 0 | 0 | PASS |
| pnpm protocol:check | 0 | PASS |
| node scripts/check-artifacts.mjs | 0 | PASS |
| pnpm --filter @markbridge/protocol typecheck | 0 | PASS |

Extension tests cover invalid pairing input, pending confirmation/expiration, authentication timeout, incorrect profile/session/credentials, rejected content-script sender, stable root/time conversion, snapshot invalidation, busy retry bound, incomplete snapshot, every bookmark event, import, resync, rejected apply_operation, depth/count limits, managed roots, heartbeat/reconciliation, alarm/startup/reinitialization, explicit reconnect, retry sequence and local forget. Mock bookmark write APIs remain uncalled.

## First failures and corrections

1. Initial extension typecheck exited 1: Chrome types include folderType managed while the old shared wire enum had three values. The current Chrome types also require the syncing field in mock BookmarkTreeNode values. Main approved the necessary additive shared enum correction; backend changed Rust; fixtures now include syncing and generated output preserves managed.
2. Initial extension build exited 1 while the backend agent had created protocol bridge.ts but had not generated bridge-state/pairing-offer schemas. The build passed after the generated files became available.
3. First extension behavior run: 14 passed, 1 failed. At pairing expiration the retry timer could leave status disconnected until the next backoff elapsed. The retry delay now stops at the pending expiration time; the expiration test passes.
4. Production inspection found Ajv's runtime Function call before native acceptance. Runtime compilation was replaced with standalone generation. No CSP relaxation was made.
5. First standalone CSP regression run exited 1: `TypeError: func1 is not a function`. Native Node ESM imported the Ajv CommonJS helper default as an object. Generated runtime helper imports now resolve the actual helper function in Node and Vite. The code-generation-disabled regression and all wire corpus tests pass.
6. Main's source integration check found that proactively generated tree_full request IDs did not match the backend's outstanding get_tree request. Proactive refresh now requests a desktop-owned get_tree through resync_required. Import and five-minute tests require actual desktop request correlation; a new overlap test verifies that both peers refreshing at 300 seconds cannot create an echo loop or duplicate unsolicited snapshots. During this test update the fake socket initially replied to resync_required as if the notice were a ping; the mock now selects the actual latest ping. A findLast call failed the ES2022 typecheck and was replaced with reverse/find. Corrected tests, typecheck and build pass.

## Evidence boundaries and rollback

These are mocked Chrome/socket/time tests, Rust-to-TypeScript fixture tests and production build checks. Native disposable Chrome, Tauri GUI, OS suspend, physical machine idle and real two-Profile isolation are not claimed by this report. Main records those results separately. Options-page rendering still requires the main native check.

Stop the worker by unloading the temporary extension or closing its temporary browser. Clear local pairing through the explicit extension action and revoke the corresponding desktop pairing. Cache remains readonly on the desktop. No browser content rollback is required: this implementation contains no bookmark write calls. Reverting source alone does not revoke an already issued credential; desktop revocation is the credential rollback step.

Official references checked during implementation: [Chrome WebSockets](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets), [network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks). The WebSocket sample does not require host permissions. The absence of host permissions still requires the main real-Chrome connection check.
