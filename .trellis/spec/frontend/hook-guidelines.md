# Async UI Lifecycle Guidelines

`apps/desktop/src/App.tsx` uses a React effect to load the startup DTO and ignores the response after disposal. Profile subscriptions and preview requests below remain later-child contracts.

Subscribe once per source and unsubscribe on disposal. Development remounts must not duplicate jobs or writes. Subscribe before hydration and reconcile revisions to avoid lost events.

Bind asynchronous results to profile, selection, URL, and request generation. Discard stale or canceled results. Cancel underlying work where supported.

Mutations require explicit actions. Rendering effects and remounts must not submit or retry browser writes.

Test rapid selection changes, unmount during fetch, reconnect during hydration, and canceled work returning late. Add source links when tests exist.

`useContentPreview` waits 200 ms, then calls `content_preview` for the current profile bookmark. Each selection uses a new `pvN` request id. A payload with another id is ignored. Cancel calls `cancel_content_preview` and drops the payload. Tests: `apps/desktop/src/features/preview/preview.test.tsx`. The HTTP fixture for parent V10 is `crates/core/src/preview/tests.rs`; the React test does not mark V10 passed.
