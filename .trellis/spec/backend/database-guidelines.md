# Database Guidelines

The reference plan section 7 selects SQLite; no driver or schema is implemented. The product design owns the driver choice and schema.

## Identity

Use `(profileId, sourceEpoch, chromeId)` for browser cache identity and an application-owned `bookmarkId` for local metadata. Do not require an API `guid`. Keep file mirrors in separate source namespaces until explicit association is validated. Duplicate URLs must remain separate bookmarks.

Documentation fixture:

```json
{"profileId":"profile-a","sourceEpoch":1,"chromeId":"42","bookmarkId":"bookmark-a"}
```

The same Chrome ID in another profile is a different bookmark.

## Transactions

Commit event batches and revisions together. Validate full snapshots before atomic replacement. Preserve local metadata and tombstone deleted browser nodes.

Persist the plan, target profile, and before-state before any browser mutation. Record each receipt. SQLite and Chrome have no shared transaction. Reconcile uncertain writes before retrying. Rollback is a new conditional operation against current state.

Use parameterized SQL and enable foreign keys on each connection. Number migrations; back up before destructive migration. Test upgrades and failure recovery without deleting user data.

## Privacy and checks

Keep API keys in OS-protected storage, outside SQLite. Bound fetched-content retention. Test equal IDs across profiles, duplicate URLs, refresh preservation, migration failure, and restart during apply.
