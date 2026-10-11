# Type Safety

Enable TypeScript strict mode in the foundation task. Validate unknown IPC, network, file, and model data. Type assertions do not validate external data.

Use discriminated message kinds and a protocol version. Validate bounds, scheme, profile, and revisions before domain operations. Reject unknown mutation kinds.

Keep browser IDs as strings. Preserve optional API properties. Distinguish folder and URL nodes. Use UTC timestamps across processes.

Documentation fixture:

```json
{"protocolVersion":1,"type":"get_tree","profileId":"profile-a","sessionId":"session-a","requestId":"request-a","seq":null,"payload":{}}
```

The protocol task owns one schema with cross-language compatibility tests. Invalid AI output must leave bookmarks unchanged.

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
