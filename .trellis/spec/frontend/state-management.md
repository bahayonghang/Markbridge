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

`AiSettings` may call `ai_settings` on mount. It does not call the model until the user tests the connection. The model key uses an uncontrolled password input and is cleared before the result is rendered. `AiSuggest` calls `suggest_ai` only from the generate button. A profile, bookmark, URL, or revision change drops the draft and cancels the in-flight request. Folder text is display-only. Confirmed title undo uses the existing edit undo action.
