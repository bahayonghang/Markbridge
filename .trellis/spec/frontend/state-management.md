# State Management

| State | Owner |
|---|---|
| Browser tree and revision | Backend cache derived from Chrome |
| Tags, notes, summaries, history | SQLite through backend |
| Selection, search input, panels | Frontend |
| Unsaved edits and selected proposals | Explicit UI drafts |
| Remote webpage session | Isolated preview WebView |

Do not maintain several independently mutable copies of the browser tree. Keep original titles separate from suggestions and optional tag encoding.

Distinguish unpaired, connecting, reconciling, live, cached read-only, file read-only, and error. Only live state permits browser writes.

Documentation fixture:

```json
{"profileId":"profile-a","connection":"cached_read_only","canEditLocalMetadata":true,"canWriteBrowser":false}
```

No state library is installed. Additional dependencies need an actual shared-state requirement. An AI response remains a proposal until a confirmed apply receipt exists.
