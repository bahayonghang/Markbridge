# Error Handling

Validate extension messages, file snapshots, URLs, and model output at entry. Return stable codes, safe messages, request IDs, and recovery actions. Do not expose raw tokens, SQL, or page bodies.

Documentation fixture:

```json
{"code":"STALE_PROPOSAL","requestId":"request-a","message":"Bookmarks changed. Refresh the proposal.","retryable":false}
```

Distinguish unpaired, read-only, wrong-profile, stale-proposal, protected-node, uncertain-write, fetch-denied, invalid-AI-output, and storage errors. Child 02 defines ErrorCode in crates/protocol/src/wire.rs. Use the shared enum; storage and protocol boundaries return safe codes. Detailed storage failure behavior is in database-guidelines.md.

A lost acknowledgment does not prove failure. A successful send does not prove application. Reconcile before repeating non-idempotent commands. Stop batches on conflicts or uncertain results and retain successful receipts.

R04 daily batches persist a stop after 10 seconds without the current step's receipt; a background timer enforces this even when the UI closes. Late receipts correct that item's state but never resume the remainder. Cancellation preserves applied effects and treats an already-dispatched unresolved step as uncertain, not unexecuted or rolled back. `get_batch_edit` reports applied/not_executed/in_flight/conflict/uncertain per item. Reconnect, restart and explicit status refresh reconcile receipts without automatically dispatching remaining steps. `list_operations` exposes a backward-compatible optional `isBatch` marker so persisted per-item results remain reachable from history.

Keep the last valid cache when a file is temporarily invalid. Show source freshness. Require authentication and reconciliation before re-enabling writes.

AI and page failures must not disable local browsing or tags. Cancellation prevents late results from applying. Avoid duplicate retry layers.

Content preview failures use `failure` and `failureMessage` on `ContentPreview`. The 10 second timeout message is `抓取超过 10 秒`. `cancel_content_preview` returns no page body. A cancelled preview has null title, summary, and image.

AI failures use `failure` and `failureMessage` on `AiConnection`, `AiSuggestion`, and `AiApplyResult`. Invalid JSON, overlong fields, unknown fields, timeout, HTTP 429, and cancel do not write bookmarks. A credential read failure returns `无法读取已保存的凭据。没有发送请求。` and does not call the endpoint. A profile, URL, revision, endpoint, or model mismatch returns `STALE_TARGET`. A title apply while the profile is not live returns `READ_ONLY` before the job is claimed. At most one format repair runs. Timeout, 429, and cancel do not repair.

Organization failures use `failure` and `failureMessage` on `OrganizationPlan`. The organization pass uses the same repair rule: at most one format repair, and timeout, HTTP 429, and cancel do not repair. A changed revision or fingerprint returns `STALE_PROPOSAL` and `资料已变化。旧方案不能应用。` A plan-hash mismatch returns `方案已变化。请重新审查后再应用。` and does not apply the old plan. A profile that is not live returns `READ_ONLY` and `未连接。不能写入浏览器。` Unconfirmed empty-folder cleanup returns `未确认删除。没有删除书签或空文件夹。` and does not plan a delete. Missing items, duplicate items, unknown ids, and folder cycles are rejected before a browser write.

Library maintenance failures use `failure` and `failureMessage` on `MaintenanceReport`. An empty scope returns `未选择范围。没有发出请求。` Cancel returns `检查已取消。未继续请求其余地址。` Unconfirmed cleanup returns `未确认清理。没有删除书签。` A profile that is not live returns `未连接。不能写入浏览器。` A changed revision returns `资料已变化。旧方案不能应用。` Mixed URLs return `这些书签不是同一 URL。` A missing keeper returns `保留项不在所选重复项中。` An empty removal set returns `没有可移除的重复项。` A delete over 20 items returns `删除超过 20 项需要再次确认。` A protected node returns `包含不可删除的书签。没有删除。` HTTP 403, 429, timeout, and a login page stay `unknown`. HTTP 404 and 410 stay `pending` until a later check at least 1000 ms after an earlier gone observation.

R05 preview session cleanup must report failure for the requested Profile even when another Profile owns the current window state. A failed removal of a non-current Profile directory returns StorageError; do not return the other Profile's unchanged snapshot as success. Failed removal for the current Profile retains the existing SessionBusy notice.

R06 native saving returns saved only after a complete write, sync and atomic replacement. A cancelled dialog returns cancelled without creating an export. Dialog or file I/O failures return failed with a stable code; preserve an existing destination and remove only the temporary file created by this save. Keep destination paths and file bodies out of the IPC response and logs. A native dialog rejecting an occupied target is distinct evidence from Rust returning a write failure.

R07 initial organization generation accepts an optional caller requestId so cancellation does not wait for the model response. It becomes the persisted job ID and registers uniquely before preparation. Concurrent reuse returns Conflict without replacing the original cancellation flag. Release the registration on preparation failure or completion only if the same flag still owns it. A tokio watch cancellation must retain true even before a receiver subscribes (send_replace, not a failed send with zero receivers). Late valid model output after cancellation remains cancelled, with no browser operation; keep separate semantics for stopping remaining steps after a confirmed apply.
