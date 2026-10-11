# Async UI Lifecycle Guidelines

No hooks exist yet. Apply these rules to the chosen framework's lifecycle.

Subscribe once per source and unsubscribe on disposal. Development remounts must not duplicate jobs or writes. Subscribe before hydration and reconcile revisions to avoid lost events.

Bind asynchronous results to profile, selection, URL, and request generation. Discard stale or canceled results. Cancel underlying work where supported.

Mutations require explicit actions. Rendering effects and remounts must not submit or retry browser writes.

Test rapid selection changes, unmount during fetch, reconnect during hydration, and canceled work returning late. Add source links when tests exist.
