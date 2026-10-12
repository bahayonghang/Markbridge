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

AI failures use `failure` and `failureMessage` on `AiConnection`, `AiSuggestion`, and `AiApplyResult`. Invalid JSON, overlong fields, unknown fields, timeout, HTTP 429, and cancel do not write bookmarks. A credential read failure returns `无法读取已保存的凭据。没有发送请求。` and does not call the endpoint. A profile, URL, revision, endpoint, or model mismatch returns `STALE_TARGET`. A title apply while the profile is not live returns `READ_ONLY` before the job is claimed. At most one format repair runs. Timeout, 429, and cancel do not repair.

Organization failures use `failure` and `failureMessage` on `OrganizationPlan`. The organization pass uses the same repair rule: at most one format repair, and timeout, HTTP 429, and cancel do not repair. A changed revision or fingerprint returns `STALE_PROPOSAL` and `资料已变化。旧方案不能应用。` A plan-hash mismatch returns `方案已变化。请重新审查后再应用。` and does not apply the old plan. A profile that is not live returns `READ_ONLY` and `未连接。不能写入浏览器。` Unconfirmed empty-folder cleanup returns `未确认删除。没有删除书签或空文件夹。` and does not plan a delete. Missing items, duplicate items, unknown ids, and folder cycles are rejected before a browser write.
