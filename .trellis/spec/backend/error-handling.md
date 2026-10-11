# Error Handling

Validate extension messages, file snapshots, URLs, and model output at entry. Return stable codes, safe messages, request IDs, and recovery actions. Do not expose raw tokens, SQL, or page bodies.

Documentation fixture:

```json
{"code":"STALE_PROPOSAL","requestId":"request-a","message":"Bookmarks changed. Refresh the proposal.","retryable":false}
```

Distinguish unpaired, read-only, wrong-profile, stale-proposal, protected-node, uncertain-write, fetch-denied, invalid-AI-output, and storage errors. Child 02 defines ErrorCode in crates/protocol/src/wire.rs. Use the shared enum; storage and protocol boundaries return safe codes. Detailed storage failure behavior is in database-guidelines.md.

A lost acknowledgment does not prove failure. A successful send does not prove application. Reconcile before repeating non-idempotent commands. Stop batches on conflicts or uncertain results and retain successful receipts.

Keep the last valid cache when a file is temporarily invalid. Show source freshness. Require authentication and reconciliation before re-enabling writes.

AI and page failures must not disable local browsing or tags. Cancellation prevents late results from applying. Avoid duplicate retry layers.

Content preview failures use `failure` and `failureMessage` on `ContentPreview`. The 10 second timeout message is `抓取超过 10 秒`. `cancel_content_preview` returns no page body. A cancelled preview has null title, summary, and image.
