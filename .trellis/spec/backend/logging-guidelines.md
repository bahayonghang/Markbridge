# Logging Guidelines

Exclude sensitive URL data from logs and diagnostic files. Operation history and recovery snapshots are separate user data.

Log operation kind, pseudonymous profile identity, request ID, state, elapsed milliseconds, item counts, and error codes.

Documentation fixture:

```json
{"level":"warn","event":"operation.uncertain","requestId":"request-a","profileId":"profile-a","elapsedMs":5000,"code":"UNCERTAIN_WRITE"}
```

Use error for unavailable capabilities requiring intervention, warn for recoverable conflicts, info for lifecycle summaries, and debug for bounded detail. Avoid one info message per imported bookmark.

Exclude tokens, keys, headers, page text, full titles, query strings, fragments, and bookmark trees in every mode. Recovery snapshots are protected user data, separate from logs.

Require redacted user-selected diagnostic exports. Record app, browser, protocol, and schema versions in receipts. Bound log size and retention. Do not add telemetry.

Public page fetch does not log the URL, query, fragment, headers, title, page text, or image bytes.

AI audit lines are JSON objects with `event`, `profileId`, `jobId`, `code`, and `elapsedMs`. They omit the endpoint, bearer, secret, headers, body, title, query, fragment, and page text. The in-memory buffer keeps 50 lines. Model transport errors are not written with `Display`.

## Explicit diagnostic export

### 1. Scope / trigger

Task13 adds an explicit local diagnostic file from Settings > Chrome connection. Rendering, startup and ordinary status reads never save or upload it.

### 2. Signatures

`save_diagnostics()` is a no-argument, main-only Tauri command returning `DiagnosticSaveResult { status, errorCode }`. Core `diagnostics::report(&BridgeState)` projects fixed data; the native command owns selection and writing. Rust DTOs in `crates/protocol/src/diagnostics.rs` generate both schema and TypeScript.

### 3. Contracts

Format v1 includes only compiled app/protocol/schema versions, fixed platform/architecture enums, listener presence, a fixed bridge error code, connection-state counts and mirror-state counts. It excludes identities, names, pairing tickets, ports, titles, URLs, content, metadata, trees, paths, logs, model configuration and credentials. The IPC result contains neither the file body nor its path. Reuse `SaveGuard`, the native selector and atomic write; default name is `markbridge-diagnostics.json`.

### 4. Validation and errors

| Condition | Result |
|---|---|
| Caller is a remote preview | `READ_ONLY`, before state capture or dialog |
| User cancels selection | `cancelled`, no output file |
| Complete atomic save succeeds | `saved` |
| Dialog/write/replace fails | `failed` plus stable code; existing target preserved |
| Additional report field | Generated schema rejects it |

### 5. Good / base / bad

Good: save fixed state counts while offline. Base: no profiles yields zero counts. Bad: serializing raw Bridge state or an error's Display text exposes private fields.

### 6. Required tests

`crates/core/src/diagnostics.rs` tests sensitive canaries and exact projection; desktop export tests cover cancel/error/retry and existing target protection; preview tests enumerate trusted commands. Protocol diagnostics tests reject extra fields. `tests/e2e/diagnostics.spec.ts` covers explicit action, duplicate-click prevention, safe result states and five viewport screenshots. Native dialog save/cancel and preview denial require separate actual-runtime receipts.

### 7. Wrong / correct

Wrong: append logs, profile names or the selected path to a diagnostic report. Correct: construct only the fixed DTO and return only stable save status over IPC. Bookmark/sidecar exports remain separate user-data operations.
