# Logging Guidelines

The reference plan section 11 requires exclusion of sensitive URL data. No logging implementation exists.

Log operation kind, pseudonymous profile identity, request ID, state, elapsed milliseconds, item counts, and error codes.

Documentation fixture:

```json
{"level":"warn","event":"operation.uncertain","requestId":"request-a","profileId":"profile-a","elapsedMs":5000,"code":"UNCERTAIN_WRITE"}
```

Use error for unavailable capabilities requiring intervention, warn for recoverable conflicts, info for lifecycle summaries, and debug for bounded detail. Avoid one info message per imported bookmark.

Exclude tokens, keys, headers, page text, full titles, query strings, fragments, and bookmark trees in every mode. Recovery snapshots are protected user data, separate from logs.

Require redacted user-selected diagnostic exports. Record app, browser, protocol, and schema versions in receipts. Bound log size and retention. Do not add telemetry.

Public page fetch does not log the URL, query, fragment, headers, title, page text, or image bytes.

AI audit lines are JSON objects with `event`, `profileId`, `jobId`, `code`, and `elapsedMs`. They omit the endpoint, bearer, secret, headers, body, title, query, fragment, and page text. The in-memory buffer keeps 50 lines. Model transport errors are not written with `Display`.
