# Type Safety

Enable TypeScript strict mode in the foundation task. Validate unknown IPC, network, file, and model data. Type assertions do not validate external data.

Use discriminated message kinds and a protocol version. Validate bounds, scheme, profile, and revisions before domain operations. Reject unknown mutation kinds.

Keep browser IDs as strings. Preserve optional API properties. Distinguish folder and URL nodes. Use UTC timestamps across processes.

Documentation fixture:

```json
{"protocolVersion":1,"type":"get_tree","profileId":"profile-a","sessionId":"session-a","requestId":"request-a","seq":null,"payload":{}}
```

The protocol task owns one schema with cross-language compatibility tests. Invalid AI output must leave bookmarks unchanged.

Child15's eight semantic parsers in `packages/protocol/src/semantic.ts` wrap Rust-generated schemas and reject malformed Unicode, nonfinite/out-of-range scores, unknown fields and invalid identity/status bounds. Required nullable fields remain present even when null. `apps/desktop/src/backend.ts` validates requests and replies; UI additionally verifies repeated request/Profile/epoch/indexId/generation before rendering or navigation. No vector BLOB/table crosses this boundary. See [semantic contracts](../backend/semantic-search.md).

## Foundation startup DTO

### 1. Scope and trigger

Child 01 defines one read-only startup DTO. Child 02 owns the paired transport protocol and persistent identities. Do not use the startup DTO as an authenticated connection state.

### 2. Signatures

- Rust: `markbridge_core::startup_state() -> markbridge_protocol::StartupState`.
- Tauri command: `get_startup_state`, restricted to the `main` window label.
- TypeScript: `parseStartupState(value: unknown): StartupState` in `packages/protocol/src/index.ts`.
- Frontend: `getStartupState(): Promise<StartupState>` in `apps/desktop/src/backend.ts`.

### 3. Contract

The fixture is `tests/fixtures/protocol/startup-state.json`:

```json
{"protocolVersion":1,"state":"unpaired"}
```

Rust serde and schemars define the source. Generated JSON Schema and TypeScript belong in `packages/protocol/src/generated/`. Ajv validates unknown input before components use the DTO. This DTO contains no profile, browser tree, credential, or local path. Browser preview returns the same unpaired fixture shape; browser evidence does not prove Tauri IPC behavior.

The generated schema uses JSON Schema draft 2020-12 and the numeric format `uint8`. Use Ajv2020 with strict validation. Register `uint8` as an integer from 0 through 255; keep the generated version bounds of 1 through 1. Do not disable strict mode to suppress an unknown format.

### 4. Validation and errors

| Condition | Result |
|---|---|
| Version 1, state unpaired, exact fields | Accept |
| Missing field, unsupported version or state, additional field | `INVALID_STARTUP_STATE` at the TypeScript boundary |
| Caller window label differs from main | `UNTRUSTED_WINDOW` from the Tauri command |
| IPC or validation rejects | App shows a safe startup error; raw input is not displayed |

### 5. Cases

Good: the shared fixture passes validation. Base: startup remains unpaired and read-only. Bad: a payload with an extra credential field fails validation.

### 6. Required tests

`crates/protocol/src/lib.rs` checks fixture serialization and extra-field rejection. `packages/protocol/src/index.test.ts` checks runtime boundary validation. `apps/desktop/src/App.test.tsx` checks safe startup states. Protocol generation must detect a changed generated output and return a nonzero exit code. Native startup and window behavior require separate task receipts.

### 7. Incorrect and correct usage

Incorrect: cast an unknown IPC response to `StartupState` and render the response. Correct: pass the response through `parseStartupState`, then render only the validated state.

## Child 02 wire protocol

### 1. Scope and trigger

Child 02 defines shared protocol v1 in `crates/protocol/src/wire.rs`. The extension and frontend consume the generated TypeScript contract. StartupState remains a separate unpaired startup DTO.

### 2. Signatures

Rust: `parse_frame(&[u8]) -> Result<WireMessage, ErrorCode>`, `encode_frame(&WireMessage) -> Result<Vec<u8>, ErrorCode>` and `TreeSnapshot::validate()`.

TypeScript: `parseWireMessage(value: unknown): WireMessage`, `parseWireFrame(frame: string): WireMessage`, `encodeWireFrame(message: WireMessage): string` and `validateTree(snapshot: TreeSnapshot): void` in `packages/protocol/src/wire.ts`.

Use the parse functions at untrusted boundaries. The typed validateTree helper handles topology; the helper does not replace schema validation of unknown input.

### 3. Contract

The type discriminator selects pair, pair_result, hello, hello_result, ping, pong, get_tree, tree_full, event, resync_required, apply_operation, operation_receipt or get_operation_status. Every message includes protocolVersion, profileId, sessionId, requestId, seq and payload. Commands and replies require requestId; event and resync_required use null. Only event requires seq. Null is an explicit value for non-applicable fields.

