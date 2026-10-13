# Chrome Extension Guidelines

Read [Project baseline](../project-baseline.md) for sources. Child 03 implements the read-only adapter in `apps/extension/src/bridge.ts`, top-level worker entry in `worker.ts`, and popup/options UI in `main.ts`. The manifest requests bookmarks, storage and alarms. Browser mutations and receipts remain child 06 contracts. Runtime acceptance results belong in child 03 evidence.

## Browser adapter

Use MV3 and `chrome.bookmarks`. Register worker listeners at top level. Normalize event-specific payloads. Removal can represent an entire subtree; reorder carries child IDs. Refresh at import completion.

Protect roots and managed nodes from API properties and topology. Do not hard-code three roots or require guid. No `chrome.bookmarks.export_html` method exists; export HTML from a confirmed tree on the desktop.

Preserve all four folderType values: bookmarks-bar, other, mobile and managed. Validate complete folder children arrays before sending a snapshot. Register listeners before asynchronous initialization and getTree. Discard a snapshot if events occur during the read; retry at most three times before delaying.

## Pairing and liveness

Bind desktop communication to loopback. Pair each installation explicitly. The extension cannot read arbitrary desktop token files with bookmark permission. Separate bootstrap pairing from subsequent authentication.

Authenticate before tree or command exchange. Check origin and token. Never put secrets in URL query strings.

Exchange application messages within the worker activity window. Use persistent wake/reconnect recovery; a stopped worker has no reliable in-memory timer. Reconcile fully after restart. Live latency targets exclude disconnection and OS suspension.

Use a new session ID for each transport. Proactive refresh sends resync_required and waits for desktop get_tree. A tree_full response must echo the pending request ID. Suppress deltas while reconciling. The desktop assigns the persisted revision; extension-local sequence state may reset at worker restart.

Store long-lived credentials in chrome.storage.local with TRUSTED_CONTEXTS access. Keep the temporary pairing ticket in session storage only until expiry. Clear the options input before messaging. Do not persist a pairing ticket in URLs or diagnostic output. Pair only after the desktop confirms the observed instance and transport Origin.

Popup and options share status rendering but have different controls: the popup directs users to pairing settings, while options may say to paste into the current form. Display the extension identity and Origin for the desktop confirmation. Keep a rejected input's action error visible across status polls. Clearing the local pairing requires a separate confirmation; after confirmation/cancel, focus returns to a visible control. Extension connection feedback must defer to the desktop's reconciled live state before promising write availability.

MV3 CSP prohibits runtime Function/eval compilation. Consume static Ajv standalone validators generated from Rust schemas by scripts/protocol.mjs. pnpm protocol:check compares these validators as well as schemas/types. Production scanning and the Node code-generation-disabled regression must pass.

## Permissions and receipts

Use `bookmarks`, `storage`, and `alarms` for implemented capabilities. Page capture additionally requires `scripting` and host authorization or an extension activeTab gesture. A desktop button cannot grant activeTab.

Verify profile, request ID, expected before-state, and protected status before mutation. Serialize writes per profile. Chrome has no compare-and-swap; external edits can race. Verify postconditions and stop on conflicts. A create or move whose `parentId` is absent from the tree resolves that id through `createdByRequest` for the same operation. An unmapped parent returns `CONFLICT` and does not create or move.

Native tests use disposable profiles and cover wrong token/profile, worker restart, duplicate commands, missing acknowledgments, import, reorder, protected nodes, and interrupted apply.

Daily move/delete steps may include `expectedSubtree`. Compare the entire reviewed subtree with the actual Chrome tree immediately before the effect; an unchanged folder root does not authorize deleting or moving changed descendants. A changed, added, removed or newly protected descendant rejects the step with no browser effect. The desktop prevalidates all step frames and sends one daily batch step at a time. Keep the 16MiB frame cap and static validators. Desktop and extension must be updated together for this optional wire field: older commands that omit it remain valid, while an older strict extension rejects the unfamiliar field instead of silently ignoring a precondition.

Child 03 behavior tests: apps/extension/src/bridge.test.ts. The task-local chrome-native-harness.mjs uses Google Chrome through CDP pipes and the production Rust Bridge example. Close extension pages and do not attach a worker debugger during idle acceptance. Report actual Chrome, mocked API, OS credential and Tauri GUI evidence separately.

Child 08 capture is `apps/extension/src/capture.ts`. It runs from the popup button after the click. It queries one active tab and does not read cookies, input values, or other tabs. The worker `command` path rejects `{ "type": "capture" }`. Manifest permissions are `bookmarks`, `storage`, `alarms`, `scripting`, and `activeTab`, with no host permission.

For a folder deletion whose `expectedSubtree` contains only that folder, call non-recursive `chrome.bookmarks.remove`, never `removeTree`. Chrome must reject a child added after the final tree read instead of recursively deleting unreviewed content. Preserve the existing uncertain receipt path for an API rejection; do not retry automatically or infer an outcome from error text. Regression: `apps/extension/src/executor.test.ts`.
