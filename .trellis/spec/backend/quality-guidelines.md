# Backend Quality Guidelines

Child 01 provides Cargo manifests and foundation tests. Bootstrap validation remains historical document evidence; child 01 records product command results separately.

Foundation Rust gates are `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace --locked`. Core and protocol unit tests are in `crates/core/src/lib.rs` and `crates/protocol/src/lib.rs`. `scripts/protocol.test.mjs` checks generated TypeScript and JSON Schema drift using temporary copies.

Child 02 protocol behavior tests are in `crates/protocol/src/wire_tests.rs`; storage and migration tests are in `crates/core/src/storage/tests.rs`. Run the Rust tests and protocol generation against the current source. A cached exporter result alone does not establish that the current Rust source compiles. The TypeScript wire tests also invoke the Rust fixture executable and compare acceptance of shared input frames.

Use synthetic fixtures and disposable profiles. Cover identity isolation, dynamic roots, managed nodes, event gaps, lost acknowledgments, worker restart, migration failure, interrupted batch, and rollback conflicts.

Check fetch restrictions at every redirect and address resolution. A remote preview must fail to invoke protected commands.

Record timestamps, fixture size, runtime, and machine for latency claims. Compare semantic structure and order for rollback; recreated node IDs can differ.

Native Chrome, WebView isolation, secret storage, and installed behavior require native evidence. A build or mock is insufficient. Record absent environments as NOT_RUN.

Child 09 unit tests cover navigation policy, session-directory containment, the main capability file, and the trusted-label check on registered commands. `open_http` uses `rundll32 url.dll,FileProtocolHandler`. Acceptance may set `MARKBRIDGE_OPEN_HTTP_SUSPEND=1` and an absolute `MARKBRIDGE_OPEN_HTTP_PIDFILE` so a probe can read that suspended process and terminate it before `url.dll` runs. Those tests do not mark parent V11 passed. V11 needs a native preview window, profile isolation, and denial receipts. Preview history buttons follow the WebView2 `HistoryChanged` event. The preview window cancels a non-http(s) navigation in its own `NavigationStarting` handler. A document script turns a silent `javascript:` or `file:` assignment into that cancelled navigation so the main window can show `SchemeDenied`.

## Native foundation release gate

### 1. Scope and trigger

AC01-4 covers native release assets as well as Web assets. Child 01 found absolute build-machine source paths in an otherwise successful release build. Compilation alone does not satisfy the artifact gate.

### 2. Signatures

`pnpm build:native` runs `scripts/native-build.mjs`. The script calls the installed Tauri CLI with `build --no-bundle -- --locked` on Windows and scans `markbridge-desktop.exe`. `pnpm build` retains its Web build scope.

### 3. Contract

The script computes source prefixes from the workspace, Cargo home, Rustup home, and build-user home. Command-scoped `CARGO_ENCODED_RUSTFLAGS` adds `--remap-path-prefix` values to existing flags. Tracked configuration must not contain machine-specific absolute prefixes. Remapped prefixes are virtual source locations. The command does not create an installer or install the application.

Resolve `CARGO_TARGET_DIR` once to an absolute path; relative values use the workspace root as their base. Pass that exact path to the build child and read the artifact from the same path. Do not resolve the build and scan targets against different working directories. The default is the workspace `target` directory.

### 4. Validation and errors

| Condition | Result |
|---|---|
| Release build succeeds and UTF-8/UTF-16LE scans find no configured pattern | Exit 0 with artifact byte count and SHA256 |
| Build fails or artifact is absent | Nonzero exit; no artifact PASS |
| Absolute Windows path, private-key header, or known API-key pattern matches | Nonzero exit; report the pattern label without printing the matched data |
| Platform is not Windows | Reject; cross-platform acceptance belongs to 14 |

### 5. Cases

Good: a binary with only virtual source prefixes passes. Base: CI builds and scans the Windows executable without packaging. Bad: a synthetic Windows absolute source path fails in either supported encoding.

### 6. Required tests

`scripts/native-artifact.test.mjs` checks both encodings, path/secret counterexamples, and virtual-prefix acceptance. `pnpm test` includes the scanner test. `.github/workflows/ci.yml` invokes `pnpm build:native`. Record the real binary hash and scan result in the child receipts; pattern scanning is not proof against arbitrary secret encodings.

### 7. Incorrect and correct usage

Incorrect: use Web asset scanning or a debug executable to approve the native release asset. Correct: build the release executable with path remapping, then scan that exact artifact. Native rendering and normal-close evidence remain a separate gate.
