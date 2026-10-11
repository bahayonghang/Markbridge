# Chrome Extension Guidelines

Read [Project baseline](../project-baseline.md) for sources. No extension exists yet.

## Browser adapter

Use MV3 and `chrome.bookmarks`. Register worker listeners at top level. Normalize event-specific payloads. Removal can represent an entire subtree; reorder carries child IDs. Refresh at import completion.

Protect roots and managed nodes from API properties and topology. Do not hard-code three roots or require guid. No `chrome.bookmarks.export_html` method exists; export HTML from a confirmed tree on the desktop.

## Pairing and liveness

Bind desktop communication to loopback. Pair each installation explicitly. The extension cannot read arbitrary desktop token files with bookmark permission. Separate bootstrap pairing from subsequent authentication.

Authenticate before tree or command exchange. Check origin and token. Never put secrets in URL query strings.

Exchange application messages within the worker activity window. Use persistent wake/reconnect recovery; a stopped worker has no reliable in-memory timer. Reconcile fully after restart. Live latency targets exclude disconnection and OS suspension.

## Permissions and receipts

Use `bookmarks`, `storage`, and `alarms` for implemented capabilities. Page capture additionally requires `scripting` and host authorization or an extension activeTab gesture. A desktop button cannot grant activeTab.

Verify profile, request ID, expected before-state, and protected status before mutation. Serialize writes per profile. Chrome has no compare-and-swap; external edits can race. Verify postconditions and stop on conflicts.

Native tests use disposable profiles and cover wrong token/profile, worker restart, duplicate commands, missing acknowledgments, import, reorder, protected nodes, and interrupted apply.