Rust serde/schemars owns `wire-message.schema.json` and `wire-message.d.ts`. The TypeScript generator uses maxItems: 0 to avoid expanding large bounded arrays into tuples. The generated JSON Schema retains real minItems/maxItems; runtime validation enforces the array limits. Strict Ajv checks the schema. Semantic validation checks envelope relationships, tree topology, unique IDs and operation request IDs. Reorder requires expectedChildIds and an expectedBefore folder matching the target. The old and desired child sequences must contain the same unique IDs; other mutations have no expectedChildIds. Receipt beforeChildIds and afterChildIds contain observed folder sequences, when available. Each present sequence requires the corresponding folder node. Do not require equal receipt sets: external changes can alter the set. A generated TypeScript type alone does not establish validity or authorization.

Child 03 generates Ajv standalone validators at build time for startup-state, wire-message, bridge-state and pairing-offer. Readers statically import the validators. Do not compile schemas with Function/eval in MV3. scripts/protocol.mjs owns generation; protocol:check includes validator drift. FolderType accepts bookmarks-bar, other, mobile and managed.

BridgeState and PairingOffer originate in crates/protocol/src/bridge.rs and are parsed through packages/protocol/src/bridge.ts. apps/desktop/src/backend.ts validates unknown IPC/event values. useBridge.ts subscribes before hydration and ignores older process revisions. A BridgeState event is a complete snapshot. Unpaired profiles can retain cached counts after revocation; disable their reconnect/revoke actions. Never pass the long-lived credential to React.

Protocol v1 accepts at most 16 MiB UTF-8 per frame, 100000 tree nodes and 256 levels with root at level 1. IDs must match the complete string `[A-Za-z0-9][A-Za-z0-9._:-]*` and contain 1–128 ASCII characters. Reject trailing newlines; the generated schema uses a strict end assertion because ECMAScript $ can match before a final newline. Title allows 0–4096 Unicode scalars; URL allows 1–16384; displayName allows 1–128; credential allows 32–1024. Reject lone UTF-16 surrogates at the TypeScript boundary. Nonnegative integers stop at MAX_SAFE_INTEGER; sourceEpoch starts at 1; position stops at 100000; an operation contains 1–1000 steps.

Chrome API times are Unix milliseconds. Chrome file times use microseconds since 1601 and require explicit conversion. SourceTime retains the source and normalized unixMillis. Raw bookmark URLs can include browser-supported schemes; preview navigation has a separate HTTP(S) contract.

Rust numeric deserialization must accept integral JSON forms such as `1.0` and `1e0` when the parsed value meets the schema bounds. Reject fractional or unsafe parsed values. Check the behavior against TypeScript in the shared corpus. Empty event and mutation variants must also reject extra fields at both runtime boundaries.

### 4. Validation and errors

| Input | Boundary behavior |
|---|---|
| Known version and variant with valid fields and topology | Accept data only; authentication remains a caller responsibility |
| Unknown version, message, mutation or extra field | Reject |
| Missing required envelope field or invalid requestId/seq relationship | Reject |
| Frame over 16 MiB UTF-8 | FRAME_TOO_LARGE |
| Unsafe integer, oversized field or array | Reject |
| Duplicate ID, cycle, missing parent or URL parent | Reject without replacing cache |
| Invalid Unicode scalar representation | Reject |

Errors contain stable labels. Do not render raw messages, credentials or trees. A pair message with a profileId does not prove that the peer owns the identity.

### 5. Cases

Good: valid Rust output parses in TypeScript and valid TypeScript output parses in Rust. Base: startup remains unpaired. Bad: an unknown mutation kind or stale identity must not reach storage or browser operations.

### 6. Required tests

Use actual Rust serialization and TypeScript serialization for both fixture directions. Cover unknown fields and commands, missing nullable fields, limits, Unicode, timestamps and every message/event/mutation variant. Reorder tests must reject missing old sequences, duplicate IDs, changed ID sets and non-folder targets. Receipt tests must accept observed external changes and reject child sequences attached to non-folder nodes. Test tree count and depth independently. Keep `pnpm protocol:check` in CI and preserve the intentional generated-file drift regression test.

### 7. Incorrect and correct usage

Incorrect: cast JSON.parse output to WireMessage. Correct: use parseWireFrame, then enforce authenticated Profile/session binding in the caller.

Incorrect: infer authorization from a parsed apply_operation. Correct: require the later explicit user confirmation, live state and operation engine checks before any Chrome write.

## R06 local history and export DTOs

Rust `history.rs` defines OperationDetail, UndoPreview and ExportSaveResult; generated schema, TypeScript and standalone Ajv validators are updated together. `packages/protocol/src/history.ts` validates every backend response. Undo affected count must equal the complete steps array length. A saved export requires metadata and no error; cancelled cannot carry an error; failed requires a stable error code. No output path or file body is allowed in the save result. A generated type alone does not validate a response or authorize undo.
