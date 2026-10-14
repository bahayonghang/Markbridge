# IPC observer limitation

The native behavior, geometry, real save dialogs/files, read-only failure and
source-result guards passed. The test's attempted assignment of
`window.__TAURI_INTERNALS__.invoke` did not intercept the immutable runtime hook.
Its empty commands list therefore supplies no evidence for zero IPC calls.
Do not use that list or the corresponding verbose control name as such proof.

Browser IPC mocks provide the negative side-effect assertions. A later native
rerun uses read-only CDP request-path observation and verifies that observer
against a deliberate `get_bridge_state` call before using it as evidence.
