# Type Safety

Enable TypeScript strict mode in the foundation task. Validate unknown IPC, network, file, and model data. Type assertions do not validate external data.

Use discriminated message kinds and a protocol version. Validate bounds, scheme, profile, and revisions before domain operations. Reject unknown mutation kinds.

Keep browser IDs as strings. Preserve optional API properties. Distinguish folder and URL nodes. Use UTC timestamps across processes.

Documentation fixture:

```json
{"protocolVersion":1,"type":"sync_state","profileId":"profile-a","sessionId":"session-a","revision":12,"state":"live"}
```

The protocol task owns one schema with cross-language compatibility tests. Invalid AI output must leave bookmarks unchanged.
