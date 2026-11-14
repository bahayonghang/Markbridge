# V18 evaluator observation repair — automated PASS, actual model NOT_RUN

The old evaluator assigned a wrapper to the non-writable Tauri `invoke` property. This could throw or leave query observation empty before any V18 measurements were available. The task-local evaluator now observes native IPC responses without replacing Tauri functions. It calibrates `get_bridge_state` immediately after isolated startup, before model configuration or B10K indexing; unavailable response events fail explicitly. Query request body association is transient and is not written to receipts or logs.

Each response is bound to the submitted requestId/Profile/sourceEpoch/index/generation, the exact UI input and topK=5. The generated semantic result schema and successful failure/null invariants must pass, with unique bookmark identities. UI result titles must match before and after two animation frames. The existing 20 reviewed labels, 10,000 bookmarks, 30 warm samples, mean Recall@5 >=0.8 and p95 <=1,000ms gates are unchanged. Timing still starts before filling input and includes observation overhead. Native helper imports are deferred until explicit arguments and human-reviewed labels pass preflight; no-argument execution reports NOT_RUN.

## Executed checks

- `node --test .../semantic-query-observer.test.mjs .../semantic-metrics.test.mjs`: 8 passed, 0 failed/skipped. The tests use an immutable invoke property and synthetic request/response events; they cover absent calibration/response, wrong transport callbacks, mismatched input/topK/identity, malformed/duplicate results, fixed B10K/metrics and the no-argument CLI.
- Direct repository ESLint entrypoint with `--no-ignore` on the three changed/new `.mjs` files: exit0. Root lint normally ignores `.trellis/**`, so this check is separate.
- Direct repository ESLint entrypoint with the exact root `lint` script arguments: exit0.
- Direct TypeScript CLI for desktop, extension, protocol and tools tsconfigs: 4/4 exit0. Those configurations do not include the task-owned JavaScript; this is baseline TypeScript verification, not a claim of JavaScript type coverage.
- `git diff --check`: passed after the repair/documentation edits.

Raw successful outputs are `observer-repair-20261026-{node-tests,helper-lint,root-lint,typecheck}.log`; silent successful ESLint outputs are empty files. Current file/log digests and the actual command strings are recorded in `observer-repair-20261026.json`.

## Tooling attempts retained

The initial `pnpm exec eslint` attempt failed in the existing Scoop shim: `Could not create process` for its configured pnpm target. RTK initially reported a JSON-output parse failure; `rtk bypass` exposed the shim error. No package or shim was modified. The successful checks call the installed repository Node CLI entrypoints directly. A first TypeScript log-capture command had invalid PowerShell redirection after `foreach`; its trailing shell exit misleadingly remained0. It was rejected as evidence and rerun with a script block; the accepted four-project log explicitly records each PASS.

## Limits

No native application was launched, no endpoint contacted, and no model downloaded or installed. The user has not supplied an authorized model/endpoint or human-reviewed labels for this run. Synthetic observer tests do not prove that the actual native WebView exposes response events; mandatory runtime calibration remains the guard. Actual-model AC15-3/V18 remains NOT_RUN, task15 stays in_progress, and no completion/archive/commit is performed by this implementer.
