# Async UI Lifecycle Guidelines

`apps/desktop/src/App.tsx` uses a React effect to load the startup DTO and ignores the response after disposal. Profile subscriptions and preview requests below remain later-child contracts.

Subscribe once per source and unsubscribe on disposal. Development remounts must not duplicate jobs or writes. Subscribe before hydration and reconcile revisions to avoid lost events.

Bind asynchronous results to profile, selection, URL, and request generation. Discard stale or canceled results. Cancel underlying work where supported.

Mutations require explicit actions. Rendering effects and remounts must not submit or retry browser writes.

Test rapid selection changes, unmount during fetch, reconnect during hydration, and canceled work returning late. Add source links when tests exist.

`useContentPreview` waits 200 ms, then calls `content_preview` for the current profile bookmark. Each selection uses a new `pvN` request id. A payload with another id is ignored. Cancel calls `cancel_content_preview` and drops the payload. Tests: `apps/desktop/src/features/preview/preview.test.tsx`. The HTTP fixture for parent V10 is `crates/core/src/preview/tests.rs`; the React test does not mark V10 passed.

R05 request generations protect busy state as well as results. A stale AI generate/apply/undo completion cannot clear a newer request's busy state or overwrite its notice; a new identity must have usable controls. Tag catalog reads include the expected source epoch and reject delayed responses from prior identities. The title-diff generation also changes when locally saved metadata refreshes, since apply recomputes encoding from current tags.

R06 history and export reads are bound to their source and request generation. A revision change invalidates pending or displayed undo review. Conditional undo may return rolling_back; follow the returned undo operation ID to its terminal receipt and update the original status paragraph. Navigating away or cancelling a preview does not cancel an already-dispatched operation. A stale source's export completion must not report success in a newly selected source.

R07 keeps organize results mounted across app navigation, keyed by source and sourceEpoch. Explicitly replacing scope resets unconfirmed work; revision changes invalidate review and cancel generation while retaining useful stale results with a notice. Allow cancellation during link/model requests and reject their late responses. A confirmed apply/undo keeps its result watcher through its own revision changes; disable generation cancellation while the confirmed request is unresolved and never claim it retracted writes. Follow the returned operation ID or organization job until observed completion/uncertainty; stopping remaining steps does not roll back applied steps. Request IDs must be unique across app restarts.
